const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateVolumeIntegrationOptions } = require('../prisma/seed/target');
const { createVolumeDataset, volumeReference } = require('../prisma/data/volume');
const { seedVolume, TABLES } = require('../prisma/seed/volume');
const { validateCatalogCsv } = require('../prisma/seed/validate');

test('PostgreSQL Volumen: atomicidad, preservación, persistencia, integridad e idempotencia', {
  skip: process.env.URBANFIX_RUN_SEED_DB_TESTS !== '1',
}, async t => {
  const { connectionString } = validateVolumeIntegrationOptions(process.env);
  volumeReference(process.env.URBANFIX_SEED_REFERENCE_TIME);
  const data = createVolumeDataset(process.env.URBANFIX_SEED_REFERENCE_TIME);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const observer = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  t.after(() => prisma.$disconnect()); t.after(() => observer.$disconnect());
  const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
  const order = { technicianSpecialty: [{ technicianId: 'asc' }, { category: 'asc' }],
    technicianNeighborhood: [{ technicianId: 'asc' }, { neighborhoodId: 'asc' }] };
  const snapshot = async client => Object.fromEntries(await Promise.all(['neighborhood', ...TABLES].map(async table =>
    [table, await client[table].findMany({ orderBy: order[table] || { id: 'asc' } })])));
  const initial = await snapshot(observer);
  for (const table of TABLES) assert.equal(initial[table].length, 0, 'Se requiere una base Volumen nueva sin fixtures');
  assert.deepEqual(initial.neighborhood.map(({ name, comuna }) => ({ name, comuna })).sort((a, b) => a.name.localeCompare(b.name)),
    validateCatalogCsv(csv).sort((a, b) => a.name.localeCompare(b.name)));
  async function rollback(callback) {
    const marker = new Error('Rollback intencional Volumen');
    await assert.rejects(prisma.$transaction(async tx => {
      await callback(tx, { $transaction: operation => operation(tx) });
      throw marker;
    }, { isolationLevel: 'Serializable', timeout: 10000 }), error => error === marker);
    assert.deepEqual(await snapshot(observer), initial);
  }
  await t.test('conserva un usuario ajeno sin adoptar ni modificar su identidad', async () => {
    await rollback(async (tx, scoped) => {
      const foreign = await tx.user.create({ data: { ...data.user[0],
        id: 'c4000001-0000-4000-8000-000000000099', email: 'control.volume.integration@example.com',
        createdAt: new Date(data.user[0].createdAt) } });
      assert.deepEqual(await seedVolume(scoped, data, csv), { existing: 0, inserted: 695, total: 695 });
      assert.deepEqual(await tx.user.findUnique({ where: { id: foreign.id } }), foreign);
    });
  });
  await t.test('una colisión aborta antes de insertar y conserva todos los datos', async () => {
    await rollback(async (tx, scoped) => {
      const foreign = await tx.user.create({ data: { ...data.user[0], name: 'No modificar', createdAt: new Date(data.user[0].createdAt) } });
      await assert.rejects(seedVolume(scoped, data, csv), /discrepancias/);
      assert.deepEqual(await tx.user.findMany(), [foreign]);
      for (const table of TABLES.filter(name => name !== 'user')) assert.equal(await tx[table].count(), 0);
    });
  });
  await t.test('un error tras el último INSERT revierte las seis tablas', async () => {
    const failure = new Error('Fallo simulado después de las ofertas Volumen');
    const failing = { $transaction: (callback, options) => prisma.$transaction(tx => {
      const scoped = { $queryRaw: (...args) => tx.$queryRaw(...args), neighborhood: tx.neighborhood };
      for (const table of TABLES) scoped[table] = { findMany: args => tx[table].findMany(args),
        createMany: async args => {
          const result = await tx[table].createMany(args);
          if (table === 'serviceOffer') throw failure;
          return result;
        } };
      return callback(scoped);
    }, options) };
    await assert.rejects(seedVolume(failing, data, csv), error => error === failure);
    assert.deepEqual(await snapshot(observer), initial);
  });
  await t.test('primera carga con commit, contenido exacto y segunda transacción sin cambios', async () => {
    assert.deepEqual(await seedVolume(prisma, data, csv), { existing: 0, inserted: 695, total: 695 });
    const before = await snapshot(observer);
    assert.deepEqual(before.neighborhood, initial.neighborhood);
    const ids = new Map(initial.neighborhood.map(row => [row.name, row.id]));
    for (const table of TABLES) {
      const expected = data[table].map(({ neighborhoodName, ...row }) => {
        if (neighborhoodName) row.neighborhoodId = ids.get(neighborhoodName);
        for (const field of Object.keys(row)) if (field.endsWith('At') && row[field] !== null) row[field] = new Date(row[field]);
        return row;
      });
      const key = row => row.id || `${row.technicianId}/${row.category || row.neighborhoodId}`;
      assert.deepEqual([...before[table]].sort((a, b) => key(a).localeCompare(key(b))), expected.sort((a, b) => key(a).localeCompare(key(b))));
    }
    assert.deepEqual(await seedVolume(prisma, data, csv), { existing: 695, inserted: 0, total: 695 });
    assert.deepEqual(await snapshot(observer), before);
    const changed = createVolumeDataset(new Date(Date.parse(data.reference) + 7 * 86400000).toISOString());
    await assert.rejects(seedVolume(prisma, changed, csv), /discrepancias/);
    assert.deepEqual(await snapshot(observer), before);
  });
  await t.test('SQL verifica exclusión R2, elegibilidad, disponibilidad histórica y vigencia', async () => {
    const [counts] = await observer.$queryRaw`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT u."isTestUser")::int AS clean
      FROM "ServiceRequest" r JOIN "User" u ON u.id = r."clientId"`;
    assert.deepEqual(counts, { total: 200, clean: 190 });
    const [overlaps] = await observer.$queryRaw`
      SELECT count(*)::int AS n FROM "ServiceRequest" a JOIN "ServiceRequest" b
        ON a."technicianId" = b."technicianId" AND a.id < b.id
      WHERE a."acceptedAt" IS NOT NULL AND b."acceptedAt" IS NOT NULL
        AND a."acceptedAt" < coalesce(b."completedAt", b."cancelledAt", 'infinity'::timestamptz)
        AND b."acceptedAt" < coalesce(a."completedAt", a."cancelledAt", 'infinity'::timestamptz)`;
    assert.equal(overlaps.n, 0);
    const [invalid] = await observer.$queryRaw`
      SELECT count(*)::int AS n FROM "ServiceOffer" o
      JOIN "ServiceRequest" r ON r.id = o."requestId"
      JOIN "Technician" t ON t.id = o."technicianId" JOIN "User" u ON u.id = t."userId"
      JOIN "User" c ON c.id = r."clientId"
      LEFT JOIN "TechnicianSpecialty" s ON s."technicianId" = t.id AND s.category = r.category
      LEFT JOIN "TechnicianNeighborhood" n ON n."technicianId" = t.id AND n."neighborhoodId" = r."neighborhoodId"
      WHERE t."approvalStatus" <> 'APPROVED' OR u."accountStatus" <> 'ACTIVE'
        OR u."isTestUser" <> c."isTestUser" OR s."technicianId" IS NULL OR n."technicianId" IS NULL
        OR o."expiresAt" <> o."createdAt" + interval '24 hours'
        OR (o.status = 'ACCEPTED' AND (r."acceptedAt" < o."createdAt" OR r."acceptedAt" >= o."expiresAt"))
        OR EXISTS (SELECT 1 FROM "ServiceRequest" job WHERE job."technicianId" = t.id
          AND job."acceptedAt" <= o."createdAt"
          AND o."createdAt" < coalesce(job."completedAt", job."cancelledAt", 'infinity'::timestamptz))`;
    assert.equal(invalid.n, 0);
  });
});
