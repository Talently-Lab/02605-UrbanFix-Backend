const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const D = '2026-12-07T03:00:00.000Z';
const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
const make = (reference = D) => require('../prisma/data/volume').createVolumeDataset(reference);
const validate = data => require('../prisma/seed/volume').validateVolumeDataset(data, csv);

test('Volumen exige D explícita, lunes 00:00 Buenos Aires, sin fallback al reloj', () => {
  for (const reference of [undefined, '', 'invalid', '2026-12-07', '2026-12-07T00:00:00.000Z',
    '2026-12-08T03:00:00.000Z', '2026-12-07T03:00:01.000Z']) {
    assert.throws(() => make(reference === undefined ? null : reference), /referencia/i);
  }
});

test('Volumen es determinista y desplaza fechas con D manteniendo UUID y composición', () => {
  const first = make();
  assert.deepEqual(first, make());
  const shifted = make('2026-12-14T03:00:00.000Z');
  for (const table of ['user', 'technician', 'technicianSpecialty', 'technicianNeighborhood', 'serviceRequest', 'serviceOffer']) {
    for (let i = 0; i < first[table].length; i++) {
      for (const [key, value] of Object.entries(first[table][i])) {
        if (key.endsWith('At') && value !== null) assert.equal(Date.parse(shifted[table][i][key]) - Date.parse(value), 7 * 86400000);
        else assert.deepEqual(shifted[table][i][key], value);
      }
    }
  }
  assert.equal(validate(first), first);
});

test('Volumen incluye cuentas y solicitudes de prueba en los 62 usuarios y 200 solicitudes', () => {
  const data = make();
  assert.deepEqual(['CLIENT', 'TECHNICIAN', 'ADMIN'].map(role => data.user.filter(row => row.role === role).length), [45, 15, 2]);
  assert.equal(data.technician.length, 15);
  assert.equal(data.serviceRequest.length, 200);
  const tests = new Set(data.user.filter(row => row.isTestUser).map(row => row.id));
  assert.equal(tests.size, 3);
  assert.equal(data.serviceRequest.filter(row => tests.has(row.clientId)).length, 10);
  const clients = data.user.filter(row => row.role === 'CLIENT');
  assert.equal(clients.filter(row => !data.serviceRequest.some(request => request.clientId === row.id)).length, 7);
  assert.ok(clients.filter(row => data.serviceRequest.filter(request => request.clientId === row.id).length >= 3).length >= 10);
  for (const user of data.user) {
    assert.match(user.email, /^urbanfix\.volume\.[act]\d+@example\.com$/);
    if (user.role === 'ADMIN') assert.equal(user.phone, null);
    else assert.equal(require('../src/validators/phone.validator').isArgentinePhone(user.phone), true);
  }
  const suspended = data.user.find(row => row.accountStatus === 'SUSPENDED');
  const tech = data.technician.find(row => row.userId === suspended.id);
  assert.equal(data.serviceOffer.some(row => row.technicianId === tech.id), false);
});

test('Volumen cumple semanas, cobertura, cancelaciones y casos de reoferta/vencimiento/liberación', () => {
  const data = make();
  const d = Date.parse(D), day = 86400000;
  assert.deepEqual(Array.from({ length: 5 }, (_, week) => data.serviceRequest.filter(row =>
    Date.parse(row.createdAt) >= d - (35 - week * 7) * day && Date.parse(row.createdAt) < d - (28 - week * 7) * day).length), [25, 35, 45, 55, 40]);
  for (const request of data.serviceRequest) {
    const hour = new Date(Date.parse(request.createdAt) - 3 * 3600000).getUTCHours();
    assert.ok(hour >= 8 && hour < 22);
    assert.ok(Date.parse(request.createdAt) <= d - 3600000);
  }
  const catalog = require('../prisma/seed/validate').validateCatalogCsv(csv);
  const used = new Set(data.serviceRequest.map(row => row.neighborhoodName));
  assert.equal(used.size, 9);
  assert.ok(new Set(catalog.filter(row => used.has(row.name)).map(row => row.comuna)).size >= 5);
  const admin = new Set(data.user.filter(row => row.role === 'ADMIN').map(row => row.id));
  assert.ok(data.serviceRequest.filter(row => !row.acceptedAt && row.cancelledAt && admin.has(row.cancelledById)).length >= 5);
  assert.equal(data.serviceRequest.filter(row => data.serviceOffer.filter(offer => offer.requestId === row.id).length > 1).length, 40);
  assert.equal(data.serviceOffer.filter(row => row.status === 'PENDING' && Date.parse(row.expiresAt) <= d).length, 4);
  assert.equal(data.serviceOffer.filter(row => row.status === 'RELEASED').length, 8);
  assert.equal(data.cancellationOrigins.filter(row => row.from === 'IN_PROGRESS').length, 2);
  assert.equal(validate(data), data);
  const clean = data.serviceRequest.filter(row => !data.user.find(user => user.id === row.clientId).isTestUser);
  assert.ok(clean.some(row => row.status === 'ACCEPTED'));
  assert.ok(clean.some(row => row.status === 'IN_PROGRESS'));
});

