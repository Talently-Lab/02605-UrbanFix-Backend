const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/index');
const { listNeighborhoods } = require('../src/services/catalogos.service');

function validateIntegrationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Destino de integración no autorizado');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.pathname !== '/urbanfix_s3_test' || url.search || url.hash) {
    throw new Error('Destino de integración no autorizado');
  }
  return value;
}

function createIntegrationClient() {
  assert.equal(process.env.URBANFIX_RUN_DB_TESTS, '1', 'Integración deshabilitada');
  const connectionString = validateIntegrationUrl(process.env.DATABASE_URL);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({
    connectionString, options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  }) });
}

test('guardas de catálogos admiten únicamente el destino PostgreSQL local aislado', () => {
  const allowed = 'postgresql://127.0.0.1:55432/urbanfix_s3_test';
  assert.equal(validateIntegrationUrl(allowed), allowed);
  for (const value of [undefined, '', 'invalid',
    allowed.replace('postgresql:', 'https:'), allowed.replace('127.0.0.1', 'localhost'),
    allowed.replace('55432', '5432'), allowed.replace('urbanfix_s3_test', 'urbanfix_2605'),
    `${allowed}?host=elsewhere`, `${allowed}#fragment`]) {
    assert.throws(() => validateIntegrationUrl(value), /Destino de integración no autorizado/);
  }
});

test('PostgreSQL catálogos consulta datos reales en modo READ ONLY y expone ambas rutas públicas', {
  skip: process.env.URBANFIX_RUN_DB_TESTS !== '1',
}, async t => {
  const prisma = createIntegrationClient();
  t.after(() => prisma.$disconnect());
  await prisma.$transaction(async tx => {
    const [identity] = await tx.$queryRaw`SELECT current_database() AS database,
      current_setting('transaction_read_only') AS read_only`;
    assert.equal(identity.database, 'urbanfix_s3_test');
    assert.equal(identity.read_only, 'on');
    const expected = await tx.$queryRaw`SELECT "id", "name" FROM public."Neighborhood" ORDER BY "name" ASC`;
    assert.deepEqual(await listNeighborhoods({ prisma: tx }), expected);
    for (const neighborhood of expected) {
      assert.match(neighborhood.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.equal(typeof neighborhood.name, 'string');
    }
    const server = createApp({ prisma: tx }).listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const neighborhoods = await fetch(`${base}/barrios`);
      assert.equal(neighborhoods.status, 200);
      assert.match(neighborhoods.headers.get('content-type'), /^application\/json\b/);
      assert.deepEqual(await neighborhoods.json(), expected);
      const specialties = await fetch(`${base}/especialidades`);
      assert.equal(specialties.status, 200);
      assert.match(specialties.headers.get('content-type'), /^application\/json\b/);
      assert.deepEqual(await specialties.json(), [
        { category: 'ELECTRICITY', name: 'Electricidad', licenseRequired: true },
        { category: 'PLUMBING', name: 'Plomería', licenseRequired: false },
        { category: 'GAS', name: 'Gas', licenseRequired: true },
        { category: 'LOCKSMITH', name: 'Cerrajería', licenseRequired: false },
        { category: 'MASONRY', name: 'Albañilería', licenseRequired: false },
      ]);
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, { isolationLevel: 'RepeatableRead', timeout: 10000 });
});
