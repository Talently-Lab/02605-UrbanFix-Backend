const test = require('node:test');
const assert = require('node:assert/strict');

const { registerUser } = require('../src/services/auth.service');

test('registro con isTestUser no ejecuta hash ni persistencia para ningún rol público', async () => {
  for (const role of ['CLIENT', 'TECHNICIAN']) {
    const input = {
      name: 'Cuenta de prueba', email: 'cuenta@example.com', password: '12345678', role,
      phone: '+5491123456789',
      ...(role === 'TECHNICIAN' && {
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
      }),
    };
    for (const isTestUser of [true, false, null, 'true', 1]) {
      const calls = [];
      const prisma = {
        user: { create: async () => { calls.push('user.create'); } },
        technician: { create: async () => { calls.push('technician.create'); } },
        $transaction: async () => { calls.push('transaction'); },
      };
      await assert.rejects(registerUser({ ...input, isTestUser }, {
        prisma,
        hashPassword: async () => { calls.push('hash'); return 'hash-simulado'; },
      }), error => error.status === 400 && error.message === 'Campo no permitido: isTestUser');
      assert.deepEqual(calls, []);
    }
  }
});

test('teléfono rechazado impide persistencia en CLIENT y TECHNICIAN', async () => {
  for (const role of ['CLIENT', 'TECHNICIAN']) {
    const base = {
      name: 'Cuenta de prueba', email: 'cuenta@example.com', password: '12345678', role,
      ...(role === 'TECHNICIAN' ? {
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
      } : {}),
    };
    const invalidInputs = [base, ...[null, '', ' ', 12345678, '+1', '+012', '+1234567890123456', '+54 91123456789']
      .map(phone => ({ ...base, phone }))];
    for (const input of invalidInputs) {
      const calls = [];
      const prisma = {
        user: { create: async () => { calls.push('user.create'); } },
        technician: { create: async () => { calls.push('technician.create'); } },
        $transaction: async () => { calls.push('transaction'); },
      };
      await assert.rejects(registerUser(input, {
        prisma,
        hashPassword: async () => { calls.push('hash'); return 'hash-simulado'; },
      }), error => error.status === 400 && error.type === '/problems/validation-error' &&
        error.errors[0].field === 'phone');
      assert.deepEqual(calls, []);
    }
  }
});

test('registra un CLIENT con contraseña hasheada y respuesta segura', async () => {
  const input = {
    name: 'Cliente de prueba',
    email: 'cliente@example.com',
    password: '12345678',
    role: 'CLIENT',
    phone: '+5491123456789',
  };

  const passwordHash = 'hash-simulado';

  let savedData;

  const prisma = {
    user: {
      create: async ({ data }) => {
        savedData = data;

        return {
          id: 'user-123',
          ...data,
          accountStatus: 'ACTIVE',
          lastLoginAt: null,
          isTestUser: false,
        };
      },
    },
  };

  const hashPassword = async (password) => {
    assert.equal(password, input.password);
    return passwordHash;
  };

  const result = await registerUser(input, {
    prisma,
    hashPassword,
  });

  assert.equal(savedData.passwordHash, passwordHash);
  assert.notEqual(savedData.passwordHash, input.password);
  assert.equal(savedData.email, input.email);
  assert.equal(savedData.role, 'CLIENT');
  assert.equal(savedData.phone, input.phone);

  assert.deepEqual(result, {
    id: 'user-123', name: input.name, email: input.email, role: 'CLIENT',
    accountStatus: 'ACTIVE', technician: null, lastLoginAt: null, isTestUser: false,
  });

  assert.equal(
    Object.hasOwn(result, 'passwordHash'),
    false,
    'La respuesta no debe exponer passwordHash',
  );

  assert.equal(
    Object.hasOwn(result, 'password'),
    false,
    'La respuesta no debe exponer la contraseña',
  );
});

test('devuelve error 409 cuando el email ya está registrado', async () => {
  const input = {
    name: 'Cliente de prueba',
    email: 'cliente@example.com',
    password: '12345678',
    role: 'CLIENT',
    phone: '+5491123456789',
  };

  const prisma = {
    user: {
      create: async () => {
        const error = new Error('Unique constraint failed');
        error.code = 'P2002';
        error.meta = { target: 'User_email_case_insensitive' };
        throw error;
      },
    },
  };

  const hashPassword = async () => 'hash-simulado';

  await assert.rejects(
    registerUser(input, { prisma, hashPassword }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, 'El email ya está registrado');
      return true;
    },
  );
});

