const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');
const { problemHandler } = require('../src/middleware/problem.middleware');

const secret = 'problem-test-key';
const userId = '11111111-1111-4111-8111-111111111111';
const origin = 'https://frontend.example.test';
const token = jwt.sign({ userId, role: 'CLIENT' }, secret, { algorithm: 'HS256', expiresIn: 3600 });

async function setup(t, { standaloneFailure = false, authenticated = false } = {}) {
  const queries = [];
  const prisma = new Proxy({}, { get(target, model) {
    if (authenticated && model === 'user') return { findUnique: async () => {
      queries.push('user.findUnique');
      return { id: userId, role: 'CLIENT', accountStatus: 'ACTIVE', technician: null };
    } };
    queries.push('unexpected');
    throw new Error('Prisma must not be accessed');
  } });
  const app = standaloneFailure ? express() : createApp({ prisma, jwtSecret: secret, frontendOrigins: [origin] });
  if (standaloneFailure) {
    app.get('/failure/:id', async () => { throw new Error('private-database-secret'); });
    app.use(problemHandler);
  }
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { request, queries };
}

test('HTTP rutas inexistentes devuelven 404 RFC 9457 sin reflejar URL o query', async t => {
  const { request, queries } = await setup(t);
  for (const path of ['/api/missing/private-value?token=private-token', '/missing/private-value']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
    assert.deepEqual(await response.json(), { type: '/problems/not-found', title: 'Recurso no encontrado',
      status: 404, detail: 'El recurso solicitado no está disponible.' });
  }
  assert.deepEqual(queries, []);
});

test('HTTP JSON malformado en el parser global devuelve 400 conforme al contrato', async t => {
  const { request, queries } = await setup(t);
  const response = await request('/api/unknown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{private-input' });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), { type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
    detail: 'El cuerpo de la petición debe contener JSON válido' });
  assert.deepEqual(queries, []);
});

test('HTTP error async global devuelve 500 y un log seguro con el mismo traceId', async t => {
  const logger = t.mock.method(console, 'error', () => {});
  const { request } = await setup(t, { standaloneFailure: true });
  const response = await request('/failure/private-value?token=private-token');
  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  const body = await response.json();
  assert.equal(body.type, '/problems/internal-error');
  assert.equal(body.status, 500);
  assert.ok(body.traceId);
  const serialized = logger.mock.calls[0].arguments[0];
  assert.equal(JSON.parse(serialized).traceId, body.traceId);
  assert.ok(!serialized.includes('private-'));
  assert.ok(!JSON.stringify(body).includes('private-'));
});

const parserCases = [
  { label: 'tamaño', status: 413, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privateInput: 'private-value'.repeat(9000) }),
    expected: { type: '/problems/payload-too-large', title: 'Solicitud demasiado grande', status: 413,
      detail: 'El cuerpo de la solicitud supera el tamaño máximo permitido.' } },
  ...[
    ['charset', { 'Content-Type': 'application/json; charset=iso-8859-1' }],
    ['encoding', { 'Content-Type': 'application/json', 'Content-Encoding': 'compress' }],
  ].map(([label, headers]) => ({ label, status: 415, headers, body: '{}',
    expected: { type: '/problems/unsupported-media-type', title: 'Formato no soportado', status: 415,
      detail: 'El formato o la codificación de la solicitud no están soportados.' } })),
];

for (const [path, method, authenticated] of [
  ['/api/unknown', 'POST', false], ['/api/auth/login', 'POST', false],
  ['/api/auth/register', 'POST', false], ['/api/usuarios/me', 'PATCH', true],
]) {
  for (const { label, status, headers, body, expected } of parserCases) {
    test(`HTTP parser real ${label} en ${path} devuelve ${status} sin lógica de negocio`, async t => {
      const logger = t.mock.method(console, 'error', () => {});
      const { request, queries } = await setup(t, { authenticated });
      const response = await request(path, { method, body,
        headers: { ...headers, Origin: origin, ...(authenticated && { Authorization: `Bearer ${token}` }) } });
      assert.equal(response.status, status);
      assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.deepEqual(await response.json(), expected);
      assert.deepEqual(queries, authenticated ? ['user.findUnique'] : []);
      assert.equal(logger.mock.callCount(), 0);
    });
  }
}

test('HTTP perfil conserva prioridad de autenticación ante un body demasiado grande', async t => {
  const { request, queries } = await setup(t);
  const response = await request('/api/usuarios/me', { method: 'PATCH', headers: parserCases[0].headers, body: parserCases[0].body });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).type, '/problems/authentication-required');
  assert.deepEqual(queries, []);
});
