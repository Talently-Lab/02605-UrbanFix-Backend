const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateSeedIntegrationOptions } = require('../prisma/seed/target');
const { seedCatalog } = require('../prisma/seed/catalog');
const { validateCatalogCsv } = require('../prisma/seed/validate');

test('PostgreSQL seed catálogo: idempotencia, relaciones, discrepancias y rollback real', {
  skip: process.env.URBANFIX_RUN_SEED_DB_TESTS !== '1',
}, async t => {
  const { connectionString, concurrencyConnectionString } = validateSeedIntegrationOptions(process.env);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  t.after(() => prisma.$disconnect());
  const observer = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  t.after(() => observer.$disconnect());
  const concurrent = new PrismaClient({ adapter: new PrismaPg({ connectionString: concurrencyConnectionString }) });
  t.after(() => concurrent.$disconnect());
  const contender = new PrismaClient({ adapter: new PrismaPg({ connectionString: concurrencyConnectionString }) });
  t.after(() => contender.$disconnect());
  const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
  const officialNames = validateCatalogCsv(csv).map(row => row.name).sort();
  for (const client of [prisma, concurrent]) {
    assert.equal(await client.neighborhood.count(), 0, 'Se requiere una base desechable con catálogo vacío');
    assert.equal(await client.user.count(), 0, 'Se requiere una base desechable sin fixtures previos');
  }

  function assertOfficialCatalog(rows) {
    assert.deepEqual(rows.map(row => row.name).sort(), officialNames);
    assert.equal(new Set(rows.map(row => row.id)).size, 48);
    for (const row of rows) {
      assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  }

  async function createRelatedFixtures(tx) {
    const neighborhood = await tx.neighborhood.create({ data: { name: 'Palermo' } });
    const client = await tx.user.create({ data: {
      name: 'Seed integration client', email: `seed-${randomUUID()}@example.test`,
      role: 'CLIENT', phone: '+5491123456789', passwordHash: 'integration-only-hash', isTestUser: true,
      createdAt: new Date('2026-10-31T12:00:00.000Z'),
    } });
    const user = await tx.user.create({ data: {
      name: 'Seed integration technician', email: `seed-${randomUUID()}@example.test`,
      role: 'TECHNICIAN', phone: '+5491123456789', passwordHash: 'integration-only-hash', isTestUser: true,
      createdAt: new Date('2026-10-31T12:00:00.000Z'),
    } });
    const technician = await tx.technician.create({ data: {
      userId: user.id, approvalStatus: 'APPROVED',
      specialties: { create: { category: 'PLUMBING' } },
    } });
    const coverage = await tx.technicianNeighborhood.create({ data: {
      technicianId: technician.id, neighborhoodId: neighborhood.id,
    } });
    const createdAt = new Date('2026-11-01T12:00:00.000Z');
    const request = await tx.serviceRequest.create({ data: {
      clientId: client.id, neighborhoodId: neighborhood.id, category: 'PLUMBING',
      street: 'Calle ficticia de integración', streetNumber: 'S/N',
      description: 'Solicitud ficticia para verificar la preservación de relaciones.', createdAt,
    } });
    const offer = await tx.serviceOffer.create({ data: {
      requestId: request.id, technicianId: technician.id, createdAt,
      expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
    } });
    return { neighborhood, coverage, request, offer };
  }

  async function snapshot(client) {
    return Promise.all([
      client.neighborhood.findMany({ orderBy: { id: 'asc' } }),
      client.user.findMany({ orderBy: { id: 'asc' } }),
      client.technician.findMany({ orderBy: { id: 'asc' } }),
      client.technicianSpecialty.findMany({ orderBy: [{ technicianId: 'asc' }, { category: 'asc' }] }),
      client.technicianNeighborhood.findMany({ orderBy: [{ technicianId: 'asc' }, { neighborhoodId: 'asc' }] }),
      client.serviceRequest.findMany({ orderBy: { id: 'asc' } }),
      client.serviceOffer.findMany({ orderBy: { id: 'asc' } }),
    ]);
  }

  async function withRollback(callback) {
    const rollback = new Error('Rollback intencional del fixture');
    await assert.rejects(prisma.$transaction(async tx => {
      await callback(tx, { $transaction: operation => operation(tx) });
      throw rollback;
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 }), error => error === rollback);
    assert.equal(await prisma.neighborhood.count(), 0);
    assert.equal(await prisma.user.count(), 0);
  }

  await t.test('preserva UUID y FK de solicitudes y coberturas existentes', async () => {
    await withRollback(async (tx, scoped) => {
      const { neighborhood, coverage, request, offer } = await createRelatedFixtures(tx);
      assert.deepEqual(await seedCatalog(scoped, csv), { existing: 1, inserted: 47, total: 48 });
      assert.deepEqual(await tx.neighborhood.findUnique({ where: { id: neighborhood.id } }), neighborhood);
      assert.deepEqual(await tx.technicianNeighborhood.findUnique({ where: {
        technicianId_neighborhoodId: { technicianId: coverage.technicianId, neighborhoodId: neighborhood.id },
      } }), coverage);
      assert.deepEqual(await tx.serviceRequest.findUnique({ where: { id: request.id } }), request);
      assert.deepEqual(await tx.serviceOffer.findUnique({ where: { id: offer.id } }), offer);
    });
  });

  await t.test('un nombre ajeno aborta sin insertar ni corregir el registro', async () => {
    await withRollback(async (tx, scoped) => {
      const unexpected = await tx.neighborhood.create({ data: { name: 'Seed integration discrepancy' } });
      await assert.rejects(seedCatalog(scoped, csv), error => error.code === 'SEED_CATALOG_DISCREPANCY');
      assert.deepEqual(await tx.neighborhood.findMany(), [unexpected]);
    });
  });

  await t.test('un fallo después del INSERT revierte el lote PostgreSQL completo', async () => {
    const failure = new Error('Fallo simulado después de insertar el lote');
    const failingClient = { $transaction: (callback, options) => prisma.$transaction(tx => callback({
      $queryRaw: (...args) => tx.$queryRaw(...args),
      neighborhood: {
        findMany: args => tx.neighborhood.findMany(args),
        createMany: async args => {
          await tx.neighborhood.createMany(args);
          throw failure;
        },
      },
    }), options) };
    await assert.rejects(seedCatalog(failingClient, csv), error => error === failure);
    assert.equal(await prisma.neighborhood.count(), 0);
  });

  await t.test('dos transacciones concurrentes conservan exactamente los 48 barrios oficiales', async () => {
    const results = await Promise.allSettled([
      seedCatalog(concurrent, csv), seedCatalog(contender, csv),
    ]);
    const committed = results.filter(result => result.status === 'fulfilled');
    for (const result of results) {
      if (result.status === 'fulfilled') {
        assert.equal(result.value.total, 48);
        assert.ok([0, 48].includes(result.value.inserted));
        assert.equal(result.value.existing + result.value.inserted, 48);
      } else {
        const error = result.reason;
        const target = error?.meta?.target;
        const duplicateName = error?.code === 'P2002' && (
          target === 'Neighborhood_name_key' ||
          (error.meta?.modelName === 'Neighborhood' && Array.isArray(target) &&
            target.length === 1 && target[0] === 'name') ||
          error.meta?.driverAdapterError?.cause?.constraint?.index === 'Neighborhood_name_key'
        );
        if (error?.code !== 'P2034' && !duplicateName) throw error;
      }
    }
    assert.ok(committed.length >= 1, 'Debe confirmarse al menos una carga concurrente');
    assert.equal(committed.reduce((sum, result) => sum + result.value.inserted, 0), 48);
    const rows = await concurrent.neighborhood.findMany();
    assertOfficialCatalog(rows);
    assert.deepEqual(await contender.neighborhood.findMany({ orderBy: { id: 'asc' } }),
      await concurrent.neighborhood.findMany({ orderBy: { id: 'asc' } }));
  });

  await t.test('dos cargas con commits independientes conservan registros, UUID y relaciones', async () => {
    const fixtures = await prisma.$transaction(createRelatedFixtures);
    assert.deepEqual(await seedCatalog(prisma, csv), { existing: 1, inserted: 47, total: 48 });
    const before = await snapshot(observer);
    assertOfficialCatalog(before[0]);
    assert.deepEqual(before[0].find(row => row.id === fixtures.neighborhood.id), fixtures.neighborhood);
    assert.deepEqual(before[4], [fixtures.coverage]);
    assert.deepEqual(before[5], [fixtures.request]);
    assert.deepEqual(before[6], [fixtures.offer]);
    assert.deepEqual(await seedCatalog(prisma, csv), { existing: 48, inserted: 0, total: 48 });
    assert.deepEqual(await snapshot(observer), before);
  });
});
