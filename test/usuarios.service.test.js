const test = require('node:test');
const assert = require('node:assert/strict');
const { getOwnProfile, updateOwnProfile } = require('../src/services/usuarios.service');

const userId = '11111111-1111-4111-8111-111111111111';
const profileSelect = {
  id: true, name: true, email: true, phone: true, role: true,
  accountStatus: true, lastLoginAt: true, isTestUser: true,
  technician: { select: { id: true, approvalStatus: true } },
};

for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
  for (const approvalStatus of role === 'TECHNICIAN' ? ['PENDING', 'REJECTED', 'APPROVED'] : [null]) {
    test(`GET propio selecciona campos públicos de ${role} ${approvalStatus ?? ''}`, async () => {
      const expected = {
        id: userId, name: 'Ana', email: 'ana@example.test', role,
        phone: role === 'ADMIN' ? null : '+5491123456789',
        accountStatus: 'ACTIVE', lastLoginAt: null, isTestUser: false,
        technician: role === 'TECHNICIAN' ? { id: 'technician-id', approvalStatus } : null,
      };
      const queries = [];
      const prisma = { user: { findUnique: async query => {
        queries.push(query);
        return { ...expected, passwordHash: 'private-hash', createdAt: new Date(),
          ...(expected.technician && { technician: { ...expected.technician, specialties: ['private'] } }) };
      } } };
      assert.deepEqual(await getOwnProfile(userId, { prisma }), expected);
      assert.deepEqual(queries, [{ where: { id: userId }, select: profileSelect }]);
    });
  }
}

test('GET propio conserva la fecha de login y no realiza escrituras', async () => {
  const lastLoginAt = new Date('2026-11-25T12:00:00.123Z');
  const prisma = { user: { findUnique: async () => ({
    id: userId, name: 'Ana', email: 'ana@example.test', phone: '+12', role: 'CLIENT',
    accountStatus: 'ACTIVE', lastLoginAt, isTestUser: true, technician: null,
  }) } };
  const profile = await getOwnProfile(userId, { prisma });
  assert.equal(profile.lastLoginAt, lastLoginAt);
  assert.equal(profile.isTestUser, true);
});

test('GET propio conserva 401 para cuenta eliminada y 403 para suspendida', async () => {
  for (const [account, status, type] of [
    [null, 401, '/problems/invalid-token'],
    [{ accountStatus: 'SUSPENDED' }, 403, '/problems/account-suspended'],
  ]) {
    const prisma = { user: { findUnique: async () => account } };
    await assert.rejects(getOwnProfile(userId, { prisma }),
      error => error.status === status && error.type === type);
  }
});

test('GET propio propaga el error original y registra solo la operación', async () => {
  const original = new Error('private database detail');
  const databaseDiagnostics = new Map();
  const prisma = { user: { findUnique: async () => { throw original; } } };
  await assert.rejects(getOwnProfile(userId, { prisma, databaseDiagnostics }), error => error === original);
  assert.deepEqual(databaseDiagnostics.get(original), { modelName: 'User', operation: 'findUnique' });
});

for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
  test(`PATCH ${role} actualiza solo su nombre con filtro ACTIVE y selección pública`, async () => {
    const user = { id: userId, role, accountStatus: 'ACTIVE' };
    const saved = { ...user, name: 'Anterior', email: 'ana@example.test',
      phone: role === 'ADMIN' ? null : '+5491123456789', lastLoginAt: null, isTestUser: false,
      technician: role === 'TECHNICIAN' ? { id: 'tech-id', approvalStatus: 'REJECTED' } : null };
    const queries = [];
    const prisma = { user: { update: async query => {
      queries.push(query);
      Object.assign(saved, query.data);
      return { ...saved, passwordHash: 'private-hash' };
    } } };
    assert.deepEqual(await updateOwnProfile({ name: 'Nuevo' }, user, { prisma }), { ...saved, name: 'Nuevo' });
    assert.deepEqual(queries, [{ where: { id: userId, accountStatus: 'ACTIVE' },
      data: { name: 'Nuevo' }, select: profileSelect }]);
  });

  test(`PATCH ${role} no consulta ni escribe ante payload inválido o mixto`, async () => {
    const user = { id: userId, role, accountStatus: 'ACTIVE' };
    for (const input of [{}, null, [], { name: ' ' }, { name: 'Nuevo', email: 'private-email' },
      { name: 'Nuevo', id: 'another-user' }, { name: 'Nuevo', phone: role === 'CLIENT' ? null : '+12' }]) {
      await assert.rejects(updateOwnProfile(input, user, { prisma: null }),
        error => error.status === 400 && error.type === '/problems/validation-error');
    }
  });
}

test('PATCH CLIENT actualiza teléfono solo o junto con nombre sin tocar campos omitidos', async () => {
  for (const input of [{ phone: '+12' }, { name: 'Nuevo', phone: '+123456789012345' }]) {
    const user = { id: userId, role: 'CLIENT', accountStatus: 'ACTIVE' };
    const saved = { ...user, name: 'Anterior', email: 'ana@example.test', phone: '+5491123456789',
      technician: null, lastLoginAt: null, isTestUser: false };
    let writes = 0;
    const prisma = { user: { update: async query => {
      writes++;
      assert.deepEqual(query.data, input);
      Object.assign(saved, query.data);
      return saved;
    } } };
    assert.deepEqual(await updateOwnProfile(input, user, { prisma }), saved);
    assert.equal(writes, 1);
  }
});

test('PATCH sin coincidencia distingue eliminación y suspensión sin reintentar ni escribir parcialmente', async () => {
  for (const [account, status, type] of [
    [null, 401, '/problems/invalid-token'],
    [{ id: userId }, 403, '/problems/account-suspended'],
  ]) {
    const queries = [];
    const prisma = { user: {
      update: async query => { queries.push(['update', query]); throw Object.assign(new Error('not found'), { code: 'P2025' }); },
      findUnique: async query => { queries.push(['findUnique', query]); return account; },
    } };
    await assert.rejects(updateOwnProfile({ name: 'Nuevo' }, { id: userId, role: 'CLIENT', accountStatus: 'ACTIVE' }, { prisma }),
      error => error.status === status && error.type === type);
    assert.deepEqual(queries.map(([operation]) => operation), ['update', 'findUnique']);
    assert.deepEqual(queries[0][1].where, { id: userId, accountStatus: 'ACTIVE' });
    assert.deepEqual(queries[1][1], { where: { id: userId }, select: { id: true } });
  }
});

test('PATCH propaga otros errores y conserva diagnóstico cerrado de la operación', async () => {
  const original = Object.assign(new Error('private SQL detail'), { code: 'P2004' });
  const databaseDiagnostics = new Map();
  const prisma = { user: { update: async () => { throw original; } } };
  await assert.rejects(updateOwnProfile({ name: 'Nuevo' }, { id: userId, role: 'CLIENT', accountStatus: 'ACTIVE' },
    { prisma, databaseDiagnostics }), error => error === original);
  assert.deepEqual(databaseDiagnostics.get(original), { modelName: 'User', operation: 'update' });
});
