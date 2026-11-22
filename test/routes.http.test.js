const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');

const secret = 'routing-test-key';
const userId = '11111111-1111-4111-8111-111111111111';
const sign = () => jwt.sign({ userId, role: 'CLIENT' }, secret, { algorithm: 'HS256', expiresIn: 3600 });

async function setup(t, role = 'CLIENT', probe = false) {
  let queries = 0;
  const prisma = { user: { findUnique: async () => {
    queries++;
    return { id: userId, role, accountStatus: 'ACTIVE', technician: null };
  } } };
  const app = createApp({ prisma, jwtSecret: secret });
  if (probe) {
    app.get('/api/solicitudes/__probe', (req, res) => res.json({ user: req.user }));
    app.get('/api/admin/__probe', (req, res) => res.json({ user: req.user }));
  }
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  return {
    get: (path, authorization) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: authorization ? { Authorization: authorization } : {},
    }),
    queries: () => queries,
  };
}

test('routers protegidos montados responden 401 con contrato de autenticación', async t => {
  const fixture = await setup(t);
  for (const path of ['/api/solicitudes', '/api/solicitudes/mias', '/api/admin', '/api/admin/usuarios']) {
    for (const authorization of [undefined, 'Bearer invalid']) {
      const response = await fixture.get(path, authorization);
      assert.equal(response.status, 401);
      assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
      assert.equal(response.headers.get('www-authenticate'), authorization
        ? 'Bearer realm="urbanfix", error="invalid_token"' : 'Bearer realm="urbanfix"');
      assert.equal((await response.json()).type, authorization
        ? '/problems/invalid-token' : '/problems/authentication-required');
    }
  }
  assert.equal(fixture.queries(), 0);
});

test('admin deniega CLIENT y TECHNICIAN, solicitudes admite cuentas activas', async t => {
  for (const role of ['CLIENT', 'TECHNICIAN']) {
    const fixture = await setup(t, role, true);
    const denied = await fixture.get('/api/admin/__probe', `Bearer ${sign()}`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).type, '/problems/forbidden');
    const allowed = await fixture.get('/api/solicitudes/__probe', `Bearer ${sign()}`);
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).user.role, role);
  }
});

test('ADMIN llega al montaje de ambos dominios usando el rol persistido', async t => {
  const fixture = await setup(t, 'ADMIN', true);
  for (const path of ['/api/admin/__probe', '/api/solicitudes/__probe']) {
    const response = await fixture.get(path, `Bearer ${sign()}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, 'ADMIN');
  }
});

test('routers de producción no implementan endpoints de negocio', async t => {
  const fixture = await setup(t, 'ADMIN');
  for (const path of ['/api/admin/usuarios', '/api/solicitudes', '/api/solicitudes/mias']) {
    const response = await fixture.get(path, `Bearer ${sign()}`);
    assert.equal(response.status, 404);
    await response.text();
  }
  assert.equal(fixture.queries(), 3);
  const root = await fixture.get('/');
  assert.equal(root.status, 200);
  assert.deepEqual(await root.json(), { message: 'UrbanFix API funcionando' });
});
