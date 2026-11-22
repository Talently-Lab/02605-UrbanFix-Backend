const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { registerUser } = require('../src/services/auth.service');

test('revierte el registro de TECHNICIAN si falla la relación con un barrio', async () => {
  const connectionString = process.env.DATABASE_URL;

  assert.ok(connectionString, 'DATABASE_URL debe estar configurada');

  const url = new URL(connectionString);

  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/urbanfix_p2002_test');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  const email = `rollback-${randomUUID()}@example.test`;
  const neighborhoodId = randomUUID();

  try {
    const input = {
      name: 'Prueba de rollback',
      email,
      password: 'password123',
      role: 'TECHNICIAN',
      specialties: [{ category: 'PLUMBING' }],
      neighborhoodIds: [neighborhoodId],
    };

    // Garantiza que el barrio utilizado no existe.
    const existingNeighborhood = await prisma.neighborhood.findUnique({
      where: { id: neighborhoodId },
      select: { id: true },
    });

    assert.equal(existingNeighborhood, null);

    let transactionError;

    try {
      await registerUser(input, {
        prisma,
        hashPassword: async () => 'hash-simulado',
      });
    } catch (error) {
      transactionError = error;
    }

    // La operación debe fallar por integridad referencial,
    // no por una validación previa del formulario.
    assert.ok(transactionError, 'La transacción debía fallar');
    assert.equal(transactionError.code, 'P2003');

    // El usuario creado dentro de la transacción
    // no debe permanecer en PostgreSQL.
    const persistedUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    assert.equal(
      persistedUser,
      null,
      'El usuario no debe persistir después del rollback',
    );
  } finally {
    await prisma.$disconnect();
  }
});
