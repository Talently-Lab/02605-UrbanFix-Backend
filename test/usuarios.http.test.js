const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');

const secret = 'profile-http-test-key';
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const sign = (claims = {}, options = {}) => jwt.sign({ userId, role: 'CLIENT', ...claims }, secret,
  { algorithm: 'HS256', expiresIn: 3600, ...options });

async function setup(t, { role = 'CLIENT', approvalStatus = 'PENDING', accountStatus = 'ACTIVE',
  missing = false, findError, profileFindError, updateError, concurrentStatus } = {}) {
  const account = {
    id: userId, name: 'Ana', email: 'ana@example.test', role, accountStatus,
    phone: role === 'ADMIN' ? null : '+5491123456789',
    technician: role === 'TECHNICIAN' ? { id: otherId, approvalStatus } : null,
    lastLoginAt: new Date('2026-11-25T12:00:00.123Z'), isTestUser: false,
    passwordHash: 'private-password-hash', createdAt: new Date(),
  };
  const queries = [];
  const writes = [];
  let deleted = missing;
  const prisma = { user: {
    findUnique: async query => {
      queries.push(query);
      if (findError) throw findError;
      if (profileFindError && queries.length > 1) throw profileFindError;
      return deleted ? null : { ...account };
    },
    update: async query => {
      writes.push(query);
      if (updateError) throw updateError;
      if (concurrentStatus === 'DELETED') deleted = true;
      else if (concurrentStatus) account.accountStatus = concurrentStatus;
      if (deleted || query.where.id !== account.id || query.where.accountStatus !== account.accountStatus) {
        throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      }
      Object.assign(account, query.data);
      return { ...account };
    },
  } };
  const app = createApp({ prisma, jwtSecret: secret });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const request = (method = 'GET', body, authorization = `Bearer ${sign()}`, suffix = '') => fetch(
    `http://127.0.0.1:${server.address().port}/api/usuarios/me${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', ...(authorization !== null && { Authorization: authorization }) },
      ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return { request, account, queries, writes };
}

for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
  test(`HTTP PATCH ${role} edita nombre y devuelve la misma estructura de GET`, async t => {
    const { request, account, writes, queries } = await setup(t, { role });
    const before = expectedProfile(account);
    const response = await request('PATCH', { name: 'Nuevo nombre' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json\b/);
    assert.deepEqual(await response.json(), { ...before, name: 'Nuevo nombre' });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].where, { id: userId, accountStatus: 'ACTIVE' });
    assert.deepEqual(writes[0].data, { name: 'Nuevo nombre' });
    assert.equal(queries.length, 1);
    const get = await request();
    assert.deepEqual(await get.json(), expectedProfile(account));
  });
}

for (const method of ['GET', 'PATCH']) {
  test(`HTTP ${method} rechaza JWT ausente, inválido o vencido antes de consultar o escribir`, async t => {
    const { request, queries, writes } = await setup(t);
    for (const [header, type] of [
      [null, 'authentication-required'], ['Bearer invalid', 'invalid-token'],
      [`Bearer ${sign({}, { expiresIn: -1 })}`, 'token-expired'],
    ]) {
      const response = await request(method, method === 'PATCH' ? '{' : undefined, header);
      assert.equal(response.status, 401);
      assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
      assert.equal(response.headers.get('www-authenticate'), type === 'authentication-required'
        ? 'Bearer realm="urbanfix"' : 'Bearer realm="urbanfix", error="invalid_token"');
      const body = await response.json();
      assert.equal(body.type, `/problems/${type}`);
      assert.equal(body.status, 401);
      assert.ok(body.title && body.detail);
    }
    assert.deepEqual(queries, []);
    assert.deepEqual(writes, []);
  });

  test(`HTTP ${method} conserva 401 para cuenta inexistente y 403 para suspendida`, async t => {
    for (const options of [{ missing: true }, { accountStatus: 'SUSPENDED' }]) {
      const { request, queries, writes } = await setup(t, options);
      const response = await request(method, method === 'PATCH' ? '{' : undefined);
      const status = options.missing ? 401 : 403;
      assert.equal(response.status, status);
      assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
      const body = await response.json();
      assert.equal(body.type, options.missing ? '/problems/invalid-token' : '/problems/account-suspended');
      assert.equal(body.status, status);
      assert.equal(queries.length, 1);
      assert.deepEqual(writes, []);
    }
  });
}

test('HTTP PATCH JSON malformado conserva RFC 9457 y no escribe', async t => {
  const { request, queries, writes } = await setup(t);
  const response = await request('PATCH', '{');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), {
    type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
    detail: 'El cuerpo de la petición debe contener JSON válido',
  });
  assert.equal(queries.length, 1);
  assert.deepEqual(writes, []);
});

test('HTTP PATCH usa el rol persistido aunque el JWT tenga otro rol permitido', async t => {
  const { request, writes } = await setup(t, { role: 'TECHNICIAN' });
  const denied = await request('PATCH', { name: 'Nuevo', phone: '+541143216543' }, `Bearer ${sign({ role: 'CLIENT' })}`);
  assert.equal(denied.status, 400);
  assert.deepEqual((await denied.json()).errors, [{ field: 'phone', detail: 'Campo no permitido.' }]);
  assert.deepEqual(writes, []);
  const client = await setup(t, { role: 'CLIENT' });
  const allowed = await client.request('PATCH', { phone: '+541143216543' }, `Bearer ${sign({ role: 'ADMIN' })}`);
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).phone, '+541143216543');
});

test('HTTP GET conserva null y booleanos del contrato', async t => {
  const { request, account } = await setup(t);
  account.lastLoginAt = null;
  account.isTestUser = true;
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expectedProfile(account));
});

for (const [label, method, options, operation] of [
  ['autenticación', 'GET', { findError: new Error('private-database-detail') }, 'findUnique'],
  ['lectura del perfil', 'GET', { profileFindError: new Error('private-database-detail') }, 'findUnique'],
  ['actualización', 'PATCH', { updateError: new Error('private-database-detail') }, 'update'],
]) {
  test(`HTTP fallo de ${label} devuelve 500 seguro con traceId`, async t => {
    const logger = t.mock.method(console, 'error', () => {});
    const { request, account } = await setup(t, options);
    const response = await request(method, method === 'PATCH' ? { name: 'private-input-name' } : undefined);
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
    const body = await response.json();
    assert.match(body.traceId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    assert.deepEqual(body, {
      type: '/problems/internal-error', title: 'Error interno', status: 500,
      detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId: body.traceId,
    });
    assert.equal(logger.mock.callCount(), 1);
    const serialized = logger.mock.calls[0].arguments[0];
    const log = JSON.parse(serialized);
    assert.equal(log.traceId, body.traceId);
    assert.equal(log.modelName, 'User');
    assert.equal(log.operation, operation);
    for (const sensitive of ['private-database-detail', 'private-input-name', account.phone,
      account.email, account.passwordHash, __dirname]) {
      assert.ok(!JSON.stringify(body).includes(sensitive));
      assert.ok(!serialized.includes(sensitive));
    }
  });
}

test('HTTP PATCH CLIENT edita teléfono solo y junto con nombre conservando los demás valores', async t => {
  const { request, account } = await setup(t);
  const before = expectedProfile(account);
  for (const input of [{ phone: '+541143216543' }, { name: 'Nuevo nombre', phone: '+5491164004700' }]) {
    const response = await request('PATCH', input);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...before, ...input });
  }
});

for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
  test(`HTTP PATCH ${role} rechaza payloads inválidos y mixtos sin actualización parcial`, async t => {
    const { request, account, writes, queries } = await setup(t, { role });
    const before = expectedProfile(account);
    const inputs = [undefined, {}, null, [], 1, false, '"texto"', { name: '' }, { name: null },
      { name: 'Nuevo', id: otherId }, { name: 'Nuevo', email: 'private-email' },
      { name: 'Nuevo', phone: role === 'CLIENT' ? '+012' : '+5491123456789' }];
    for (const input of inputs) {
      const response = await request('PATCH', input);
      assert.equal(response.status, 400);
      assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
      const body = await response.json();
      assert.equal(body.type, '/problems/validation-error');
      assert.equal(body.title, 'Datos inválidos');
      assert.equal(body.status, 400);
      assert.equal(body.detail, 'Revisá los campos indicados.');
      assert.ok(body.errors.length > 0);
      assert.ok(body.errors.every(error => typeof error.field === 'string' && typeof error.detail === 'string'));
      assert.ok(!JSON.stringify(body).includes('private-email'));
      assert.deepEqual(expectedProfile(account), before);
    }
    assert.equal(queries.length, inputs.length);
    assert.deepEqual(writes, []);
  });
}

test('HTTP PATCH identifica todos los campos rechazados y el body vacío según contrato', async t => {
  const { request, writes } = await setup(t);
  const empty = await request('PATCH', {});
  assert.deepEqual(await empty.json(), {
    type: '/problems/validation-error', title: 'Datos inválidos', status: 400,
    detail: 'Revisá los campos indicados.',
    errors: [{ field: 'body', detail: 'Informá al menos un campo editable para tu rol.' }],
  });
  const mixed = await request('PATCH', { name: 'Nuevo', role: 'ADMIN', isTestUser: true, phone: null });
  const body = await mixed.json();
  assert.deepEqual(new Set(body.errors.map(error => error.field)), new Set(['role', 'isTestUser', 'phone']));
  assert.deepEqual(writes, []);
});

for (const [concurrentStatus, status, type] of [
  ['SUSPENDED', 403, '/problems/account-suspended'],
  ['DELETED', 401, '/problems/invalid-token'],
]) {
  test(`HTTP PATCH evita cambios ante ${concurrentStatus} concurrente y devuelve ${status}`, async t => {
    const { request, account, queries, writes } = await setup(t, { concurrentStatus });
    const before = { name: account.name, phone: account.phone };
    const response = await request('PATCH', { name: 'Nuevo', phone: '+541143216543' });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
    const body = await response.json();
    assert.equal(body.type, type);
    assert.equal(body.status, status);
    assert.deepEqual({ name: account.name, phone: account.phone }, before);
    assert.equal(queries.length, 2);
    assert.equal(writes.length, 1);
    if (status === 401) assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="urbanfix", error="invalid_token"');
  });
}

function expectedProfile(account) {
  return {
    id: account.id, name: account.name, email: account.email, phone: account.phone,
    role: account.role, accountStatus: account.accountStatus, technician: account.technician,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null, isTestUser: account.isTestUser,
  };
}

for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
  for (const approvalStatus of role === 'TECHNICIAN' ? ['PENDING', 'REJECTED', 'APPROVED'] : [null]) {
    test(`HTTP GET devuelve exactamente el perfil propio ${role} ${approvalStatus ?? ''}`, async t => {
      const { request, account, queries, writes } = await setup(t, { role, approvalStatus });
      const response = await request('GET', undefined, undefined, `?id=${otherId}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json\b/);
      assert.deepEqual(await response.json(), expectedProfile(account));
      assert.equal(queries.length, 2);
      assert.ok(queries.every(query => query.where.id === userId));
      assert.deepEqual(writes, []);
    });
  }
}
