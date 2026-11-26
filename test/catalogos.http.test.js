const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/index');

async function setup(t, { rows = [], databaseError } = {}) {
  const queries = [];
  const modelReads = [];
  const prisma = new Proxy({}, { get(target, model) {
    modelReads.push(model);
    assert.equal(model, 'neighborhood', 'El catálogo no debe consultar autenticación ni otros modelos');
    return { findMany: async query => {
      queries.push(query);
      if (databaseError) throw databaseError;
      return rows;
    } };
  } });
  const server = createApp({ prisma }).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  return {
    queries,
    modelReads,
    get: (path, authorization) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    }),
  };
}

test('HTTP especialidades es público y devuelve el contrato exacto sin consultar Prisma', async t => {
  const { get, queries, modelReads } = await setup(t);
  for (const authorization of [undefined, 'Bearer invalid']) {
    const response = await get('/especialidades', authorization);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json\b/);
    assert.deepEqual(await response.json(), [
      { category: 'ELECTRICITY', name: 'Electricidad', licenseRequired: true },
      { category: 'PLUMBING', name: 'Plomería', licenseRequired: false },
      { category: 'GAS', name: 'Gas', licenseRequired: true },
      { category: 'LOCKSMITH', name: 'Cerrajería', licenseRequired: false },
      { category: 'MASONRY', name: 'Albañilería', licenseRequired: false },
    ]);
    assert.equal(response.headers.get('www-authenticate'), null);
  }
  assert.deepEqual(queries, []);
  assert.deepEqual(modelReads, []);
});

test('HTTP barrios es público, devuelve UUID y nombres y consulta una sola vez por petición', async t => {
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Almagro', technicians: ['private'] },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Caballito', requests: ['private'] },
  ];
  const { get, queries, modelReads } = await setup(t, { rows });
  for (const authorization of [undefined, 'Bearer invalid']) {
    const response = await get('/barrios', authorization);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json\b/);
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.deepEqual(await response.json(), rows.map(({ id, name }) => ({ id, name })));
  }
  assert.deepEqual(queries, Array.from({ length: 2 }, () => ({
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  })));
  assert.deepEqual(modelReads, ['neighborhood', 'neighborhood']);
});

test('HTTP barrios devuelve 200 [] para un catálogo vacío', async t => {
  const { get, queries } = await setup(t);
  const response = await get('/barrios');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  assert.deepEqual(await response.json(), []);
  assert.equal(queries.length, 1);
});

for (const loggerFails of [false, true]) {
  test(`HTTP error de barrios devuelve RFC 9457 seguro, loggerFails=${loggerFails}`, async t => {
    const sensitive = 'private-connection-password-email-sql';
    const databaseError = Object.assign(new Error(sensitive), { meta: { details: sensitive } });
    const logger = t.mock.method(console, 'error', () => {
      if (loggerFails) throw new Error('logger unavailable');
    });
    const { get, queries } = await setup(t, { databaseError });
    const response = await get('/barrios');
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
    const body = await response.json();
    assert.match(body.traceId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    assert.deepEqual(body, {
      type: '/problems/internal-error', title: 'Error interno', status: 500,
      detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId: body.traceId,
    });
    assert.equal(queries.length, 1);
    assert.equal(logger.mock.callCount(), 1);
    const serialized = logger.mock.calls[0].arguments[0];
    const log = JSON.parse(serialized);
    assert.equal(log.traceId, body.traceId);
    assert.equal(log.route, '/api/barrios');
    assert.equal(log.method, 'GET');
    assert.equal(log.modelName, 'Neighborhood');
    assert.equal(log.operation, 'findMany');
    for (const output of [JSON.stringify(body), serialized]) {
      assert.ok(!output.includes(sensitive));
      assert.ok(!output.includes(__dirname));
    }
  });
}
