const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { loginUser } = require('../src/services/auth.service');

const input = { email: 'ana@example.com', password: 'password123' };
const secret = 'login-test-key-only';
const previous = new Date('2026-11-20T12:00:00Z');
const current = new Date('2026-11-21T12:00:00Z');

async function fixture(overrides = {}) {
  const user = { id: 'user-id', name: 'Ana', email: input.email, role: 'CLIENT',
    accountStatus: 'ACTIVE', passwordHash: await bcrypt.hash(input.password, 4),
    technician: null, lastLoginAt: previous, isTestUser: false, phone: 'private', ...overrides };
  const writes = [];
  const deps = {
    prisma: { user: {
      findFirst: async query => {
        assert.deepEqual(query.where, { email: { equals: input.email, mode: 'insensitive' } });
        assert.deepEqual(query.select.technician, { select: { id: true, approvalStatus: true } });
        return user;
      },
      update: async query => { writes.push(query); return user; },
    } },
    comparePassword: bcrypt.compare,
    signToken: payload => jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: 3600 }),
    now: () => current,
  };
  return { user, writes, deps };
}

test('login devuelve identidad segura, JWT verificable y fecha anterior', async () => {
  const { deps, writes } = await fixture();
  const result = await loginUser(input, deps);
  assert.deepEqual(result.user, { id: 'user-id', name: 'Ana', email: input.email,
    role: 'CLIENT', accountStatus: 'ACTIVE', technician: null, lastLoginAt: previous, isTestUser: false });
  assert.equal(result.tokenType, 'Bearer');
  assert.equal(result.expiresIn, 3600);
  const payload = jwt.verify(result.accessToken, secret, { algorithms: ['HS256'] });
  assert.equal(payload.userId, 'user-id');
  assert.equal(payload.role, 'CLIENT');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'role', 'userId']);
  assert.throws(() => jwt.verify(result.accessToken, 'wrong-key'));
  assert.deepEqual(writes, [{ where: { id: 'user-id' }, data: { lastLoginAt: current } }]);
});

test('login incorrecto devuelve 401 uniforme y nunca actualiza fecha', async () => {
  const messages = [];
  for (const missing of [false, true]) {
    const { deps, writes } = await fixture({ accountStatus: 'SUSPENDED' });
    if (missing) deps.prisma.user.findFirst = async () => null;
    deps.signToken = () => assert.fail('No debe emitir token');
    await assert.rejects(loginUser({ ...input, password: 'wrong' }, deps), error => {
      assert.equal(error.status, 401);
      assert.equal(error.type, '/problems/invalid-credentials');
      messages.push(error.message);
      return true;
    });
    assert.equal(writes.length, 0);
  }
  assert.equal(messages[0], messages[1]);
});

test('cuenta suspendida con credenciales correctas devuelve 403 sin efectos', async () => {
  const { deps, writes } = await fixture({ accountStatus: 'SUSPENDED' });
  deps.signToken = () => assert.fail('No debe emitir token');
  await assert.rejects(loginUser(input, deps), error => error.status === 403 && error.type === '/problems/account-suspended');
  assert.equal(writes.length, 0);
});

test('una cuenta inexistente ejecuta bcrypt de costo 10 y se rechaza incluso si la comparación coincide', async () => {
  const { deps, writes } = await fixture();
  deps.prisma.user.findFirst = async () => null;
  const comparisons = [];
  deps.comparePassword = async (password, hash) => {
    comparisons.push(password);
    assert.equal(bcrypt.getRounds(hash), 10);
    await bcrypt.compare(password, hash);
    return true;
  };
  deps.signToken = () => assert.fail('No debe emitir token');

  await assert.rejects(loginUser(input, deps), error => error.status === 401 &&
    error.type === '/problems/invalid-credentials' &&
    error.message === 'El email o la contraseña son incorrectos.');
  assert.deepEqual(comparisons, [input.password]);
  assert.equal(writes.length, 0);
});

test('primer login y roles activos, incluidos técnicos pendientes o rechazados', async () => {
  for (const role of ['ADMIN', 'TECHNICIAN']) {
    for (const approvalStatus of ['PENDING', 'REJECTED', 'APPROVED']) {
      const technician = role === 'TECHNICIAN' ? { id: 'tech-id', approvalStatus } : null;
      const { deps } = await fixture({ role, technician, lastLoginAt: null, isTestUser: true });
      const result = await loginUser(input, deps);
      assert.equal(result.user.lastLoginAt, null);
      assert.deepEqual(result.user.technician, technician);
      assert.equal(result.user.isTestUser, true);
    }
  }
});

test('entrada inválida no consulta Prisma; fallas de firma o persistencia no devuelven éxito', async () => {
  const { deps, writes } = await fixture();
  await assert.rejects(loginUser({}, { prisma: null }), error => error.status === 400);
  deps.signToken = () => { throw new Error('sign failure'); };
  await assert.rejects(loginUser(input, deps), /sign failure/);
  assert.equal(writes.length, 0);
  deps.signToken = () => 'token';
  deps.prisma.user.update = async () => { throw new Error('write failure'); };
  await assert.rejects(loginUser(input, deps), /write failure/);
});