for (const [existingRole, requestedRole] of [['CLIENT', 'TECHNICIAN'], ['TECHNICIAN', 'CLIENT']]) {
  test(`email existente de ${existingRole} rechaza registro ${requestedRole} sin efectos parciales`, async () => {
    const input = {
      name: 'Cuenta nueva', email: 'existente@example.com', password: '12345678',
      role: requestedRole, phone: '+5491123456789',
      ...(requestedRole === 'TECHNICIAN' && {
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    };
    const state = {
      users: [{ id: 'existing-user', name: 'Cuenta existente', email: input.email, role: existingRole }],
      technicians: existingRole === 'TECHNICIAN'
        ? [{ id: 'existing-technician', userId: 'existing-user', approvalStatus: 'APPROVED' }] : [],
    };
    const before = structuredClone(state);
    const calls = [];
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002', meta: { target: 'User_email_case_insensitive' },
    });
    const tx = {
      user: { create: async ({ data }) => {
        calls.push('user.create');
        assert.equal(data.email, state.users[0].email);
        assert.equal(data.role, requestedRole);
        throw conflict;
      } },
      technician: { create: async () => {
        calls.push('technician.create');
        assert.fail('No debe crear un perfil técnico después del conflicto de email');
      } },
    };
    const prisma = {
      ...tx,
      $transaction: async callback => {
        calls.push('transaction.begin');
        try {
          const result = await callback(tx);
          calls.push('transaction.commit');
          return result;
        } catch (error) {
          assert.equal(error, conflict);
          calls.push('transaction.rollback');
          throw error;
        }
      },
    };

    await assert.rejects(registerUser(input, {
      prisma,
      hashPassword: async password => {
        assert.equal(password, input.password);
        calls.push('hash');
        return 'hash-simulado';
      },
    }), error => {
      assert.equal(error.status, 409);
      assert.equal(error.type, '/problems/email-already-registered');
      assert.equal(error.message, 'El email ya está registrado');
      return true;
    });

    assert.deepEqual(calls, requestedRole === 'TECHNICIAN'
      ? ['hash', 'transaction.begin', 'user.create', 'transaction.rollback']
      : ['hash', 'user.create']);
    assert.deepEqual(state, before);
  });
}

test('no confunde otras restricciones únicas con un email duplicado', async () => {
  const input = {
    name: 'Cliente de prueba',
    email: 'cliente@example.com',
    password: '12345678',
    role: 'CLIENT',
    phone: '+5491123456789',
  };

  const prismaError = new Error('Unique constraint failed');
  prismaError.code = 'P2002';
  prismaError.meta = { target: ['id'] };

  const prisma = {
    user: {
      create: async () => {
        throw prismaError;
      },
    },
  };

  await assert.rejects(
    registerUser(input, {
      prisma,
      hashPassword: async () => 'hash-simulado',
    }),
    (error) => {
      assert.equal(error, prismaError);
      return true;
    },
  );
});

for (const index of ['User_email_case_insensitive', 'User_email_key']) {
  test(`devuelve 409 para driverAdapterError con índice ${index}`, async () => {
    const input = {
      name: 'Cliente de prueba',
      email: 'cliente@example.com',
      password: '12345678',
      role: 'CLIENT',
      phone: '+5491123456789',
    };

    const prismaError = new Error('Unique constraint failed');
    prismaError.code = 'P2002';
    prismaError.meta = {
      modelName: 'User',
      driverAdapterError: {
        cause: {
          kind: 'UniqueConstraintViolation',
          constraint: {
            index,
          },
        },
      },
    };

    const prisma = {
      user: {
        create: async () => {
          throw prismaError;
        },
      },
    };

    await assert.rejects(
      registerUser(input, {
        prisma,
        hashPassword: async () => 'hash-simulado',
      }),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.message, 'El email ya está registrado');
        return true;
      },
    );
  });
}

test('propaga índices ajenos al email y errores distintos de P2002 del adapter', async () => {
  const input = {
    name: 'Cliente de prueba', email: 'cliente@example.com', password: '12345678',
    role: 'CLIENT', phone: '+5491123456789',
  };
  for (const [code, index] of [['P2002', 'User_pkey'], ['P2003', 'User_email_key']]) {
    const original = Object.assign(new Error('Database error'), {
      code, meta: { driverAdapterError: { cause: { constraint: { index } } } },
    });
    const prisma = { user: { create: async () => { throw original; } } };
    await assert.rejects(registerUser(input, { prisma, hashPassword: async () => 'hash-simulado' }),
      error => error === original);
  }
});

