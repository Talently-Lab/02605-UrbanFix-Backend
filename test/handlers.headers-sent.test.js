const test = require('node:test');
const assert = require('node:assert/strict');
const { handleLoginError, handleRegistrationError } = require('../src/routes/auth.routes');
const { handleProfileError } = require('../src/routes/usuarios.routes');
const { problemHandler } = require('../src/middleware/problem.middleware');
const { PrismaClientKnownRequestError } = require('@prisma/client/runtime/client');

const handlers = [
  ['login', handleLoginError, 'POST', '/api/auth/login', 'authStartedAt', 'findFirst'],
  ['registro', handleRegistrationError, 'POST', '/api/auth/register', 'authStartedAt', 'create'],
  ['perfil GET', handleProfileError,
    'GET', '/api/usuarios/me', 'profileStartedAt', 'findUnique'],
  ['perfil PATCH', handleProfileError,
    'PATCH', '/api/usuarios/me', 'profileStartedAt', 'update'],
];

test('los tres handlers conservan la firma de cuatro argumentos de Express', () => {
  for (const handler of [handleLoginError, handleRegistrationError, handleProfileError]) {
    assert.equal(handler.length, 4);
  }
});

for (const [label, handler, method, route, timer, operationName] of handlers) {
  test(`${label}: headers enviados delega el original sin respuesta ni logging local`, t => {
    const logger = t.mock.method(console, 'error', () => {});
    for (const properties of [
      {}, { status: 400, type: '/problems/validation-error', errors: [{ field: 'name', detail: 'invalid' }] },
      { status: 401, type: '/problems/invalid-token' }, { status: 403, type: '/problems/account-suspended' },
      { status: 404, type: '/problems/not-found' }, { status: 409, type: '/problems/email-already-registered' },
      { status: 413, type: 'entity.too.large' }, { status: 415, type: 'encoding.unsupported' },
    ]) {
      const original = Object.assign(new Error('private-detail'), properties);
      const operation = { modelName: 'User', operation: operationName };
      const res = { headersSent: true, locals: { [timer]: 123,
        databaseDiagnostics: new Map([[original, operation]]) } };
      for (const name of ['status', 'type', 'set', 'json', 'send', 'end']) {
        res[name] = () => assert.fail(`${name} no debe invocarse`);
      }
      const delegated = [];
      handler(original, { method, originalUrl: '/private-url?secret=value' }, res, error => delegated.push(error));
      assert.deepEqual(delegated, [original]);
      assert.equal(delegated[0], original);
      assert.deepEqual(res.locals.internalProblemContext, {
        method, route, startedAt: 123, databaseOperation: operation,
      });
    }
    assert.equal(logger.mock.callCount(), 0);
  });

  test(`${label}: la cadena local-global conserva el original y emite un diagnóstico seguro`, t => {
    const logger = t.mock.method(console, 'error', () => {});
    const original = new PrismaClientKnownRequestError('private-password-sql-url', {
      code: 'P2004', clientVersion: '7.10.1', meta: { modelName: 'private-model' },
    });
    const res = { headersSent: true, locals: { [timer]: performance.now(),
      databaseDiagnostics: new Map([[original, { modelName: 'User', operation: operationName }]]) } };
    for (const name of ['status', 'type', 'set', 'json', 'send', 'end', 'write']) res[name] = () => assert.fail('No debe escribir');
    const req = { method, originalUrl: '/private-path?token=private-token' };
    const delegated = [];
    handler(original, req, res, error => {
      assert.equal(error, original);
      problemHandler(error, req, res, safeError => delegated.push(safeError));
    });
    assert.equal(delegated.length, 1);
    assert.notEqual(delegated[0], original);
    assert.equal(delegated[0].message, 'No pudimos completar la operación.');
    assert.equal(delegated[0].stack, undefined);
    assert.equal(logger.mock.callCount(), 1);
    const serialized = logger.mock.calls[0].arguments[0];
    const log = JSON.parse(serialized);
    assert.equal(log.method, method);
    assert.equal(log.route, route);
    assert.equal(log.prismaCode, 'P2004');
    assert.equal(log.modelName, 'User');
    assert.equal(log.operation, operationName);
    assert.ok(!serialized.includes('private-'));
  });

  test(`${label}: contexto incompleto conserva y delega el original sin escribir`, t => {
    const logger = t.mock.method(console, 'error', () => {});
    for (const locals of [undefined, {}, { databaseDiagnostics: null },
      { databaseDiagnostics: null, [timer]: NaN, problemStartedAt: Infinity },
      { [timer]: Infinity, problemStartedAt: NaN }]) {
      const original = Object.assign(new Error('private-detail'), { meta: { modelName: 'private-model', operation: 'private-operation' } });
      const res = { headersSent: true, ...(locals !== undefined && { locals }) };
      for (const name of ['status', 'type', 'set', 'json', 'send', 'end', 'write']) res[name] = () => assert.fail('No debe escribir');
      const delegated = [];
      assert.doesNotThrow(() => handler(original, { method }, res, error => delegated.push(error)));
      assert.deepEqual(delegated, [original]);
      assert.equal(delegated[0], original);
      assert.equal(res.locals.internalProblemContext.method, method);
      assert.equal(res.locals.internalProblemContext.route, route);
      assert.equal(res.locals.internalProblemContext.databaseOperation, undefined);
      assert.ok(Number.isFinite(res.locals.internalProblemContext.startedAt));
    }
    assert.equal(logger.mock.callCount(), 0);
  });

  test(`${label}: tiempo local finito, luego global finito y finalmente performance.now`, () => {
    const now = performance.now();
    const cases = [
      [{ [timer]: now - 10, problemStartedAt: now - 20 }, now - 10],
      [{ problemStartedAt: now - 20 }, now - 20],
      [{ [timer]: NaN, problemStartedAt: now - 20 }, now - 20],
      [{ [timer]: Infinity, problemStartedAt: now - 20 }, now - 20],
      [{ [timer]: -Infinity, problemStartedAt: now - 20 }, now - 20],
      [{ [timer]: '123', problemStartedAt: now - 20 }, now - 20],
      [{ [timer]: NaN, problemStartedAt: Infinity }, null],
    ];
    for (const [times, expected] of cases) {
      const res = { headersSent: true, locals: { ...times, databaseDiagnostics: new Map() } };
      const before = performance.now();
      handler(new Error('private-detail'), { method }, res, () => {});
      const startedAt = res.locals.internalProblemContext.startedAt;
      if (expected === null) assert.ok(startedAt >= before && startedAt <= performance.now());
      else assert.equal(startedAt, expected);
    }
  });

  test(`${label}: 500 con contexto incompleto conserva diagnóstico seguro, correlación y deduplicación`, t => {
    const logger = t.mock.method(console, 'error', () => {});
    for (const locals of [undefined, {}, { databaseDiagnostics: null },
      { databaseDiagnostics: new Map() }, { databaseDiagnostics: new Map(), [timer]: NaN, problemStartedAt: Infinity }]) {
      const original = new PrismaClientKnownRequestError('private-password-sql-url', {
        code: 'P2004', clientVersion: '7.10.1', meta: { modelName: 'private-model', operation: 'private-operation' },
      });
      const res = { ...(locals !== undefined && { locals }),
        status(code) { this.statusCode = code; return this; },
        type(value) { this.contentType = value; return this; },
        json(value) { this.body = value; return this; } };
      const callsBefore = logger.mock.callCount();
      assert.doesNotThrow(() => handler(original, { method }, res, () => assert.fail('Debe responder 500')));
      assert.equal(res.statusCode, 500);
      assert.equal(res.contentType, 'application/problem+json');
      assert.equal(logger.mock.callCount(), callsBefore + 1);
      const serialized = logger.mock.calls.at(-1).arguments[0];
      const log = JSON.parse(serialized);
      assert.deepEqual(res.body, { type: '/problems/internal-error', title: 'Error interno', status: 500,
        detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId: log.traceId });
      assert.equal(log.prismaCode, 'P2004');
      assert.equal(log.method, method);
      assert.equal(log.route, route);
      assert.ok(Number.isFinite(log.durationMs) && log.durationMs >= 0);
      assert.equal(Object.hasOwn(log, 'modelName'), false);
      assert.equal(Object.hasOwn(log, 'operation'), false);
      assert.ok(!serialized.includes('private-'));
      assert.ok(!JSON.stringify(res.body).includes('private-'));
      const originalBody = res.body;
      res.headersSent = true;
      res.status = res.type = res.json = () => assert.fail('No debe responder de nuevo');
      const delegated = [];
      handler(new Error('private-secondary'), { method }, res, error =>
        problemHandler(error, { method }, res, safeError => delegated.push(safeError)));
      assert.equal(delegated.length, 1);
      assert.equal(delegated[0].message, 'No pudimos completar la operación.');
      assert.equal(logger.mock.callCount(), callsBefore + 1);
      assert.equal(res.body, originalBody);
    }
  });
}

test('delegación local no infiere la operación a partir de metadatos arbitrarios', () => {
  const original = Object.assign(new Error('private'), { meta: { modelName: 'private', operation: 'private' } });
  const res = { headersSent: true, locals: { authStartedAt: 123, databaseDiagnostics: new Map() },
    status() { assert.fail('No debe responder'); } };
  handleLoginError(original, { method: 'POST' }, res, error => assert.equal(error, original));
  assert.equal(res.locals.internalProblemContext.databaseOperation, undefined);
});