test('Volumen rechaza referencias, flags, relaciones, requisitos y cronología alterados', () => {
  for (const mutate of [
    d => d.user.pop(), d => { d.user[2].phone = null; },
    d => { d.user[0].email = 'qa.reservado@example.com'; },
    d => { d.user[0].isTestUser = !d.user[0].isTestUser; },
    d => { d.serviceRequest[0].clientId = d.user[0].id; },
    d => { d.serviceOffer[0].expiresAt = d.serviceOffer[0].createdAt; },
    d => { d.technicianSpecialty.find(row => row.category === 'GAS').licenseNumber = null; },
    d => { d.serviceRequest[0].updatedAt = '2099-01-01T00:00:00.000Z'; },
    d => { d.technicianNeighborhood[0].neighborhoodName = 'Desconocido'; },
    d => { d.serviceOffer[0].technicianId = d.technician[14].id; },
    d => { d.serviceRequest.find(row => row.status === 'PENDING').acceptedAt = d.serviceRequest[0].createdAt; },
    d => { d.serviceRequest.find(row => row.cancelledAt && row.acceptedAt).cancelledById = d.user[2].id; },
    d => { d.serviceRequest.find(row => row.completedAt).completedAt = d.serviceRequest[0].createdAt; },
    d => { d.serviceOffer.find(row => row.status === 'RELEASED').status = 'PENDING'; },
    d => { d.technicianSpecialty[1] = { ...d.technicianSpecialty[0] }; },
  ]) {
    const data = make(); mutate(data);
    assert.throws(() => validate(data), /Volumen inválido/);
  }
});

test('distribuciones documentadas separan total, datos limpios y madurez sin cambiar indicadores', () => {
  const data = make(), users = new Map(data.user.map(row => [row.id, row]));
  const clean = data.serviceRequest.filter(row => !users.get(row.clientId).isTestUser);
  const mature = clean.filter(row => Date.parse(row.createdAt) < Date.parse(D) - 86400000);
  assert.equal(clean.length, 190); assert.equal(mature.length, 188);
  assert.equal(mature.filter(row => row.acceptedAt).length, 137);
  assert.equal(mature.filter(row => row.acceptedAt && Date.parse(row.acceptedAt) - Date.parse(row.createdAt) <= 7200000).length, 57);
  assert.equal(mature.filter(row => row.acceptedAt && Date.parse(row.acceptedAt) - Date.parse(row.createdAt) < 7200000).length, 28);
  assert.equal(mature.filter(row => row.acceptedAt && Date.parse(row.acceptedAt) - Date.parse(row.createdAt) === 7200000).length, 29);
  assert.equal(mature.filter(row => row.acceptedAt && Date.parse(row.acceptedAt) - Date.parse(row.createdAt) <= 86400000).length, 121);
  assert.equal(mature.filter(row => row.status === 'PENDING').length, 26);
  const times = mature.filter(row => row.acceptedAt).map(row => (Date.parse(row.acceptedAt) - Date.parse(row.createdAt)) / 60000).sort((a, b) => a - b);
  assert.equal(times[(times.length - 1) / 2], 150);
  assert.deepEqual(['PLUMBING', 'ELECTRICITY', 'LOCKSMITH', 'GAS', 'MASONRY'].map(category =>
    data.serviceRequest.filter(row => row.category === category).length), [70, 50, 30, 30, 20]);
  assert.deepEqual(['PLUMBING', 'ELECTRICITY', 'LOCKSMITH', 'GAS', 'MASONRY'].map(category =>
    clean.filter(row => row.category === category).length), [69, 46, 28, 28, 19]);
  assert.deepEqual(['COMPLETED', 'CANCELLED', 'PENDING', 'ACCEPTED', 'IN_PROGRESS'].map(status =>
    data.serviceRequest.filter(row => row.status === status).length), [138, 31, 28, 1, 2]);
  const ids = new Set(clean.map(row => row.id)), offers = data.serviceOffer.filter(row => ids.has(row.requestId));
  assert.equal(offers.length, 230);
  assert.deepEqual(['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'RELEASED', 'PENDING'].map(status =>
    offers.filter(row => row.status === status).length), [137, 35, 19, 25, 8, 6]);
  assert.equal(offers.filter(row => row.status === 'EXPIRED' || row.status === 'PENDING' &&
    Date.parse(row.expiresAt) <= Date.parse(D)).length, 23);
});

