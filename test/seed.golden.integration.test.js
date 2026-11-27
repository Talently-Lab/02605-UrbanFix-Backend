const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateGoldenIntegrationOptions } = require('../prisma/seed/target');
const { createGoldenDataset } = require('../prisma/data/golden');
const { seedGolden } = require('../prisma/seed/golden');
const { validateCatalogCsv } = require('../prisma/seed/validate');

test('PostgreSQL Golden: lotes, rollback, preservación, concurrencia y contrato DA', {
  skip: process.env.URBANFIX_RUN_SEED_DB_TESTS !== '1',
}, async (t) => {
  const { connectionString } = validateGoldenIntegrationOptions(process.env);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const clients = Array.from({ length: 3 }, () => new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  }));
  for (const client of clients) t.after(() => client.$disconnect());
  const [prisma, observer, contender] = clients;
  const data = createGoldenDataset();
  const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
  const tables = ['user', 'technician', 'technicianSpecialty', 'neighborhood',
    'technicianNeighborhood', 'serviceRequest', 'serviceOffer'];
  const order = {
    technicianSpecialty: [{ technicianId: 'asc' }, { category: 'asc' }],
    technicianNeighborhood: [{ technicianId: 'asc' }, { neighborhoodId: 'asc' }],
  };
  const snapshot = async (client) => Object.fromEntries(await Promise.all(tables.map(async table =>
    [table, await client[table].findMany({ orderBy: order[table] || { id: 'asc' } })])));
  const initial = await snapshot(observer);
  for (const table of tables.filter(name => name !== 'neighborhood')) {
    assert.equal(initial[table].length, 0, 'Golden requiere una base nueva sin registros de negocio');
  }
  assert.deepEqual(initial.neighborhood.map(({ name, comuna }) => ({ name, comuna }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  validateCatalogCsv(csv).sort((a, b) => a.name.localeCompare(b.name)));

  async function rollback(callback) {
    const marker = new Error('Rollback intencional Golden');
    await assert.rejects(prisma.$transaction(async tx => {
      await callback(tx, { $transaction: operation => operation(tx) });
      throw marker;
    }, { isolationLevel: 'Serializable', timeout: 10000 }), error => error === marker);
    assert.deepEqual(await snapshot(observer), initial);
  }

  await t.test('conserva un registro ajeno y sus fechas dentro de la carga', async () => {
    await rollback(async (tx, scoped) => {
      const control = await tx.user.create({ data: { ...data.user[0],
        id: 'c3000001-0000-4000-8000-000000000099', email: 'control.golden.integration@example.com',
        name: 'Control independiente', createdAt: new Date(data.user[0].createdAt) } });
      assert.deepEqual(await seedGolden(scoped, data, csv), { existing: 0, inserted: 96, total: 96 });
      assert.deepEqual(await tx.user.findUnique({ where: { id: control.id } }), control);
    });
  });

  await t.test('rechaza colisiones sin modificar ni adoptar identidades ajenas', async () => {
    await rollback(async (tx, scoped) => {
      const control = await tx.user.create({ data: { ...data.user[0],
        id: 'c3000001-0000-4000-8000-000000000099', createdAt: new Date(data.user[0].createdAt) } });
      await assert.rejects(seedGolden(scoped, data, csv), /discrepancias/);
      assert.deepEqual(await tx.user.findMany(), [control]);
      assert.equal(await tx.serviceRequest.count(), 0);
    });
  });

  await t.test('un error después del último INSERT revierte las seis tablas completas', async () => {
    const failure = new Error('Fallo simulado después de las ofertas');
    const failing = { $transaction: (callback, options) => prisma.$transaction(tx => {
      const scoped = { $queryRaw: (...args) => tx.$queryRaw(...args), neighborhood: tx.neighborhood };
      for (const table of tables.filter(name => name !== 'neighborhood')) scoped[table] = {
        findMany: args => tx[table].findMany(args),
        createMany: async args => {
          const result = await tx[table].createMany(args);
          if (table === 'serviceOffer') throw failure;
          return result;
        },
      };
      return callback(scoped);
    }, options) };
    await assert.rejects(seedGolden(failing, data, csv), error => error === failure);
    assert.deepEqual(await snapshot(observer), initial);
  });

  await t.test('cargas concurrentes confirman exactamente un Golden completo', async () => {
    const results = await Promise.allSettled([
      seedGolden(prisma, data, csv), seedGolden(contender, data, csv),
    ]);
    const committed = results.filter(result => result.status === 'fulfilled');
    assert.ok(committed.length >= 1);
    assert.equal(committed.reduce((sum, result) => sum + result.value.inserted, 0), 96);
    for (const result of results) {
      if (result.status === 'rejected') assert.equal(result.reason.code, 'P2034');
    }
    const persisted = await snapshot(observer);
    for (const table of tables.filter(name => name !== 'neighborhood')) {
      assert.equal(persisted[table].length, data[table].length);
    }
    assert.deepEqual(persisted.neighborhood, initial.neighborhood);
    const neighborhoods = new Map(initial.neighborhood.map(row => [row.name, row.id]));
    for (const table of tables.filter(name => name !== 'neighborhood')) {
      const normalized = data[table].map(({ neighborhoodName, ...row }) => {
        if (neighborhoodName) row.neighborhoodId = neighborhoods.get(neighborhoodName);
        for (const field of Object.keys(row)) {
          if (field.endsWith('At') && row[field] !== null) row[field] = new Date(row[field]);
        }
        return row;
      });
      for (const row of normalized) assert.ok(persisted[table].some(actual => {
        try { assert.deepEqual(actual, row); return true; } catch { return false; }
      }), `Contenido íntegro de ${table}`);
    }
  });

  await t.test('una segunda transacción independiente conserva todos los registros y relaciones', async () => {
    const before = await snapshot(observer);
    assert.deepEqual(await seedGolden(prisma, data, csv), { existing: 96, inserted: 0, total: 96 });
    assert.deepEqual(await snapshot(observer), before);
  });

  await t.test('SQL PostgreSQL reproduce las variantes DA y los percentiles con R fijo', async () => {
    const reference = new Date(data.reference);
    for (const exclude of [true, false]) {
      const [row] = await observer.$queryRaw`
        SELECT count(*)::int AS n, count(sr."acceptedAt")::int AS accepted,
          count(*) FILTER (WHERE sr."acceptedAt" - sr."createdAt" <= interval '2 hours')::int AS fast,
          count(*) FILTER (WHERE sr."acceptedAt" - sr."createdAt" <= interval '24 hours')::int AS day
        FROM "ServiceRequest" sr JOIN "User" u ON u.id = sr."clientId"
        LEFT JOIN "User" moderator ON moderator.id = sr."cancelledById"
        WHERE NOT u."isTestUser"
          AND sr."createdAt" >= ${reference}::timestamptz - interval '8 days'
          AND sr."createdAt" < ${reference}::timestamptz - interval '1 day'
          AND (NOT ${exclude}::boolean OR sr."acceptedAt" IS NOT NULL OR moderator.role IS DISTINCT FROM 'ADMIN')`;
      assert.deepEqual(row, { n: exclude ? 13 : 14, accepted: 10, fast: 4, day: 9 });
    }
    const [timing] = await observer.$queryRaw`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (sr."acceptedAt" - sr."createdAt"))/60) AS median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (sr."acceptedAt" - sr."createdAt"))/60) AS p90
      FROM "ServiceRequest" sr JOIN "User" u ON u.id = sr."clientId"
      WHERE NOT u."isTestUser" AND sr."acceptedAt" IS NOT NULL
        AND sr."createdAt" >= ${reference}::timestamptz - interval '7 days'`;
    assert.equal(Number(timing.median), 150.5);
    assert.equal(Number(Number(timing.p90).toFixed(1)), 1451.1);
  });
});
