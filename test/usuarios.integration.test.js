const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/index');

function validateIntegrationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Destino de integración no autorizado');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.pathname !== '/urbanfix_s3_test' || url.search || url.hash) {
    throw new Error('Destino de integración no autorizado');
  }
  return value;
}

test('guardas de perfil admiten únicamente el destino PostgreSQL local aislado', () => {
  const allowed = 'postgresql://127.0.0.1:55432/urbanfix_s3_test';
  assert.equal(validateIntegrationUrl(allowed), allowed);
  for (const value of [undefined, '', 'invalid',
    allowed.replace('postgresql:', 'https:'), allowed.replace('127.0.0.1', 'localhost'),
    allowed.replace('55432', '55434'), allowed.replace('urbanfix_s3_test', 'urbanfix_seed_cp3_golden_test'),
    `${allowed}?host=elsewhere`, `${allowed}#fragment`]) {
    assert.throws(() => validateIntegrationUrl(value), /Destino de integración no autorizado/);
  }
});

test('PostgreSQL perfil: HTTP real, permisos, privacidad y rollback de todos los fixtures', {
  skip: process.env.URBANFIX_RUN_DB_TESTS !== '1', timeout: 30000,
}, async t => {
  const connectionString = validateIntegrationUrl(process.env.DATABASE_URL);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const observer = new PrismaClient({ adapter: new PrismaPg({
    connectionString, options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  }) });
  t.after(() => prisma.$disconnect());
  t.after(() => observer.$disconnect());
  const [identity] = await observer.$queryRaw`SELECT current_database() AS database,
    current_schema() AS schema, current_setting('transaction_read_only') AS read_only`;
  assert.deepEqual(identity, { database: 'urbanfix_s3_test', schema: 'public', read_only: 'on' });

  const createdAt = new Date('2026-11-20T10:00:00.123Z');
  const users = ['CLIENT', 'TECHNICIAN', 'ADMIN'].map((role, index) => ({
    id: randomUUID(), name: `Perfil ${role}`, email: `cp3-${randomUUID()}@example.test`,
    role, accountStatus: 'ACTIVE', phone: role === 'ADMIN' ? null : '+5491123456789',
    passwordHash: 'profile-integration-private-hash', createdAt,
    lastLoginAt: index === 1 ? null : new Date('2026-11-25T12:00:00.456Z'),
    isTestUser: index === 1,
  }));
  const ids = users.map(user => user.id);
  const technician = { id: randomUUID(), userId: users[1].id, approvalStatus: 'PENDING' };
  const snapshot = async client => ({
    users: await client.user.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
    technicians: await client.technician.findMany({ where: { userId: { in: ids } }, orderBy: { id: 'asc' } }),
  });
  const initial = await snapshot(observer);
  assert.deepEqual(initial, { users: [], technicians: [] });
  const secret = randomUUID();
  const sign = (user, options = {}) => jwt.sign({ userId: user.id,
    role: user.role === 'CLIENT' ? 'ADMIN' : 'CLIENT' }, secret,
  { algorithm: 'HS256', expiresIn: 3600, ...options });
  const expectedProfile = user => ({
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    role: user.role, accountStatus: user.accountStatus,
    technician: user.role === 'TECHNICIAN'
      ? { id: technician.id, approvalStatus: technician.approvalStatus } : null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null, isTestUser: user.isTestUser,
  });
  const rollback = new Error('Rollback intencional de perfil');

  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const [target] = await tx.$queryRaw`SELECT current_database() AS database, current_schema() AS schema`;
      assert.deepEqual(target, { database: 'urbanfix_s3_test', schema: 'public' });
      await tx.user.createMany({ data: users });
      await tx.technician.create({ data: technician });
      assert.deepEqual(await snapshot(observer), initial);

      const server = createApp({ prisma: tx, jwtSecret: secret }).listen(0, '127.0.0.1');
      try {
        await once(server, 'listening');
        const request = async (user, method = 'GET', body, authorization = `Bearer ${sign(user)}`) => {
          const response = await fetch(`http://127.0.0.1:${server.address().port}/api/usuarios/me`, {
            method, signal: AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/json',
              ...(authorization === null ? {} : { Authorization: authorization }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          return { status: response.status, contentType: response.headers.get('content-type'),
            body: await response.json() };
        };

        await t.test('GET serializa perfiles y relación real sin campos sensibles ni escrituras', async () => {
          const before = await snapshot(tx);
          for (const user of users) {
            const result = await request(user);
            assert.equal(result.status, 200);
            assert.match(result.contentType, /^application\/json\b/);
            assert.deepEqual(result.body, expectedProfile(user));
          }
          assert.deepEqual(await snapshot(tx), before);
        });

        await t.test('PATCH de nombre respeta los tres roles persistidos y conserva campos omitidos', async () => {
          for (const user of users) {
            const before = await tx.user.findUnique({ where: { id: user.id } });
            const name = `${user.name} actualizado`;
            const result = await request(user, 'PATCH', { name });
            assert.equal(result.status, 200);
            assert.match(result.contentType, /^application\/json\b/);
            user.name = name;
            assert.deepEqual(result.body, expectedProfile(user));
            assert.deepEqual(await tx.user.findUnique({ where: { id: user.id } }), { ...before, name });
          }
        });

        await t.test('PATCH de teléfono solo permite CLIENT y rechaza cambios parciales', async () => {
          const client = users[0];
          const before = await tx.user.findUnique({ where: { id: client.id } });
          const phone = '+5491187654321';
          const result = await request(client, 'PATCH', { phone });
          assert.equal(result.status, 200);
          client.phone = phone;
          assert.deepEqual(result.body, expectedProfile(client));
          assert.deepEqual(await tx.user.findUnique({ where: { id: client.id } }), { ...before, phone });
          for (const user of users.slice(1)) {
            const unchanged = await snapshot(tx);
            const denied = await request(user, 'PATCH', { name: 'No cambiar', phone });
            assert.equal(denied.status, 400);
            assert.match(denied.contentType, /^application\/problem\+json\b/);
            assert.equal(denied.body.type, '/problems/validation-error');
            assert.deepEqual(denied.body.errors, [{ field: 'phone', detail: 'Campo no permitido.' }]);
            assert.deepEqual(await snapshot(tx), unchanged);
          }
        });

        await t.test('payload inválido o con campos internos no modifica ningún registro', async () => {
          for (const body of [{}, { name: '', phone: '+5491123456789' },
            { name: 'No cambiar', phone: '+012' }, { name: 'No cambiar', role: 'ADMIN' }]) {
            const before = await snapshot(tx);
            const result = await request(users[0], 'PATCH', body);
            assert.equal(result.status, 400);
            assert.match(result.contentType, /^application\/problem\+json\b/);
            assert.equal(result.body.type, '/problems/validation-error');
            assert.ok(result.body.errors.length > 0);
            assert.deepEqual(await snapshot(tx), before);
          }
        });

        await t.test('middleware real rechaza JWT ausente, inválido y vencido sin cambios', async () => {
          const before = await snapshot(tx);
          for (const method of ['GET', 'PATCH']) {
            for (const [authorization, type] of [[null, 'authentication-required'],
              ['Bearer invalid', 'invalid-token'], [`Bearer ${sign(users[0], { expiresIn: -1 })}`, 'token-expired']]) {
              const result = await request(users[0], method,
                method === 'PATCH' ? { name: 'No cambiar' } : undefined, authorization);
              assert.equal(result.status, 401);
              assert.match(result.contentType, /^application\/problem\+json\b/);
              assert.equal(result.body.type, `/problems/${type}`);
            }
          }
          assert.deepEqual(await snapshot(tx), before);
        });

        await t.test('middleware consulta el estado real de la cuenta suspendida', async () => {
          await tx.user.update({ where: { id: users[0].id }, data: { accountStatus: 'SUSPENDED' } });
          const before = await snapshot(tx);
          for (const method of ['GET', 'PATCH']) {
            const result = await request(users[0], method, method === 'PATCH' ? { name: 'No cambiar' } : undefined);
            assert.equal(result.status, 403);
            assert.equal(result.body.type, '/problems/account-suspended');
          }
          assert.deepEqual(await snapshot(tx), before);
        });

        assert.deepEqual(await snapshot(observer), initial);
      } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
      throw rollback;
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20000 }), error => error === rollback);
  } finally {
    assert.deepEqual(await snapshot(observer), initial);
    t.diagnostic(JSON.stringify({ event: 'PROFILE_FIXTURES_ROLLED_BACK', users: 0, technicians: 0 }));
  }
});
