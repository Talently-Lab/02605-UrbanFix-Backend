const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PrismaClientKnownRequestError } = require('@prisma/client/runtime/client');
const { logInternalProblem, sendInternalProblem } = require('../src/lib/internal-problem');

function noWriteResponse() {
  const res = { headersSent: true };
  for (const name of ['status', 'type', 'set', 'json', 'send', 'end', 'write']) {
    res[name] = () => assert.fail(`${name} no debe invocarse`);
  }
  return res;
}

function context() {
  return { method: 'POST', route: '/api/auth/register', startedAt: performance.now(),
    databaseOperation: { modelName: 'User', operation: 'create' } };
}

test('logging sin envío conserva diagnóstico reconocido y excluye datos sensibles', t => {
  const logger = t.mock.method(console, 'error', () => {});
  const sensitive = 'private-password-token-sql-url';
  const error = new PrismaClientKnownRequestError(sensitive, {
    code: 'P2004', clientVersion: '7.10.1', meta: { private: sensitive },
  });
  error.stack = `Error: ${sensitive}\n` +
    `    at registerUser (${path.resolve(__dirname, '../src/services/auth.service.js')}:15:7)\n` +
    `    at unknown (${path.resolve(__dirname, '../private-file.js')}:1:1)`;
  const traceId = logInternalProblem(noWriteResponse(), error, context());
  assert.match(traceId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  assert.equal(logger.mock.callCount(), 1);
  const serialized = logger.mock.calls[0].arguments[0];
  const log = JSON.parse(serialized);
  assert.equal(log.traceId, traceId);
  assert.equal(log.prismaCode, 'P2004');
  assert.equal(log.errorName, 'PrismaError');
  assert.equal(log.modelName, 'User');
  assert.equal(log.operation, 'create');
  assert.equal(log.route, '/api/auth/register');
  assert.deepEqual(log.stackFrames, [{ function: 'registerUser', file: 'src/services/auth.service.js', line: 15, column: 7 }]);
  assert.ok(!serialized.includes(sensitive));
  assert.ok(!serialized.includes('private-file'));
  assert.ok(!serialized.includes(__dirname));
  assert.equal(Object.hasOwn(log, 'stack'), false);
  assert.equal(Object.hasOwn(log, 'meta'), false);
});

test('logging deduplica distintos errores por respuesta y separa respuestas diferentes', t => {
  const logger = t.mock.method(console, 'error', () => {});
  const res = noWriteResponse();
  const first = logInternalProblem(res, new Error('first private'), context());
  const second = logInternalProblem(res, new Error('second private'), context());
  assert.equal(first, second);
  assert.equal(logger.mock.callCount(), 1);
  const other = logInternalProblem(noWriteResponse(), new Error('other private'), context());
  assert.notEqual(other, first);
  assert.equal(logger.mock.callCount(), 2);
});

for (const loggerFails of [false, true]) {
  test(`la marca se establece antes de invocar al logger, loggerFails=${loggerFails}`, t => {
    const res = noWriteResponse();
    const nestedIds = [];
    const logger = t.mock.method(console, 'error', () => {
      nestedIds.push(logInternalProblem(res, new Error('nested private'), context()));
      if (loggerFails) throw new Error('private logger failure');
    });
    const traceId = logInternalProblem(res, new Error('first private'), context());
    assert.deepEqual(nestedIds, [traceId]);
    assert.equal(logInternalProblem(res, new Error('later private'), context()), traceId);
    assert.equal(logger.mock.callCount(), 1);
  });
}

test('sendInternalProblem mantiene el 500 normal y comparte traceId con el logging', t => {
  const logger = t.mock.method(console, 'error', () => {});
  const res = { status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; }, json(value) { this.body = value; return this; } };
  sendInternalProblem(res, new Error('private detail'), context());
  assert.equal(res.statusCode, 500);
  assert.equal(res.contentType, 'application/problem+json');
  const traceId = JSON.parse(logger.mock.calls[0].arguments[0]).traceId;
  assert.deepEqual(res.body, { type: '/problems/internal-error', title: 'Error interno', status: 500,
    detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId });
  assert.equal(logInternalProblem(res, new Error('later detail'), context()), traceId);
  assert.equal(logger.mock.callCount(), 1);
});