test('calibración conserva todos los campos salvo nueve aceptaciones y diez estados de oferta', () => {
  const data = make();
  const requests = new Set([6, 7, 8, 9, 10, 19, 38, 47, 48]);
  const offers = new Set([46, 51, 68, 82, 107, 115, 122, 182, 197, 199]);
  for (const row of data.serviceRequest.filter(row => requests.has(Number(row.id.slice(-12))))) {
    assert.equal(row.status, 'COMPLETED');
    assert.equal(Date.parse(row.acceptedAt) - Date.parse(row.createdAt), 7200000);
    const initial = data.serviceOffer.filter(offer => offer.requestId === row.id);
    assert.equal(initial.length, 1);
    assert.equal(initial[0].status, 'ACCEPTED');
    assert.ok(Date.parse(row.acceptedAt) < Date.parse(initial[0].expiresAt));
    const duration = Date.parse(row.completedAt) - Date.parse(row.acceptedAt);
    assert.ok(duration >= 2 * 3600000 && duration <= 48 * 3600000);
  }
  for (const offer of data.serviceOffer.filter(row => offers.has(Number(row.id.slice(-12))))) {
    assert.equal(offer.status, 'REJECTED');
    const request = data.serviceRequest.find(row => row.id === offer.requestId);
    assert.equal(request.status, 'PENDING');
    assert.equal(request.acceptedAt, null);
    assert.equal(data.serviceOffer.filter(row => row.requestId === request.id).length, 1);
    const possibleRejection = Date.parse(offer.createdAt) + 60000;
    assert.ok(possibleRejection < Date.parse(offer.expiresAt));
    assert.equal(data.serviceRequest.some(job => job.technicianId === offer.technicianId && job.acceptedAt &&
      Date.parse(job.acceptedAt) <= possibleRejection &&
      possibleRejection < Date.parse(job.completedAt || job.cancelledAt || '9999-12-31T00:00:00.000Z')), false);
  }
  for (const row of data.serviceRequest) if (requests.has(Number(row.id.slice(-12)))) delete row.acceptedAt;
  for (const row of data.serviceOffer) if (offers.has(Number(row.id.slice(-12)))) delete row.status;
  assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    '471e3195f72169a348e8a1c25ae6a069260eb838563fa82c35280ff906f77a35');
});

