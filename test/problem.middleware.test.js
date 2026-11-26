const test = require('node:test');
const assert = require('node:assert/strict');
const { notFound, problemHandler } = require('../src/middleware/problem.middleware');
const { sendInternalProblem } = require('../src/lib/internal-problem');
const { PrismaClientKnownRequestError } = require('@prisma/client/runtime/client');

function response() {
  return { locals: { problemStartedAt: performance.now() },
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    json(value) { this.body = value; return this; } };
}

test('404 global utiliza el contrato sin incluir la URL recibida', () => {
  const res = response();
  notFound({ originalUrl: '/private-value?token=private-token' }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.contentType, 'application/problem+json');
  assert.deepEqual(res.body, { type: '/problems/not-found', title: 'Recurso no encontrado',
    status: 404, detail: 'El recurso solicitado no está disponible.' });
});

test('400 global reconoce JSON malformado y excluye el body y el mensaje del parser', () => {
  const res = response();
  problemHandler(Object.assign(new SyntaxError('private-input'), {
    status: 400, type: 'entity.parse.failed', body: 'private-input',
  }), { method: 'POST' }, res, () => assert.fail('No debe delegar'));
  assert.equal(res.statusCode, 400);
  assert.equal(res.contentType, 'application/problem+json');
  assert.deepEqual(res.body, { type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
    detail: 'El cuerpo de la petición debe contener JSON válido' });
});

for (const loggerFails of [false, true]) {
  test(`500 global usa traceId y diagnóstico sanitizado, loggerFails=${loggerFails}`, t => {
    const logger = t.mock.method(console, 'error', () => { if (loggerFails) throw new Error('logger failure'); });
    const res = response();
    const sensitive = 'private-password-token-sql';
    problemHandler(Object.assign(new Error(sensitive), { status: 409, meta: { secret: sensitive } }), {
      method: 'POST', originalUrl: `/${sensitive}?secret=${sensitive}`, route: { path: sensitive },
    }, res, () => assert.fail('No debe delegar'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.contentType, 'application/problem+json');
    assert.match(res.body.traceId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    assert.deepEqual(res.body, { type: '/problems/internal-error', title: 'Error interno', status: 500,
      detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId: res.body.traceId });
    assert.equal(logger.mock.callCount(), 1);
    const serialized = logger.mock.calls[0].arguments[0];
    const log = JSON.parse(serialized);
    assert.equal(log.traceId, res.body.traceId);
    assert.equal(log.route, '/*');
    assert.equal(log.method, 'POST');
    assert.equal(Object.hasOwn(log, 'modelName'), false);
    assert.equal(Object.hasOwn(log, 'operation'), false);
    assert.ok(Number.isFinite(log.durationMs) && log.durationMs >= 0);
    for (const output of [JSON.stringify(res.body), serialized]) {
      assert.ok(!output.includes(sensitive));
      assert.ok(!output.includes(__dirname));
    }
  });
}

test('headers enviados: delega un error seguro sin escribir ni filtrar el error al logger de Express', t => {
  t.mock.method(console, 'error', () => {});
  const original = Object.assign(new Error('private-secret'), { status: 500, body: 'private-body' });
  const res = { headersSent: true, status() { assert.fail('No debe escribir'); }, json() { assert.fail('No debe escribir'); } };
  let delegated;
  problemHandler(original, { method: 'GET' }, res, error => { delegated = error; });
  assert.ok(delegated instanceof Error);
  assert.equal(delegated.message, 'No pudimos completar la operación.');
  assert.equal(delegated.stack, undefined);
  assert.equal(delegated.body, undefined);
  assert.ok(!String(delegated).includes('private-'));
});

for (const loggerFails of [false, true]) {
  test(`headers enviados registra el original con contexto confiable y deduplica, loggerFails=${loggerFails}`, t => {
    const logger = t.mock.method(console, 'error', () => { if (loggerFails) throw new Error('private logger failure'); });
    const original = new PrismaClientKnownRequestError('private-secret', { code: 'P2004', clientVersion: '7.10.1' });
    const res = { headersSent: true, locals: { internalProblemContext: {
      method: 'PATCH', route: '/api/usuarios/me', startedAt: performance.now(),
      databaseOperation: { modelName: 'User', operation: 'update' },
    } } };
    for (const name of ['status', 'type', 'set', 'json', 'send', 'end', 'write']) res[name] = () => assert.fail('No debe escribir');
    const delegated = [];
    const req = { method: 'PATCH', originalUrl: '/private-url?token=private-token', route: { path: 'private-path' } };
    problemHandler(original, req, res, error => delegated.push(error));
    problemHandler(new Error('private secondary error'), req, res, error => delegated.push(error));
    assert.equal(delegated.length, 2);
    assert.ok(delegated.every(error => error.message === 'No pudimos completar la operación.' && error.stack === undefined));
    assert.equal(logger.mock.callCount(), 1);
    const serialized = logger.mock.calls[0].arguments[0];
    const log = JSON.parse(serialized);
    assert.equal(log.prismaCode, 'P2004');
    assert.equal(log.route, '/api/usuarios/me');
    assert.equal(log.method, 'PATCH');
    assert.equal(log.modelName, 'User');
    assert.equal(log.operation, 'update');
    assert.ok(log.traceId);
    assert.ok(!serialized.includes('private-'));
  });
}

test('headers enviados después de un 500 ya registrado conserva el traceId sin otro log', t => {
  const logger = t.mock.method(console, 'error', () => {});
  const res = response();
  sendInternalProblem(res, new Error('first private'), { method: 'POST', route: '/api/auth/login', startedAt: performance.now() });
  const originalBody = res.body;
  res.headersSent = true;
  res.status = res.type = res.json = () => assert.fail('No debe volver a responder');
  problemHandler(new Error('secondary private'), { method: 'POST' }, res, () => {});
  assert.equal(logger.mock.callCount(), 1);
  assert.equal(res.body, originalBody);
  assert.equal(JSON.parse(logger.mock.calls[0].arguments[0]).traceId, res.body.traceId);
});

for (const [type, status, expected] of [
  ['entity.too.large', 413, { type: '/problems/payload-too-large', title: 'Solicitud demasiado grande',
    status: 413, detail: 'El cuerpo de la solicitud supera el tamaño máximo permitido.' }],
  ...['encoding.unsupported', 'charset.unsupported'].map(type => [type, 415, {
    type: '/problems/unsupported-media-type', title: 'Formato no soportado', status: 415,
    detail: 'El formato o la codificación de la solicitud no están soportados.',
  }]),
]) {
  test(`parser ${type} conserva ${status} sin exponer mensajes ni registrar un 500`, t => {
    const logger = t.mock.method(console, 'error', () => {});
    const res = response();
    problemHandler(Object.assign(new Error('private-parser-detail'), { type, status, body: 'private-body' }),
      { method: 'POST' }, res, () => assert.fail('No debe delegar'));
    assert.equal(res.statusCode, status);
    assert.equal(res.contentType, 'application/problem+json');
    assert.deepEqual(res.body, expected);
    assert.equal(logger.mock.callCount(), 0);
  });
}

test('el handler no confunde status o mensajes arbitrarios con errores reconocidos del parser', t => {
  t.mock.method(console, 'error', () => {});
  for (const properties of [{ status: 413 }, { status: 415, type: 'unknown' },
    { status: 400, type: 'entity.too.large' }, { status: 500, type: 'encoding.unsupported' }]) {
    const res = response();
    problemHandler(Object.assign(new Error('entity.too.large encoding.unsupported'), properties), { method: 'POST' }, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.type, '/problems/internal-error');
  }
});
