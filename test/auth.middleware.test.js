const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { PrismaClientInitializationError, PrismaClientKnownRequestError } = require('@prisma/client/runtime/client');
const { authenticate, authorize } = require('../src/middleware/auth.middleware');

const secret = 'middleware-test-key-only';
const userId = '11111111-1111-4111-8111-111111111111';
const token = (claims = { userId, role: 'CLIENT' }, options = {}) =>
  jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: 3600, ...options });

async function invoke(header, options = {}) {
  const queries = [];
  const req = { headers: { authorization: header }, method: 'GET', baseUrl: '/API/Admin' };
  const response = { headers: {}, status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    type(value) { this.contentType = value; return this; },
    json(body) { this.body = body; return this; } };
  let continued = false;
  const account = { id: userId, role: 'TECHNICIAN', accountStatus: 'ACTIVE',
    technician: { id: 'tech-id', approvalStatus: 'PENDING' } };
  const middleware = authenticate({ jwtSecret: secret, prisma: { user: {
    findUnique: async query => { queries.push(query); return account; },
  } }, ...options });
  await middleware(req, response, () => { continued = true; });
  return { req, response, queries, continued, account };
}

test('authenticate comprueba JWT HS256 y usa identidad actual mediante una consulta de solo lectura', async () => {
  const result = await invoke(`Bearer ${token()}`);
  assert.equal(result.continued, true);
  assert.deepEqual(result.req.user, result.account);
  assert.deepEqual(result.queries, [{ where: { id: userId }, select: {
    id: true, role: true, accountStatus: true,
    technician: { select: { id: true, approvalStatus: true } },
  } }]);
});

test('authenticate rechaza token ausente, malformado, firma, algoritmo y claims antes de Prisma', async () => {
  const noExpiry = jwt.sign({ userId, role: 'CLIENT' }, secret);
  for (const header of [undefined, 'Basic abc', 'Bearer', 'Bearer bad',
    `Bearer ${token()} extra`, `Bearer ${jwt.sign({ userId, role: 'CLIENT' }, 'wrong')}`,
    `Bearer ${token(undefined, { algorithm: 'HS384' })}`, `Bearer ${noExpiry}`,
    `Bearer ${token({ role: 'CLIENT' })}`, `Bearer ${token({ userId: 'invalid', role: 'CLIENT' })}`,
    `Bearer ${token({ userId, role: 'UNKNOWN' })}`, `Bearer ${token({ userId })}`]) {
    const { response, queries, continued } = await invoke(header);
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.type, header === undefined ? '/problems/authentication-required' : '/problems/invalid-token');
    assert.equal(response.contentType, 'application/problem+json');
    assert.equal(response.headers['WWW-Authenticate'], header === undefined
      ? 'Bearer realm="urbanfix"' : 'Bearer realm="urbanfix", error="invalid_token"');
    assert.equal(continued, false);
    assert.equal(queries.length, 0);
    assert.equal(Object.hasOwn(response.body, 'token'), false);
  }
});

test('authenticate distingue JWT vencido', async () => {
  const { response, queries } = await invoke(`Bearer ${token(undefined, { expiresIn: -1 })}`);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.type, '/problems/token-expired');
  assert.equal(queries.length, 0);
});

test('cuenta eliminada devuelve 401 y suspendida 403 sin continuar', async () => {
  for (const account of [null, { id: userId, role: 'CLIENT', accountStatus: 'SUSPENDED' }]) {
    const result = await invoke(`Bearer ${token()}`, {
      prisma: { user: { findUnique: async () => account } },
    });
    assert.equal(result.continued, false);
    assert.equal(result.response.statusCode, account ? 403 : 401);
    assert.equal(result.response.body.type, account ? '/problems/account-suspended' : '/problems/invalid-token');
    assert.equal(result.req.user, undefined);
  }
});

test('fallas de configuración o Prisma producen 500 sin filtrar errores ni credenciales', async () => {
  for (const options of [{ jwtSecret: '' }, {
    prisma: { user: { findUnique: async () => { throw new Error('private database details'); } } },
  }]) {
    const result = await invoke(`Bearer ${token()}`, options);
    assert.equal(result.response.statusCode, 500);
    assert.equal(result.response.body.type, '/problems/internal-error');
    assert.equal(result.response.contentType, 'application/problem+json');
    assert.match(result.response.body.traceId, /^[0-9a-f-]{36}$/);
    assert.ok(!JSON.stringify(result.response.body).includes('private'));
    assert.equal(result.continued, false);
  }
});

