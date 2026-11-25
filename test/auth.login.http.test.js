const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');

async function setup(t, {
  status = 'ACTIVE', missing = false, secret = 'http-test-secret', fail = false,
  registrationError, technicianError, updateError, transactionStartError, transactionCommitError,
} = {}) {
  const writes = [];
  const user = { id: 'user-id', name: 'Ana', email: 'ana@example.com', role: 'CLIENT',
    accountStatus: status, technician: null, lastLoginAt: null, isTestUser: false,
    passwordHash: await bcrypt.hash('password123', 4) };
  const prisma = { user: {
    findFirst: async () => { if (fail) throw new Error('sensitive database details'); return missing ? null : user; },
    update: async query => {
      if (updateError) throw updateError;
      writes.push(query);
      return user;
    },
    create: async ({ data }) => {
      if (registrationError) throw registrationError;
      return { id: 'registered-id', ...data, accountStatus: 'ACTIVE', lastLoginAt: null, isTestUser: false };
    },
  } };
  prisma.$transaction = async callback => {
    if (transactionStartError) throw transactionStartError;
    const result = await callback({
      user: prisma.user,
      technician: { create: async ({ data }) => {
        if (technicianError) throw technicianError;
        return { id: 'registered-technician-id', ...data };
      } },
    });
    if (transactionCommitError) throw transactionCommitError;
    return result;
  };
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

test('HTTP login conserva el 500 contractual aunque falle el logger', async t => {
  const logger = t.mock.method(console, 'error', () => { throw new Error('Logger no disponible'); });
  const { post, writes } = await setup(t, { fail: true });
  const response = await post({ email: 'ana@example.com', password: 'password123' });

  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  const body = await response.json();
  assert.match(body.traceId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  assert.deepEqual(body, {
    type: '/problems/internal-error', title: 'Error interno', status: 500,
    detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId: body.traceId,
  });
  assert.equal(logger.mock.callCount(), 1);
  const [serialized] = logger.mock.calls[0].arguments;
  const log = JSON.parse(serialized);
  assert.equal(log.traceId, body.traceId);
  assert.equal(log.level, 'ERROR');
  assert.equal(log.event, 'API_INTERNAL_ERROR');
  assert.equal(log.method, 'POST');
  assert.equal(log.route, '/api/auth/login');
  assert.equal(log.status, 500);
  assert.ok(Number.isFinite(Date.parse(log.timestamp)));
  assert.ok(Number.isFinite(log.durationMs) && log.durationMs >= 0);
  assert.equal(log.errorName, 'UnexpectedError');
  assert.equal(log.prismaCode, null);
  assert.ok(log.stackFrames.some(frame => frame.function === 'loginUser' &&
    frame.file === 'src/services/auth.service.js' && frame.line > 0 && frame.column > 0));
  for (const sensitive of ['sensitive database details', 'ana@example.com', 'password123', __dirname]) {
    assert.ok(!serialized.includes(sensitive));
  }
  assert.equal(writes.length, 0);
});

const clientRegistration = {
  name: 'Ana', email: 'ana@example.com', password: 'password123', role: 'CLIENT', phone: '+5491123456789',
};

const credentials = { email: clientRegistration.email, password: clientRegistration.password };
const technicianRegistration = {
  name: 'Ana', ...credentials, role: 'TECHNICIAN', phone: clientRegistration.phone, specialties: [{ category: 'PLUMBING' }],
  neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
};

test('HTTP registro TECHNICIAN rechaza teléfono ausente o inválido con RFC 9457', async t => {
  const { post } = await setup(t);
  const { phone, ...withoutPhone } = technicianRegistration;
  for (const input of [withoutPhone, ...[null, '', ' ', '+012', '+54 91123456789']
    .map(value => ({ ...technicianRegistration, phone: value }))]) {
    const response = await post(input, '/api/auth/register');
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
    assert.deepEqual(await response.json(), {
      type: '/problems/validation-error', title: 'Datos inválidos', status: 400,
      detail: 'Revisá los campos indicados.',
      errors: [{ field: 'phone', detail: 'Teléfono internacional obligatorio' }],
    });
  }
});

test('HTTP registro ADMIN conserva la prohibición de registro público', async t => {
  const { post } = await setup(t);
  const response = await post({ ...clientRegistration, role: 'ADMIN' }, '/api/auth/register');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), {
    type: '/problems/validation-error', title: 'Datos inválidos', status: 400,
    detail: 'Revisá los campos indicados.',
    errors: [{ field: 'role', detail: 'Rol no permitido para registro público' }],
  });
});

