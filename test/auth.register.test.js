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

test('valida el teléfono según el rol', () => {
  const client = {
    name: 'Cliente',
    email: 'cliente@example.com',
    password: '12345678',
    role: 'CLIENT',
  };

  assert.throws(
    () => validateRegistration(client),
    (error) => error.status === 400,
  );

  const technician = {
    name: 'Técnico',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
    phone: '+5491123456789',
  };

  assert.throws(
    () => validateRegistration(technician),
    (error) => error.status === 400,
  );
});

test('rechaza un técnico sin especialidades', () => {
  const input = {
    name: 'Técnico de prueba',
    email: 'tecnico@example.com',
    password: '12345678',
    role: 'TECHNICIAN',
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
    specialties: [{ specialty: 'PLUMBING' }],
    neighborhoodIds: [],
  };

  assert.throws(
    () => validateRegistration(input),
    (error) => error.status === 400,
  );
});

test('exige matrícula para especialidades reguladas', () => {
  for (const specialty of ['GAS', 'ELECTRICITY']) {
    const input = {
      name: 'Técnico de prueba',
      email: 'tecnico@example.com',
      password: '12345678',
      role: 'TECHNICIAN',
      specialties: [{ specialty }],
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
    specialties: [{ specialty: 'PLUMBING' }, { specialty: 'PLUMBING' }],
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
    specialties: [{ specialty: 'PLUMBING' }],
  };

  const id = '550e8400-e29b-41d4-a716-446655440000';

  for (const neighborhoodIds of [[id, id], ['no-es-uuid']]) {
    assert.throws(
      () => validateRegistration({ ...base, neighborhoodIds }),
      (error) => error.status === 400,
    );
  }
});
