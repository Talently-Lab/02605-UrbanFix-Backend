const test = require('node:test');
const assert = require('node:assert/strict');
const { isArgentinePhone } = require('../src/validators/phone.validator');
const { codes } = require('../src/data/argentina-area-codes.json');

test('admite fijo y móvil para todos los indicativos oficiales sin normalizar', () => {
  assert.equal(codes.length, 300);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[1-3][0-9]{1,3}$/);
    const subscriber = '2'.repeat(10 - code.length);
    for (const prefix of ['+54', '+549']) assert.equal(isArgentinePhone(prefix + code + subscriber), true);
  }
  for (const phone of ['+541143216543', '+5491164004700', '+542202432165', '+5493838223456']) {
    assert.equal(isArgentinePhone(phone), true, phone);
  }
});

test('rechaza países, códigos, abonados, prefijos y longitudes inválidos sin coerción', () => {
  for (const phone of [null, undefined, 541143216543, {}, [], '', '+12', '+123456789012345',
    '+54114321654', '+5411432165430', '+549116400470', '+54911640047000',
    '+5401143216543', '+54111543216543', '01143216543', '00541143216543',
    '+541103216543', '+541113216543', '+5491100000001', '+545552222222',
    '+5411 43216543', '+54(11)43216543', '+54-11-43216543', ' +541143216543',
    '+541143216543\n', '+５４１１４３２１６５４３', '+59894321654']) {
    assert.equal(isArgentinePhone(phone), false, String(phone));
  }
});

test('registro y PATCH aplican la misma validación argentina', () => {
  const { validateRegistration } = require('../src/validators/auth.validator');
  const { validateProfilePatch } = require('../src/validators/usuarios.validator');
  for (const phone of ['+12', '+5491100000001', '+545552222222']) {
    const input = { name: 'Ana', email: 'ana@example.com', password: '12345678', role: 'CLIENT', phone };
    for (const operation of [() => validateRegistration(input), () => validateProfilePatch({ phone }, 'CLIENT')]) {
      assert.throws(operation, error => error.status === 400 && error.errors.some(item => item.field === 'phone'));
    }
  }
});

test('Golden y Volume contienen exclusivamente teléfonos argentinos estructuralmente válidos', () => {
  const golden = require('../prisma/data/golden').createGoldenDataset();
  const volume = require('../prisma/data/volume').createVolumeDataset('2026-12-07T03:00:00.000Z');
  assert.deepEqual([golden, volume].map(data => data.user.filter(user => user.phone !== null).length), [16, 60]);
  for (const user of [...golden.user, ...volume.user]) {
    assert.equal(user.role === 'ADMIN' ? user.phone === null : isArgentinePhone(user.phone), true);
  }
});

test('la adecuación telefónica conserva exactamente todos los demás campos de los datasets aprobados', () => {
  const hash = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const [data, expected] of [
    [require('../prisma/data/golden').createGoldenDataset(), '499e475baefc5259fd1ff227d5db35a5bdfb72282747adfb7782abbdd0c3b64a'],
    [require('../prisma/data/volume').createVolumeDataset('2026-12-07T03:00:00.000Z'), '25c0ac412b8a3dd2fe355c0bb967c4c8de1cfb9529f0bb69af667ea8f8c4487d'],
  ]) {
    assert.equal(hash({ ...data, user: data.user.map(({ phone, ...user }) => user) }), expected);
  }
});

test('los validadores del seed rechazan teléfonos ajenos a la estructura aprobada', () => {
  const csv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
  for (const mode of ['golden', 'volume']) {
    const data = mode === 'golden' ? require('../prisma/data/golden').createGoldenDataset()
      : require('../prisma/data/volume').createVolumeDataset('2026-12-07T03:00:00.000Z');
    data.user.find(user => user.role === 'CLIENT').phone = '+12';
    const validate = require(`../prisma/seed/${mode}`)[mode === 'golden' ? 'validateGoldenDataset' : 'validateVolumeDataset'];
    assert.throws(() => validate(data, csv));
  }
});