for (const [label, options, request, modelName, operation] of [
  ['User.findFirst', { fail: true }, credentials, 'User', 'findFirst'],
  ['User.update', { updateError: new Error('write failure') }, credentials, 'User', 'update'],
  ['User.create', { registrationError: new Error('create failure') }, clientRegistration, 'User', 'create'],
  ['Technician.create', { technicianError: new Error('create failure') }, technicianRegistration, 'Technician', 'create'],
  ['firma JWT', { secret: '' }, credentials],
  ['bcrypt', {}, credentials],
  ['inicio de transacción', { transactionStartError: new Error('transaction start failure') }, technicianRegistration],
  ['commit de transacción', { transactionCommitError: new Error('transaction commit failure') }, technicianRegistration],
]) {
  test(`HTTP diagnóstico atribuye correctamente el fallo de ${label}`, async t => {
    const logger = t.mock.method(console, 'error', () => {});
    const { post } = await setup(t, options);
    if (label === 'bcrypt') {
      t.mock.method(bcrypt, 'compare', async () => { throw new Error('bcrypt failure'); });
    }
    const response = await post(request, request.role ? '/api/auth/register' : '/api/auth/login');
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.type, '/problems/internal-error');
    assert.equal(logger.mock.callCount(), 1);
    const log = JSON.parse(logger.mock.calls[0].arguments[0]);
    assert.equal(log.traceId, body.traceId);
    assert.equal(log.modelName, modelName);
    assert.equal(log.operation, operation);
  });
}

test('HTTP registro devuelve 404 sin detalles internos para la FK de barrio', async t => {
  const technicianError = Object.assign(new Error('Detalle interno de Prisma'), {
    code: 'P2003', meta: { modelName: 'Technician', driverAdapterError: {
      cause: { constraint: { index: 'TechnicianNeighborhood_neighborhoodId_fkey' } },
    } },
  });
  const { post } = await setup(t, { technicianError });
  const input = clientRegistration;
  const response = await post({ ...input, role: 'TECHNICIAN', specialties: [{ category: 'PLUMBING' }],
    neighborhoodIds: ['11111111-1111-4111-8111-111111111111'] }, '/api/auth/register');
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), {
    type: '/problems/not-found', title: 'Recurso no encontrado', status: 404,
    detail: 'El recurso solicitado no está disponible.',
  });
});

test('HTTP registro informa el campo email cuando contiene mayúsculas', async t => {
  const { post } = await setup(t);
  const response = await post({ ...clientRegistration, email: 'Ana@example.com' }, '/api/auth/register');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), {
    type: '/problems/validation-error', title: 'Datos inválidos', status: 400,
    detail: 'Revisá el campo email.',
    errors: [{ field: 'email', detail: 'El email debe enviarse únicamente en minúsculas.' }],
  });
});

test('HTTP registro informa la ruta de la matrícula faltante', async t => {
  const { post } = await setup(t);
  const input = clientRegistration;
  const response = await post({ ...input, role: 'TECHNICIAN', specialties: [{ category: 'GAS' }],
    neighborhoodIds: ['11111111-1111-4111-8111-111111111111'] }, '/api/auth/register');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), {
    type: '/problems/validation-error', title: 'Datos inválidos', status: 400,
    detail: 'Revisá los campos indicados.',
    errors: [{ field: 'specialties[0].licenseNumber', detail: 'La especialidad requiere matrícula' }],
  });
});

