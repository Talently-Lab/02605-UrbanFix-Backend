const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { registerUser, loginUser } = require('../src/services/auth.service');

function validateIntegrationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Destino de integración no autorizado');
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55432' ||
    url.pathname !== '/urbanfix_s3_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Destino de integración no autorizado');
  }
  return value;
}

function createIntegrationClient() {
  assert.equal(
    process.env.URBANFIX_RUN_DB_TESTS,
    '1',
    'Integración deshabilitada',
  );
  const connectionString = validateIntegrationUrl(process.env.DATABASE_URL);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

test('guardas de integración aceptan únicamente el destino aislado sin parámetros alternativos', () => {
  const allowed = 'postgresql://test:test@127.0.0.1:55432/urbanfix_s3_test';
  assert.equal(validateIntegrationUrl(allowed), allowed);
  for (const value of [
    undefined,
    '',
    'invalid',
    allowed.replace('127.0.0.1', 'localhost'),
    allowed.replace('55432', '5432'),
    allowed.replace('urbanfix_s3_test', 'urbanfix_2605'),
    allowed.replace('postgresql:', 'https:'),
    `${allowed}?host=elsewhere`,
    `${allowed}#fragment`,
  ]) {
    assert.throws(
      () => validateIntegrationUrl(value),
      /Destino de integración no autorizado/,
    );
  }
});

test(
  'revierte el registro de TECHNICIAN si falla la relación con un barrio',
  {
    skip: process.env.URBANFIX_RUN_DB_TESTS !== '1',
  },
  async () => {
    const prisma = createIntegrationClient();

    const email = `rollback-${randomUUID()}@example.test`;
    const neighborhoodId = randomUUID();

    try {
      const input = {
        name: 'Prueba de rollback',
        email,
        password: 'password123',
        role: 'TECHNICIAN',
        phone: '+5491123456789',
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: [neighborhoodId],
      };

      // Garantiza que el barrio utilizado no existe.
      const existingNeighborhood = await prisma.neighborhood.findUnique({
        where: { id: neighborhoodId },
        select: { id: true },
      });

      assert.equal(existingNeighborhood, null);

      await assert.rejects(
        registerUser(input, {
          prisma,
          hashPassword: async () => 'hash-simulado',
        }),
        (error) => error.status === 404 && error.type === '/problems/not-found',
      );

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
  },
);

test(
  'integración de registro, login y restricciones de PostgreSQL',
  {
    skip: process.env.URBANFIX_RUN_DB_TESTS !== '1',
  },
  async (t) => {
    const prisma = createIntegrationClient();
    t.after(() => prisma.$disconnect());
    const password = 'IntegrationPassword123!';
    const secret = 'integration-jwt-key-only';
    const registration = {
      prisma,
      hashPassword: (value) => bcrypt.hash(value, 10),
    };
    const login = {
      prisma,
      comparePassword: bcrypt.compare,
      signToken: (claims) =>
        jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: 3600 }),
    };
    const clientInput = () => ({
      name: 'Integration CLIENT',
      email: `s3-${randomUUID()}@example.test`,
      password,
      role: 'CLIENT',
      phone: '+5491123456789',
    });

    await t.test(
      'CLIENT persiste hash y defaults y responde conforme al contrato',
      async () => {
        const input = clientInput();
        const result = await registerUser(input, registration);
        const saved = await prisma.user.findUnique({
          where: { id: result.id },
        });
        assert.ok(saved);
        assert.equal(saved.phone, input.phone);
        assert.equal(saved.accountStatus, 'ACTIVE');
        assert.equal(saved.lastLoginAt, null);
        assert.equal(saved.isTestUser, false);
        assert.notEqual(saved.passwordHash, password);
        assert.equal(await bcrypt.compare(password, saved.passwordHash), true);
        assert.deepEqual(result, {
          id: saved.id,
          name: input.name,
          email: input.email,
          role: 'CLIENT',
          accountStatus: 'ACTIVE',
          technician: null,
          lastLoginAt: null,
          isTestUser: false,
        });
      },
    );

    await t.test(
      'TECHNICIAN persiste perfil y relaciones atómicamente y responde conforme al contrato',
      async () => {
        const neighborhood = await prisma.neighborhood.create({
          data: { name: `S3-${randomUUID()}`, comuna: 1 },
        });
        const input = {
          name: 'Integration TECHNICIAN',
          email: `s3-${randomUUID()}@example.test`,
          password,
          role: 'TECHNICIAN',
          specialties: [
            { category: 'GAS', licenseNumber: 'S3-LICENSE' },
            { category: 'PLUMBING' },
          ],
          phone: '+5491123456789',
          neighborhoodIds: [neighborhood.id],
        };
        const result = await registerUser(input, registration);
        const saved = await prisma.user.findUnique({
          where: { id: result.id },
          include: {
            technician: { include: { specialties: true, neighborhoods: true } },
          },
        });
        assert.equal(saved.phone, input.phone);
        assert.equal(saved.accountStatus, 'ACTIVE');
        assert.equal(saved.lastLoginAt, null);
        assert.equal(saved.isTestUser, false);
        assert.equal(await bcrypt.compare(password, saved.passwordHash), true);
        assert.equal(saved.technician.approvalStatus, 'PENDING');
        assert.deepEqual(
          saved.technician.specialties
            .map((item) => ({
              category: item.category,
              licenseNumber: item.licenseNumber,
            }))
            .sort((a, b) => a.category.localeCompare(b.category)),
          [
            { category: 'GAS', licenseNumber: 'S3-LICENSE' },
            { category: 'PLUMBING', licenseNumber: null },
          ],
        );
        assert.deepEqual(
          saved.technician.neighborhoods.map((item) => item.neighborhoodId),
          [neighborhood.id],
        );
        assert.deepEqual(result, {
          id: saved.id,
          name: input.name,
          email: input.email,
          role: 'TECHNICIAN',
          accountStatus: 'ACTIVE',
          technician: { id: saved.technician.id, approvalStatus: 'PENDING' },
          lastLoginAt: null,
          isTestUser: false,
        });
      },
    );

    await t.test(
      'login verifica bcrypt, JWT y persiste cada fecha devolviendo la anterior',
      async () => {
        const input = clientInput();
        const account = await registerUser(input, registration);
        const firstDate = new Date('2026-11-20T10:00:00.123Z');
        const secondDate = new Date('2026-11-20T11:00:00.456Z');
        const credentials = { email: input.email, password };
        const first = await loginUser(credentials, {
          ...login,
          now: () => firstDate,
        });
        assert.equal(first.user.lastLoginAt, null);
        const savedFirst = await prisma.user.findUnique({
          where: { id: account.id },
        });
        assert.deepEqual(savedFirst.lastLoginAt, firstDate);
        const second = await loginUser(credentials, {
          ...login,
          now: () => secondDate,
        });
        assert.deepEqual(second.user.lastLoginAt, firstDate);
        const savedSecond = await prisma.user.findUnique({
          where: { id: account.id },
        });
        assert.deepEqual(savedSecond.lastLoginAt, secondDate);
        assert.deepEqual(Object.keys(second.user).sort(), [
          'accountStatus',
          'email',
          'id',
          'isTestUser',
          'lastLoginAt',
          'name',
          'role',
          'technician',
        ]);
        const claims = jwt.verify(second.accessToken, secret, {
          algorithms: ['HS256'],
        });
        assert.equal(claims.userId, account.id);
        assert.equal(claims.role, 'CLIENT');
        assert.equal(claims.exp - claims.iat, 3600);
        assert.equal(second.tokenType, 'Bearer');
        assert.equal(second.expiresIn, 3600);
      },
    );

    await t.test(
      'credenciales incorrectas y suspensión conservan lastLoginAt',
      async () => {
        const input = clientInput();
        const account = await registerUser(input, registration);
        const previous = new Date('2026-11-20T09:00:00.123Z');
        await prisma.user.update({
          where: { id: account.id },
          data: { lastLoginAt: previous },
        });
        for (const email of [
          input.email,
          `missing-${randomUUID()}@example.test`,
        ]) {
          await assert.rejects(
            loginUser({ email, password: 'incorrect' }, login),
            (error) =>
              error.status === 401 &&
              error.type === '/problems/invalid-credentials',
          );
        }
        await prisma.user.update({
          where: { id: account.id },
          data: { accountStatus: 'SUSPENDED' },
        });
        await assert.rejects(
          loginUser({ email: input.email, password }, login),
          (error) =>
            error.status === 403 &&
            error.type === '/problems/account-suspended',
        );
        await assert.rejects(
          loginUser({ email: input.email, password: 'incorrect' }, login),
          (error) => error.status === 401,
        );
        const saved = await prisma.user.findUnique({
          where: { id: account.id },
        });
        assert.deepEqual(saved.lastLoginAt, previous);
      },
    );

    await t.test(
      'duplicados exactos y case-insensitive producen 409 sin otra cuenta',
      async (cases) => {
        const input = clientInput();
        const account = await registerUser(input, registration);
        await cases.test('duplicado exacto en registerUser', async () => {
          await assert.rejects(
            registerUser(input, registration),
            (error) => error.status === 409,
          );
        });
        await cases.test('duplicado case-insensitive en Prisma', async () => {
          await assert.rejects(
            prisma.user.create({
              data: {
                name: input.name,
                email: input.email.toUpperCase(),
                passwordHash: 'fixture-hash',
                role: 'CLIENT',
                phone: input.phone,
              },
            }),
            (error) => error.code === 'P2002',
          );
        });
        const saved = await prisma.user.findMany({
          where: { email: { equals: input.email, mode: 'insensitive' } },
          select: { id: true },
        });
        assert.deepEqual(saved, [{ id: account.id }]);
      },
    );

    await t.test(
      'registro y login encuentran un email previo con mayúsculas sin convertir la entrada',
      async () => {
        const input = clientInput();
        const account = await prisma.user.create({
          data: {
            name: input.name,
            email: input.email.toUpperCase(),
            passwordHash: await bcrypt.hash(password, 10),
            role: 'CLIENT',
            phone: input.phone,
          },
        });
        await assert.rejects(
          registerUser(input, registration),
          (error) => error.status === 409,
        );
        const result = await loginUser({ email: input.email, password }, login);
        assert.equal(result.user.id, account.id);
      },
    );

    await t.test(
      'dos registros concurrentes dejan una cuenta y devuelven un único conflicto',
      async () => {
        const input = clientInput();
        const results = await Promise.allSettled([
          registerUser(input, registration),
          registerUser(input, registration),
        ]);
        assert.equal(
          results.filter((item) => item.status === 'fulfilled').length,
          1,
        );
        const rejected = results.filter((item) => item.status === 'rejected');
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.status, 409);
        assert.equal(
          await prisma.user.count({ where: { email: input.email } }),
          1,
        );
      },
    );

    await t.test(
      'LOWER(email) rechaza variantes de mayúsculas concurrentes en PostgreSQL',
      async () => {
        const input = clientInput();
        const data = {
          name: input.name,
          passwordHash: 'fixture-hash',
          role: 'CLIENT',
          phone: input.phone,
        };
        const results = await Promise.allSettled([
          prisma.user.create({ data: { ...data, email: input.email } }),
          prisma.user.create({
            data: { ...data, email: input.email.toUpperCase() },
          }),
        ]);
        assert.equal(
          results.filter((item) => item.status === 'fulfilled').length,
          1,
        );
        const rejected = results.filter((item) => item.status === 'rejected');
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, 'P2002');
        assert.equal(
          await prisma.user.count({
            where: { email: { equals: input.email, mode: 'insensitive' } },
          }),
          1,
        );
      },
    );

    await t.test(
      'CHECK PostgreSQL exige teléfono de CLIENT y TECHNICIAN y null para ADMIN',
      async () => {
        const { Client } = require('pg');
        const connection = new Client({
          connectionString: validateIntegrationUrl(process.env.DATABASE_URL),
        });
        try {
          await connection.connect();
          const insert = (role, phone) =>
            connection.query({
              text: 'INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "phone") VALUES ($1::uuid, $2, $3, $4, $5::"UserRole", $6)',
              values: [
                randomUUID(),
                'S3 CHECK fixture',
                `s3-${randomUUID()}@example.test`,
                'fixture-hash',
                role,
                phone,
              ],
            });
          for (const role of ['CLIENT', 'TECHNICIAN']) {
            for (const phone of [null, '', '   ']) {
              await assert.rejects(
                insert(role, phone),
                (error) =>
                  error.code === '23514' &&
                  error.constraint === 'User_phone_by_role',
              );
            }
            assert.equal((await insert(role, '+5491123456789')).rowCount, 1);
          }
          for (const phone of ['', '   ', '+5491123456789']) {
            await assert.rejects(
              insert('ADMIN', phone),
              (error) =>
                error.code === '23514' &&
                error.constraint === 'User_phone_by_role',
            );
          }
          assert.equal((await insert('ADMIN', null)).rowCount, 1);
        } finally {
          await connection.end();
        }
      },
    );
  },
);
