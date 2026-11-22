const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');

async function setup(t, { status = 'ACTIVE', missing = false, secret = 'http-test-secret', fail = false } = {}) {
  const writes = [];
  const user = { id: 'user-id', name: 'Ana', email: 'ana@example.com', role: 'CLIENT',
    accountStatus: status, technician: null, lastLoginAt: null, isTestUser: false,
    passwordHash: await bcrypt.hash('password123', 4) };
  const prisma = { user: {
    findFirst: async () => { if (fail) throw new Error('sensitive database details'); return missing ? null : user; },
    update: async query => { writes.push(query); return user; },
    create: async ({ data }) => ({ id: 'registered-id', ...data }),
  } };
  const app = createApp({ prisma, jwtSecret: secret });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, path = '/api/auth/login') => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { post, writes, user };
}

test('HTTP login usa bcrypt y firma HS256 con identidad segura', async t => {
  const { post, writes, user } = await setup(t);
  const response = await post({ email: user.email, password: 'password123' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['accessToken', 'expiresIn', 'tokenType', 'user']);
  const { passwordHash, ...identity } = user;
  assert.deepEqual(body.user, identity);
  assert.equal(body.tokenType, 'Bearer');
  assert.equal(body.expiresIn, 3600);
  const decoded = jwt.verify(body.accessToken, 'http-test-secret', { algorithms: ['HS256'] });
  assert.equal(decoded.userId, user.id);
  assert.equal(decoded.role, user.role);
  assert.equal(decoded.exp - decoded.iat, 3600);
  assert.equal(jwt.decode(body.accessToken, { complete: true }).header.alg, 'HS256');
  assert.equal(writes.length, 1);
});

test('HTTP 401 uniforme y 403 con RFC 9457, sin actualizar fecha', async t => {
  for (const options of [{ missing: true }, {}, { status: 'SUSPENDED' }]) {
    const { post, writes } = await setup(t, options);
    const suspended = options.status === 'SUSPENDED';
    const response = await post({ email: 'ana@example.com', password: suspended ? 'password123' : 'wrong' });
    assert.equal(response.status, suspended ? 403 : 401);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    if (!suspended) assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="urbanfix"');
    const body = await response.json();
    assert.equal(body.type, suspended ? '/problems/account-suspended' : '/problems/invalid-credentials');
    assert.equal(body.status, response.status);
    assert.ok(body.title && body.detail);
    if (!suspended) assert.equal(body.detail, 'El email o la contraseña son incorrectos.');
    assert.equal(writes.length, 0);
  }
});

for (const path of ['/api/auth/login/', '/API/Auth/LOGIN']) {
  test(`HTTP ${path} conserva los errores de login`, async t => {
    const { post, writes } = await setup(t);
    const response = await post({ email: 'ana@example.com', password: 'wrong' }, path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="urbanfix"');
    assert.deepEqual(await response.json(), {
      type: '/problems/invalid-credentials',
      title: 'Credenciales incorrectas',
      status: 401,
      detail: 'El email o la contraseña son incorrectos.',
    });

    const malformed = await post('{', path);
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal((await malformed.json()).type, '/problems/invalid-json');
    assert.equal(writes.length, 0);
  });
}

test('HTTP entrada inválida y JSON malformado siguen el contrato', async t => {
  const { post, writes } = await setup(t);
  for (const input of [{ email: 'Ana@example.com', password: 'secret' }, '{']) {
    const response = await post(input);
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    const body = await response.json();
    assert.equal(body.type, input === '{' ? '/problems/invalid-json' : '/problems/validation-error');
    if (input !== '{') assert.equal(body.errors[0].field, 'email');
  }
  assert.equal(writes.length, 0);
});

test('HTTP errores internos y clave ausente no filtran detalles ni actualizan fecha', async t => {
  for (const options of [{ fail: true }, { secret: '' }]) {
    const { post, writes } = await setup(t, options);
    const response = await post({ email: 'ana@example.com', password: 'password123' });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.type, '/problems/internal-error');
    assert.match(body.traceId, /^[0-9a-f-]{36}$/);
    assert.ok(!JSON.stringify(body).includes('sensitive'));
    assert.equal(writes.length, 0);
  }
});

test('HTTP registro conserva su comportamiento con Prisma inyectado', async t => {
  const { post } = await setup(t);
  const response = await post({ email: 'ana@example.com', password: 'password123', name: 'Ana',
    role: 'CLIENT', phone: '+5491123456789' }, '/api/auth/register');
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.id, 'registered-id');
  assert.equal(body.passwordHash, undefined);
});