test('registra un TECHNICIAN con especialidades y barrios dentro de una transacción', async () => {
  const input = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
    specialties: [
      { category: 'PLUMBING' },
      { category: 'GAS', licenseNumber: 'MAT-123' },
    ],
    neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
  };

  const calls = [];
  const userId = '22222222-2222-4222-8222-222222222222';

  const tx = {
    user: {
      create: async ({ data }) => {
        calls.push({ operation: 'user.create', data });

        return {
          id: userId,
          ...data,
          accountStatus: 'ACTIVE',
          lastLoginAt: null,
          isTestUser: false,
        };
      },
    },
    technician: {
      create: async ({ data }) => {
        calls.push({ operation: 'technician.create', data });

        return { id: 'technician-id', ...data };
      },
    },
  };

  const prisma = {
    $transaction: async (callback) => {
      calls.push({ operation: 'transaction.begin' });
      const result = await callback(tx);
      calls.push({ operation: 'transaction.commit' });
      return result;
    },
  };

  const result = await registerUser(input, {
    prisma,
    hashPassword: async () => 'hash-simulado',
  });

  assert.deepEqual(
    calls.map((call) => call.operation),
    [
      'transaction.begin',
      'user.create',
      'technician.create',
      'transaction.commit',
    ],
  );

  assert.equal(calls[1].data.email, input.email);
  assert.equal(calls[1].data.passwordHash, 'hash-simulado');
  assert.equal(calls[1].data.role, 'TECHNICIAN');
  assert.equal(calls[1].data.phone, input.phone);

  assert.equal(calls[2].data.userId, userId);
  assert.equal(calls[2].data.approvalStatus, 'PENDING');

  assert.deepEqual(calls[2].data.specialties, {
    create: [
      { category: 'PLUMBING' },
      { category: 'GAS', licenseNumber: 'MAT-123' },
    ],
  });

  assert.deepEqual(calls[2].data.neighborhoods, {
    create: [{ neighborhoodId: input.neighborhoodIds[0] }],
  });

  assert.deepEqual(result, {
    id: userId, name: input.name, email: input.email, role: 'TECHNICIAN',
    accountStatus: 'ACTIVE', technician: { id: 'technician-id', approvalStatus: 'PENDING' },
    lastLoginAt: null, isTestUser: false,
  });
});

test('no confirma un registro parcial si falla la creación del técnico', async () => {
  const input = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
    specialties: [{ category: 'PLUMBING' }],
    neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
  };

  const calls = [];
  const databaseError = new Error('Error al crear el perfil técnico');

  const tx = {
    user: {
      create: async () => {
        calls.push('user.create');
        return { id: 'user-id', passwordHash: 'hash-simulado' };
      },
    },
    technician: {
      create: async () => {
        calls.push('technician.create');
        throw databaseError;
      },
    },
  };

  const prisma = {
    $transaction: async (callback) => {
      calls.push('transaction.begin');

      try {
        const result = await callback(tx);
        calls.push('transaction.commit');
        return result;
      } catch (error) {
        calls.push('transaction.rollback');
        throw error;
      }
    },
  };

  await assert.rejects(
    registerUser(input, {
      prisma,
      hashPassword: async () => 'hash-simulado',
    }),
    (error) => {
      assert.equal(error, databaseError);
      return true;
    },
  );

  assert.deepEqual(calls, [
    'transaction.begin',
    'user.create',
    'technician.create',
    'transaction.rollback',
  ]);

  assert.equal(calls.includes('transaction.commit'), false);
});

test('traduce solo la FK de barrio del técnico después de que la transacción rechaza', async () => {
  const input = {
    name: 'Técnico de prueba', email: 'tecnico@example.com', password: '12345678',
    role: 'TECHNICIAN', phone: '+5491123456789', specialties: [{ category: 'PLUMBING' }],
    neighborhoodIds: ['11111111-1111-4111-8111-111111111111'],
  };
  for (const [modelName, index, matches] of [
    ['Technician', 'TechnicianNeighborhood_neighborhoodId_fkey', true],
    ['Technician', 'TechnicianNeighborhood_technicianId_fkey', false],
    ['User', 'TechnicianNeighborhood_neighborhoodId_fkey', false],
    ['Technician', undefined, false],
  ]) {
    const original = Object.assign(new Error('Detalle interno de la FK'), {
      code: 'P2003', meta: { modelName, driverAdapterError: { cause: { constraint: { index } } } },
    });
    let rolledBack = false;
    const tx = {
      user: { create: async () => ({ id: 'test-user' }) },
      technician: { create: async () => { throw original; } },
    };
    const prisma = { $transaction: async callback => {
      try {
        return await callback(tx);
      } catch (error) {
        assert.equal(error, original);
        rolledBack = true;
        throw error;
      }
    } };
    await assert.rejects(registerUser(input, { prisma, hashPassword: async () => 'hash-simulado' }), error => {
      assert.equal(rolledBack, true);
      if (!matches) return error === original;
      assert.equal(error.status, 404);
      assert.equal(error.type, '/problems/not-found');
      return true;
    });
  }
});
