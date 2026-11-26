const test = require('node:test');
const assert = require('node:assert/strict');
const { ServiceCategory } = require('@prisma/client');
const { validateRegistration } = require('../src/validators/auth.validator');
const { listSpecialties, listNeighborhoods } = require('../src/services/catalogos.service');

const specialties = [
  { category: 'ELECTRICITY', name: 'Electricidad', licenseRequired: true },
  { category: 'PLUMBING', name: 'Plomería', licenseRequired: false },
  { category: 'GAS', name: 'Gas', licenseRequired: true },
  { category: 'LOCKSMITH', name: 'Cerrajería', licenseRequired: false },
  { category: 'MASONRY', name: 'Albañilería', licenseRequired: false },
];

test('especialidades devuelve exactamente las cinco entradas y el orden del contrato', () => {
  assert.deepEqual(listSpecialties(), specialties);
});

test('especialidades coincide con ServiceCategory y no necesita Prisma', () => {
  const result = listSpecialties();
  assert.deepEqual(new Set(result.map(item => item.category)), new Set(Object.values(ServiceCategory)));
  assert.equal(result.length, Object.values(ServiceCategory).length);
});

test('especialidades mantiene la coherencia con las validaciones de matrícula de Auth', () => {
  for (const { category, licenseRequired } of listSpecialties()) {
    const input = {
      name: 'Técnico', email: 'catalog-test@example.test', password: 'password123',
      role: 'TECHNICIAN', phone: '+5491123456789', specialties: [{ category }],
      neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
    };
    if (licenseRequired) {
      assert.throws(() => validateRegistration(input), error => error.status === 400 &&
        error.errors[0].field === 'specialties[0].licenseNumber');
    } else {
      assert.doesNotThrow(() => validateRegistration(input));
    }
    assert.doesNotThrow(() => validateRegistration({ ...input, specialties: [{ category, licenseNumber: 'TEST-LICENSE' }] }));
  }
});

test('barrios realiza una sola consulta con selección exclusiva y orden por nombre', async () => {
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Almagro', technicians: ['private'] },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Caballito', requests: ['private'] },
  ];
  const queries = [];
  const prisma = { neighborhood: { findMany: async query => { queries.push(query); return rows; } } };
  assert.deepEqual(await listNeighborhoods({ prisma }), rows.map(({ id, name }) => ({ id, name })));
  assert.deepEqual(queries, [{ select: { id: true, name: true }, orderBy: { name: 'asc' } }]);
});

test('barrios devuelve un array vacío si no hay registros', async () => {
  let calls = 0;
  const prisma = { neighborhood: { findMany: async () => { calls++; return []; } } };
  assert.deepEqual(await listNeighborhoods({ prisma }), []);
  assert.equal(calls, 1);
});

test('barrios mantiene una sola consulta para un catálogo grande sin N+1', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `Barrio ${index}`,
  }));
  let calls = 0;
  const prisma = { neighborhood: { findMany: async () => { calls++; return rows; } } };
  assert.deepEqual(await listNeighborhoods({ prisma }), rows);
  assert.equal(calls, 1);
});

test('barrios propaga el error original para que el router lo trate de forma segura', async () => {
  const original = new Error('private database detail');
  const prisma = { neighborhood: { findMany: async () => { throw original; } } };
  await assert.rejects(listNeighborhoods({ prisma }), error => error === original);
});
