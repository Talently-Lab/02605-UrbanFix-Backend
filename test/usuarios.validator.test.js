const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfilePatch } = require('../src/validators/usuarios.validator');

function validationFields(input, role) {
  let captured;
  assert.throws(() => validateProfilePatch(input, role), error => {
    captured = error;
    return error.status === 400 && error.type === '/problems/validation-error';
  });
  return captured.errors;
}

for (const role of ['CLIENT', 'TECHNICIAN', 'ADMIN']) {
  test(`PATCH ${role} admite nombre sin normalizar ni agregar campos`, () => {
    assert.deepEqual(validateProfilePatch({ name: ' Ana Pérez ' }, role), { name: ' Ana Pérez ' });
  });

  test(`PATCH ${role} rechaza bodies sin campos editables`, () => {
    for (const body of [undefined, null, [], ['name'], '', 'Ana', 1, false, {}]) {
      const errors = validationFields(body, role);
      assert.equal(errors[0].field, 'body');
    }
    assert.deepEqual(validationFields({}, role), [
      { field: 'body', detail: 'Informá al menos un campo editable para tu rol.' },
    ]);
  });

  test(`PATCH ${role} rechaza nombres inválidos`, () => {
    for (const name of [undefined, null, '', ' ', '\n\t', 1, false, {}, []]) {
      assert.equal(validationFields({ name }, role)[0].field, 'name');
    }
  });

  test(`PATCH ${role} rechaza campos prohibidos incluso junto a nombre válido`, () => {
    for (const field of ['id', 'userId', 'email', 'password', 'passwordHash', 'role',
      'accountStatus', 'approvalStatus', 'technician', 'specialties', 'neighborhoodIds',
      'lastLoginAt', 'isTestUser', 'createdAt', 'unknown', '__proto__', 'constructor']) {
      for (const input of [{ [field]: 'private-value' }, { name: 'Nuevo nombre', [field]: 'private-value' }]) {
        const errors = validationFields(input, role);
        assert.ok(errors.some(error => error.field === field));
        assert.ok(!JSON.stringify(errors).includes('private-value'));
      }
    }
  });
}

test('PATCH CLIENT conserva formato y límites de teléfono del registro', () => {
  for (const phone of ['+12', '+123456789012345', '+5491123456789']) {
    assert.deepEqual(validateProfilePatch({ phone }, 'CLIENT'), { phone });
    assert.deepEqual(validateProfilePatch({ name: 'Ana', phone }, 'CLIENT'), { name: 'Ana', phone });
  }
  for (const phone of [undefined, null, 12345678, false, {}, [], '', ' ', '+', '+1',
    '+1234567890123456', '+012', '12345678', '005491123456789',
    '+54 91123456789', '+54-91123456789', '+54(911)23456789',
    ' +5491123456789', '+5491123456789 ', '+5491123456789\n',
    '+54abc', '++5491123456789', '+１２']) {
    assert.equal(validationFields({ phone }, 'CLIENT')[0].field, 'phone');
  }
});

for (const role of ['TECHNICIAN', 'ADMIN']) {
  test(`PATCH ${role} nunca admite phone, ni null ni combinado con name`, () => {
    for (const phone of [undefined, null, '', '+5491123456789']) {
      assert.deepEqual(validationFields({ name: 'Ana', phone }, role), [
        { field: 'phone', detail: 'Campo no permitido.' },
      ]);
    }
  });
}

test('PATCH informa todos los campos inválidos sin incluir valores recibidos', () => {
  const errors = validationFields({ name: null, phone: 'private-phone', email: 'private-email', role: 'ADMIN' }, 'CLIENT');
  assert.deepEqual(new Set(errors.map(error => error.field)), new Set(['name', 'phone', 'email', 'role']));
  assert.ok(!JSON.stringify(errors).includes('private-'));
});