test('authenticate correlaciona el 500 con el diagnóstico seguro de la consulta Prisma', async t => {
  const logger = t.mock.method(console, 'error', () => {});
  const privateDetail = 'postgresql://private-host/private-db';
  const knownError = code => new PrismaClientKnownRequestError(privateDetail, {
    code, clientVersion: '7.10.1', meta: { modelName: privateDetail },
  });
  for (const [error, expectedCode] of [
    [knownError('P1001'), 'P1001'],
    [knownError('P2004'), 'P2004'],
    [knownError('P9999'), null],
    [new PrismaClientInitializationError(privateDetail, '7.10.1', 'P1001'), 'P1001'],
    [Object.assign(new Error(privateDetail), { code: 'P1001' }), null],
  ]) {
    error.stack = undefined;
    const { response } = await invoke(`Bearer ${token()}`, {
      prisma: { user: { findUnique: async () => { throw error; } } },
    });

    const [serialized] = logger.mock.calls.at(-1).arguments;
    const { timestamp, durationMs, ...log } = JSON.parse(serialized);
    assert.equal(response.statusCode, 500);
    assert.ok(Number.isFinite(Date.parse(timestamp)));
    assert.ok(Number.isFinite(durationMs) && durationMs >= 0);
    assert.deepEqual(log, {
      level: 'ERROR', event: 'AUTHENTICATION_ERROR', traceId: response.body.traceId,
      method: 'GET', route: '/api/admin', status: 500, errorName: expectedCode ? 'PrismaError' : 'UnexpectedError',
      prismaCode: expectedCode, modelName: 'User', operation: 'findUnique',
    });
    assert.ok(!serialized.includes(privateDetail));
  }
  assert.equal(logger.mock.callCount(), 5);
});

test('authenticate incluye solo marcos verificables de un paquete instalado', async t => {
  const logger = t.mock.method(console, 'error', () => {});
  const runtime = require.resolve('@prisma/client/runtime/client');
  const error = new Error('SELECT private_value');
  error.stack = `Error: ${error.message}\n` +
    `    at async ei.handleRequestError (${runtime}:18:42)\n` +
    `    at secret@example.test (${runtime}:19:43)\n` +
    `    at external (${__filename}:20:44)`;

  const { response } = await invoke(`Bearer ${token()}`, {
    prisma: { user: { findUnique: async () => { throw error; } } },
  });
  const [serialized] = logger.mock.calls[0].arguments;
  const log = JSON.parse(serialized);
  assert.equal(log.traceId, response.body.traceId);
  assert.deepEqual(log.stackFrames, [
    { function: 'handleRequestError', file: '@prisma/client/runtime/client.js', line: 18, column: 42 },
    { function: '<anonymous>', file: '@prisma/client/runtime/client.js', line: 19, column: 43 },
  ]);
  for (const sensitive of ['SELECT private_value', 'secret@example.test', __dirname]) {
    assert.ok(!serialized.includes(sensitive));
  }
});

test('authorize usa el rol persistido y concede o deniega cada rol del MVP', async () => {
  for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
    for (const required of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
      const result = await invoke(`Bearer ${token()}`, {
        prisma: { user: { findUnique: async () => ({ id: userId, role, accountStatus: 'ACTIVE', technician: null }) } },
      });
      let granted = false;
      authorize(required)(result.req, result.response, () => { granted = true; });
      assert.equal(granted, role === required);
      if (!granted) {
        assert.equal(result.response.statusCode, 403);
        assert.equal(result.response.body.type, '/problems/forbidden');
        assert.equal(result.response.contentType, 'application/problem+json');
      }
    }
  }
});

test('authorize permite múltiples roles y deniega ausencia de identidad o lista vacía', async () => {
  const result = await invoke(`Bearer ${token()}`);
  let granted = false;
  authorize('CLIENT', 'TECHNICIAN')(result.req, result.response, () => { granted = true; });
  assert.equal(granted, true);
  authorize()(result.req, result.response, () => assert.fail('Debe denegar'));
  assert.equal(result.response.statusCode, 403);
  authorize('ADMIN')({ headers: {} }, result.response, () => assert.fail('Debe autenticar'));
  assert.equal(result.response.statusCode, 401);
});