const tables = ['user', 'technician', 'technicianSpecialty', 'technicianNeighborhood', 'serviceRequest', 'serviceOffer'];
function databaseMock({ fail, database = 'urbanfix_seed_cp4_volume_test' } = {}) {
  let rows = Object.fromEntries(tables.map(table => [table, []]));
  rows.neighborhood = require('../prisma/seed/validate').validateCatalogCsv(csv).map((row, i) => ({
    ...row, id: `c4000005-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  }));
  const calls = [];
  return { rows: () => rows, calls, prisma: {
    $disconnect: async () => calls.push(['disconnect']),
    $transaction: async (callback, options) => {
      calls.push(['transaction', options]);
      const staged = structuredClone(rows);
      const tx = { $queryRaw: async () => { calls.push(['identity']); return [{ database, schema: 'public' }]; } };
      for (const table of ['neighborhood', ...tables]) tx[table] = {
        findMany: async () => { calls.push(['read', table]); return structuredClone(staged[table]); },
        createMany: async ({ data }) => {
          calls.push(['insert', table, data.length]); staged[table].push(...structuredClone(data));
          if (fail === table) throw new Error('Simulated Volume failure');
          return { count: data.length };
        },
      };
      const result = await callback(tx);
      if (fail === 'commit') throw new Error('Simulated Volume failure');
      rows = staged; return result;
    },
  } };
}
const seed = (db, data = make()) => require('../prisma/seed/volume').seedVolume(db.prisma, data, csv);

test('Volumen carga seis lotes sin N+1, conserva datos ajenos y no escribe en catálogo', async () => {
  const data = make(), db = databaseMock();
  const foreign = { ...data.user[0], id: 'c4000001-0000-4000-8000-000000000099', email: 'control.volume@example.com' };
  db.rows().user.push(foreign);
  const catalog = structuredClone(db.rows().neighborhood);
  assert.deepEqual(await seed(db, data), { existing: 0, inserted: 695, total: 695 });
  assert.deepEqual(db.calls.filter(call => call[0] === 'read').map(call => call[1]), ['neighborhood', ...tables]);
  assert.deepEqual(db.calls.filter(call => call[0] === 'insert'), tables.map(table => ['insert', table, data[table].length]));
  assert.deepEqual(db.calls[0], ['transaction', { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 }]);
  assert.deepEqual(db.rows().user[0], foreign);
  assert.deepEqual(db.rows().neighborhood, catalog);
  assert.ok(db.rows().serviceRequest.every(row => row.neighborhoodId && !row.neighborhoodName));
});

test('Volumen completa cargas parciales, preserva UUID/fechas y rechaza cambiar D sin reanclar datos', async () => {
  const data = make(), db = databaseMock();
  db.rows().user.push({ ...data.user[0], createdAt: new Date(data.user[0].createdAt) });
  assert.deepEqual(await seed(db, data), { existing: 1, inserted: 694, total: 695 });
  const before = structuredClone(db.rows());
  db.calls.length = 0;
  assert.deepEqual(await seed(db, data), { existing: 695, inserted: 0, total: 695 });
  assert.equal(db.calls.some(call => call[0] === 'insert'), false);
  await assert.rejects(seed(db, make('2026-12-14T03:00:00.000Z')), /discrepancias/);
  assert.deepEqual(db.rows(), before);
});

test('Volumen revierte ante fallo en cualquier lote o commit', async () => {
  const data = make();
  for (const fail of [...tables, 'commit']) {
    const db = databaseMock({ fail }), before = structuredClone(db.rows());
    await assert.rejects(seed(db, data), /Simulated Volume failure/);
    assert.deepEqual(db.rows(), before);
  }
});

test('Volumen detecta colisiones y discrepancias antes de escribir y comprueba identidad', async () => {
  const data = make();
  for (const mutate of [
    db => db.rows().neighborhood.pop(),
    db => { db.rows().neighborhood[0].comuna = 1; },
    db => db.rows().user.push({ ...data.user[0], name: 'Ajeno' }),
    db => db.rows().user.push({ ...data.user[0], id: 'c4000001-0000-4000-8000-000000000099', email: data.user[0].email.toUpperCase() }),
    db => db.rows().technician.push({ ...data.technician[0], id: 'c4000002-0000-4000-8000-000000000099' }),
    db => db.rows().technicianSpecialty.push({ ...data.technicianSpecialty[0], licenseNumber: 'Ajena' }),
    db => db.rows().serviceRequest.push({ ...data.serviceRequest[0], description: 'No modificar este registro ajeno.' }),
  ]) {
    const db = databaseMock(); mutate(db);
    const before = structuredClone(db.rows());
    await assert.rejects(seed(db, data), /discrepancias/);
    assert.equal(db.calls.some(call => call[0] === 'insert'), false);
    assert.deepEqual(db.rows(), before);
  }
  const db = databaseMock({ database: 'urbanfix_seed_cp3_golden_test' });
  await assert.rejects(seed(db, data), /Identidad/);
  assert.equal(db.calls.some(call => call[0] === 'read'), false);
});

test('runner Volumen valida referencia/dataset antes del cliente, despacha modo y desconecta', async () => {
  const { runSeed } = require('../prisma/seed/run');
  const data = make();
  const env = { URBANFIX_SEED_DATABASE_URL: 'postgresql://127.0.0.1:55434/urbanfix_seed_cp4_volume_test', URBANFIX_SEED_REFERENCE_TIME: D };
  for (const reference of [undefined, 'invalid', '2026-12-08T03:00:00.000Z']) {
    let clients = 0;
    await assert.rejects(runSeed({ args: ['--mode=volume'], env: { ...env, URBANFIX_SEED_REFERENCE_TIME: reference },
      readCatalog: () => csv, createClient: () => { clients++; } }), /referencia/i);
    assert.equal(clients, 0);
  }
  const invalid = structuredClone(data); invalid.user.pop();
  let clients = 0;
  await assert.rejects(runSeed({ args: ['--mode=volume'], env, readCatalog: () => csv,
    readVolume: () => invalid, createClient: () => { clients++; } }), /Volumen inválido/);
  assert.equal(clients, 0);
  for (const fail of [undefined, 'serviceOffer']) {
    const db = databaseMock({ fail });
    const operation = runSeed({ args: ['--mode=volume'], env, readCatalog: () => csv,
      readVolume: reference => { assert.equal(reference, D); return data; }, createClient: () => db.prisma });
    if (fail) await assert.rejects(operation, /Simulated Volume failure/);
    else assert.deepEqual(await operation, { existing: 0, inserted: 695, total: 695 });
    assert.deepEqual(db.calls.at(-1), ['disconnect']);
  }
});
