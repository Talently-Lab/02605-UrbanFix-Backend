const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');
const { parseFrontendOrigins } = require('../src/config/cors.config');

const origin = 'https://frontend.example.test';
const secret = 'cors-test-key';
const userId = '11111111-1111-4111-8111-111111111111';
const token = jwt.sign({ userId, role: 'CLIENT' }, secret, { algorithm: 'HS256', expiresIn: 3600 });

async function setup(t, { registrationError, neighborhoodError } = {}) {
  const queries = [];
  const account = { id: userId, role: 'CLIENT', accountStatus: 'ACTIVE', technician: null };
  const prisma = {
    user: {
      findUnique: async () => { queries.push('user.findUnique'); return account; },
      create: async () => { queries.push('user.create'); if (registrationError) throw registrationError; return account; },
    },
    neighborhood: { findMany: async () => { queries.push('neighborhood.findMany'); if (neighborhoodError) throw neighborhoodError; return []; } },
  };
  const app = createApp({ prisma, jwtSecret: secret,
    frontendOrigins: parseFrontendOrigins(`${origin},http://localhost:5173`) });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const request = (path, { method = 'GET', requestOrigin = origin, headers = {}, body } = {}) => fetch(
    `http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { ...(requestOrigin !== null && { Origin: requestOrigin }), ...headers },
      ...(body !== undefined && { body }),
    });
  return { request, queries };
}

function assertCors(response, requestOrigin = origin) {
  assert.equal(response.headers.get('access-control-allow-origin'), requestOrigin);
  assert.match(response.headers.get('vary'), /(?:^|,\s*)Origin(?:,|$)/i);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('access-control-expose-headers'), 'WWW-Authenticate');
}

test('CORS permite únicamente orígenes exactos de la configuración inyectada', async t => {
  const { request, queries } = await setup(t);
  for (const requestOrigin of [origin, 'http://localhost:5173']) {
    const response = await request('/api/especialidades', { requestOrigin });
    assert.equal(response.status, 200);
    assertCors(response, requestOrigin);
  }
  assert.deepEqual(queries, []);
});

test('CORS no autoriza orígenes rechazados, parciales, null o ausentes ni agrega 403', async t => {
  const { request } = await setup(t);
  for (const requestOrigin of ['https://frontend.example.test.evil.test', 'https://sub.frontend.example.test',
    'http://frontend.example.test', 'https://frontend.example.test:444', 'null', null]) {
    const response = await request('/api/especialidades', { requestOrigin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  }
});

test('preflight autorizado devuelve 204 antes de Auth sin consultas a Prisma', async t => {
  const { request, queries } = await setup(t);
  const response = await request('/api/usuarios/me', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type',
  } });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assertCors(response);
  assert.deepEqual(response.headers.get('access-control-allow-methods').split(','), ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS']);
  assert.deepEqual(response.headers.get('access-control-allow-headers').split(','), ['Authorization', 'Content-Type']);
  assert.deepEqual(queries, []);
});

test('preflight rechazado no recibe autorización CORS ni ejecuta consultas', async t => {
  const { request, queries } = await setup(t);
  const response = await request('/api/usuarios/me', { method: 'OPTIONS', requestOrigin: 'https://other.example.test',
    headers: { 'Access-Control-Request-Method': 'PATCH' } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-methods'), null);
  assert.deepEqual(queries, []);
});

test('CORS conserva encabezados en respuestas 400, 401, 403, 404, 409 y 500', async t => {
  t.mock.method(console, 'error', () => {});
  const registrationError = Object.assign(new Error('duplicate'), { code: 'P2002', meta: { target: ['email'] } });
  const { request } = await setup(t, { registrationError, neighborhoodError: new Error('private database detail') });
  for (const [path, options, status] of [
    ['/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400],
    ['/api/usuarios/me', {}, 401],
    ['/api/admin/usuarios', { headers: { Authorization: `Bearer ${token}` } }, 403],
    ['/api/unknown', {}, 404],
    ['/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ana', email: 'ana@example.test', password: 'password123', role: 'CLIENT', phone: '+12' }) }, 409],
    ['/api/barrios', {}, 500],
  ]) {
    const response = await request(path, options);
    assert.equal(response.status, status);
    assertCors(response);
    if (status === 401) assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="urbanfix"');
    await response.text();
  }
});