test('HTTP registro distingue JSON malformado de datos inválidos', async t => {
  const { post } = await setup(t);
  const response = await post('{', '/api/auth/register');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  assert.deepEqual(await response.json(), {
    type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
    detail: 'El cuerpo de la petición debe contener JSON válido',
  });
});

for (const index of ['User_email_key', 'User_email_case_insensitive']) {
  test(`HTTP registro devuelve el problema 409 para ${index}`, async t => {
    const registrationError = Object.assign(new Error('Error simulado de unicidad'), {
      code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { index } } } },
    });
    const { post } = await setup(t, { registrationError });
    const response = await post(clientRegistration, '/api/auth/register');
    assert.equal(response.status, 409);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
    assert.deepEqual(await response.json(), {
      type: '/problems/email-already-registered', title: 'Email registrado', status: 409,
      detail: 'Ya existe una cuenta registrada con ese email.',
    });
  });
}

test('HTTP registro correlaciona el 500 con un log seguro aunque falle el logger', async t => {
  const privateDetail = 'detalle interno sensible de Prisma';
  const registrationError = new Error(privateDetail);
  const serviceFile = require.resolve('../src/services/auth.service');
  registrationError.stack = `Error: ${privateDetail}\n` +
    `    at registerUser (${serviceFile}:15:13)\n` +
    `    at ${clientRegistration.email} (${serviceFile}:16:13)\n` +
    `    at external (${__filename}:1:2)`;
  const logs = t.mock.method(console, 'error', () => { throw new Error('Logger no disponible'); });
  const { post } = await setup(t, { registrationError });

  const response = await post(clientRegistration, '/api/auth/register');
  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type'), /^application\/problem\+json\b/);
  const body = await response.json();
  assert.match(body.traceId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  assert.deepEqual(body, {
    type: '/problems/internal-error', title: 'Error interno', status: 500,
    detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId: body.traceId,
  });
  assert.equal(logs.mock.callCount(), 1);
  const [serialized] = logs.mock.calls[0].arguments;
  const log = JSON.parse(serialized);
  assert.equal(log.traceId, body.traceId);
  assert.equal(log.route, '/api/auth/register');
  assert.equal(log.event, 'API_INTERNAL_ERROR');
  assert.equal(log.method, 'POST');
  assert.equal(log.status, 500);
  assert.ok(Number.isFinite(Date.parse(log.timestamp)));
  assert.ok(Number.isFinite(log.durationMs) && log.durationMs >= 0);
  assert.equal(log.errorName, 'UnexpectedError');
  assert.equal(log.prismaCode, null);
  assert.deepEqual(log.stackFrames, [
    { function: 'registerUser', file: 'src/services/auth.service.js', line: 15, column: 13 },
    { function: '<anonymous>', file: 'src/services/auth.service.js', line: 16, column: 13 },
  ]);
  for (const sensitive of [privateDetail, clientRegistration.email, clientRegistration.password, clientRegistration.phone]) {
    assert.ok(!serialized.includes(sensitive));
  }
});

for (const role of ['CLIENT', 'TECHNICIAN']) {
  test(`HTTP registro ${role} devuelve exactamente la identidad aprobada`, async t => {
    const { post } = await setup(t);
    const input = { email: 'ana@example.com', password: 'password123', name: 'Ana', role, phone: clientRegistration.phone,
      ...(role === 'TECHNICIAN' && {
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    };
    const response = await post(input, '/api/auth/register');
    assert.equal(response.status, 201);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await response.json(), {
      id: 'registered-id', name: input.name, email: input.email, role, accountStatus: 'ACTIVE',
      technician: role === 'CLIENT' ? null : { id: 'registered-technician-id', approvalStatus: 'PENDING' },
      lastLoginAt: null, isTestUser: false,
    });
  });
}
