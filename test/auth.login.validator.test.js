const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLogin } = require('../src/validators/auth.validator');

test('login acepta email minúsculo y contraseña sin modificarla', () => {
  assert.doesNotThrow(() => validateLogin({ email: 'ana@example.com', password: ' x ' }));
});

test('login rechaza bodies inválidos y señala campos sin revelar valores', () => {
  for (const input of [null, [], {}, { email: 'Ana@example.com', password: 'secret' },
    { email: ' ana@example.com', password: 'secret' }, { email: 'invalid', password: 'secret' },
    { email: 'ana@example.com', password: 123 }, { email: 'ana@example.com', password: '' },
    { email: 'ana@example.com', password: 'secret', role: 'ADMIN' }]) {
    assert.throws(() => validateLogin(input), error => {
      assert.equal(error.status, 400);
      assert.equal(error.type, '/problems/validation-error');
      assert.ok(error.errors.length);
      assert.ok(error.errors.every(item => typeof item.field === 'string' && typeof item.detail === 'string'));
      assert.ok(!JSON.stringify(error.errors).includes('secret'));
      return true;
    });
  }
});
