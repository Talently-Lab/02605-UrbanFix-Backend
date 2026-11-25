const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRegistration } = require('../src/validators/auth.validator');

test('rechaza una contraseña de menos de 8 caracteres', () => {
  const input = {
    name: 'Cliente de prueba',
    email: 'cliente@example.com',
    password: '1234567',
    role: 'CLIENT',
    phone: '+5491123456789',
  };

  assert.throws(
    () => validateRegistration(input),
    (error) => error.status === 400,
  );
});

test('acepta una contraseña de exactamente 8 caracteres', () => {
  const input = {
    name: 'Cliente de prueba',
    email: 'cliente@example.com',
    password: '12345678',
    role: 'CLIENT',
    phone: '+5491123456789',
  };

  assert.doesNotThrow(() => validateRegistration(input));
});

test('rechaza campos obligatorios ausentes', () => {
  for (const field of ['name', 'email', 'password', 'role']) {
    const input = {
      name: 'Cliente de prueba',
      email: 'cliente@example.com',
      password: '12345678',
      role: 'CLIENT',
      phone: '+5491123456789',
    };

    delete input[field];

    assert.throws(
      () => validateRegistration(input),
      (error) => error.status === 400,
      `Debe rechazar la ausencia de ${field}`,
    );
  }
});

test('rechaza emails que contienen mayúsculas', () => {
  for (const email of [
    'Cliente@example.com',
    'cliente@Example.com',
    'cliente@example.COM',
  ]) {
    assert.throws(
      () =>
        validateRegistration({
          name: 'Cliente de prueba',
          email,
          password: '12345678',
          role: 'CLIENT',
          phone: '+5491123456789',
        }),
      (error) => error.status === 400,
    );
  }
});

test('rechaza el registro público de ADMIN', () => {
  assert.throws(
    () =>
      validateRegistration({
        name: 'Administrador',
        email: 'admin@example.com',
        password: '12345678',
        role: 'ADMIN',
      }),
    (error) => error.status === 400,
  );
});

for (const role of ['CLIENT', 'TECHNICIAN']) {
  test(`${role} exige teléfono internacional y acepta los límites de 2 y 15 dígitos`, () => {
    const input = {
      name: 'Cliente',
      email: 'cliente@example.com',
      password: '12345678',
      role,
      ...(role === 'TECHNICIAN' && {
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
      }),
    };

    assert.throws(
      () => validateRegistration(input),
      (error) => error.status === 400 && error.type === '/problems/validation-error' &&
        error.errors[0].field === 'phone',
    );

    for (const phone of ['+12', '+123456789012345', '+5491123456789']) {
      assert.doesNotThrow(() => validateRegistration({ ...input, phone }));
    }

    for (const phone of [null, 12345678, false, {}, [], '', ' ', '+', '+1',
      '+1234567890123456', '+012', '12345678', '005491123456789',
      '+54 91123456789', '+54-91123456789', '+54(911)23456789',
      ' +5491123456789', '+5491123456789 ', '+5491123456789\n',
      '+54abc', '++5491123456789', '+１２']) {
      assert.throws(
        () => validateRegistration({ ...input, phone }),
        error => error.status === 400 && error.type === '/problems/validation-error' &&
          error.errors[0].field === 'phone',
        `Debe rechazar teléfono ${JSON.stringify(phone)}`,
      );
    }
  });
}

test('registro público rechaza isTestUser para CLIENT y TECHNICIAN cualquiera sea su valor', () => {
  for (const role of ['CLIENT', 'TECHNICIAN']) {
    const input = {
      name: 'Cuenta de prueba', email: 'cuenta@example.com', password: '12345678', role,
      phone: '+5491123456789',
      ...(role === 'TECHNICIAN' && {
        specialties: [{ category: 'PLUMBING' }],
        neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
      }),
    };
    assert.doesNotThrow(() => validateRegistration(input));
    for (const isTestUser of [true, false, null, 'true', 1]) {
      assert.throws(
        () => validateRegistration({ ...input, isTestUser }),
        error => error.status === 400 && error.message === 'Campo no permitido: isTestUser',
      );
    }
  }
});

test('rechaza un técnico sin especialidades', () => {
  const input = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
    specialties: [],
    neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
  };

  assert.throws(
    () => validateRegistration(input),
    (error) => error.status === 400,
  );
});

test('rechaza un técnico sin barrios de cobertura', () => {
  const input = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
    specialties: [{ category: 'PLUMBING' }],
    neighborhoodIds: [],
  };

  assert.throws(
    () => validateRegistration(input),
    (error) => error.status === 400,
  );
});

test('exige matrícula para especialidades reguladas', () => {
  for (const category of ['GAS', 'ELECTRICITY']) {
    const input = {
      name: 'Técnico de prueba',
      email: 'tecnico@example.com',
      password: '12345678',
      role: 'TECHNICIAN',
      phone: '+5491123456789',
      specialties: [{ category }],
      neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
    };

    assert.throws(
      () => validateRegistration(input),
      (error) => error.status === 400,
    );
  }
});

test('rechaza especialidades duplicadas', () => {
  const input = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
    specialties: [{ category: 'PLUMBING' }, { category: 'PLUMBING' }],
    neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440000'],
  };

  assert.throws(
    () => validateRegistration(input),
    (error) => error.status === 400,
  );
});

test('rechaza barrios duplicados o identificadores inválidos', () => {
  const base = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
    specialties: [{ category: 'PLUMBING' }],
  };

  const id = '550e8400-e29b-41d4-a716-446655440000';

  for (const neighborhoodIds of [[id, id], ['no-es-uuid']]) {
    assert.throws(
      () => validateRegistration({ ...base, neighborhoodIds }),
      (error) => error.status === 400,
    );
  }
});
