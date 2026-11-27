const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
const tables = ['user', 'technician', 'technicianSpecialty', 'technicianNeighborhood', 'serviceRequest', 'serviceOffer'];

function fixture() {
  return require('../prisma/data/golden').createGoldenDataset();
}

function validate(data) {
  return require('../prisma/seed/golden').validateGoldenDataset(data);
}

function databaseMock({ fail, identity = 'urbanfix_seed_cp3_golden_test' } = {}) {
  const catalog = require('../prisma/seed/validate').validateCatalogCsv(csv);
  let rows = Object.fromEntries(tables.map(table => [table, []]));
  rows.neighborhood = catalog.map((row, i) => ({ ...row,
    id: `c3000005-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
  const calls = [];
  return {
    rows: () => rows,
    calls,
    prisma: {
      $transaction: async (callback, options) => {
        calls.push(['transaction', options]);
        const staged = structuredClone(rows);
        const tx = { $queryRaw: async () => {
          calls.push(['identity']); return [{ database: identity, schema: 'public' }];
        } };
        for (const table of ['neighborhood', ...tables]) tx[table] = {
          findMany: async () => { calls.push(['read', table]); return structuredClone(staged[table]); },
          createMany: async ({ data }) => {
            calls.push(['insert', table, data.length]);
            staged[table].push(...structuredClone(data));
            if (fail === table) throw new Error('simulated Golden failure');
            return { count: data.length };
          },
        };
        const result = await callback(tx);
        if (fail === 'commit') throw new Error('simulated Golden failure');
        rows = staged;
        return result;
      },
    },
  };
}

const seed = (db, data = fixture()) => require('../prisma/seed/golden').seedGolden(db.prisma, data, csv);

test('Golden carga seis lotes en orden referencial y conserva catálogo y registros ajenos', async () => {
  const db = databaseMock();
  const foreign = { ...fixture().user[0], id: 'c3000001-0000-4000-8000-000000000099',
    email: 'control.independiente@example.com', name: 'Control independiente' };
  db.rows().user.push(foreign);
  const neighborhoods = structuredClone(db.rows().neighborhood);
  assert.deepEqual(await seed(db), { existing: 0, inserted: 96, total: 96 });
  assert.deepEqual(db.calls.filter(call => call[0] === 'insert'),
    tables.map((table, i) => ['insert', table, [17, 9, 13, 19, 18, 20][i]]));
  assert.deepEqual(db.calls.filter(call => call[0] === 'read').map(call => call[1]), ['neighborhood', ...tables]);
  assert.deepEqual(db.calls[0], ['transaction', { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 }]);
  assert.deepEqual(db.rows().neighborhood, neighborhoods);
  assert.deepEqual(db.rows().user[0], foreign);
  assert.equal(db.rows().serviceRequest.every(row => row.neighborhoodId && !('neighborhoodName' in row)), true);
});

test('Golden conserva UUID y fechas en cargas parciales compatibles y en la segunda carga sin INSERT', async () => {
  const db = databaseMock();
  const data = fixture();
  db.rows().user.push({ ...data.user[0], createdAt: new Date(data.user[0].createdAt) });
  assert.deepEqual(await seed(db, data), { existing: 1, inserted: 95, total: 96 });
  const before = structuredClone(db.rows());
  db.calls.length = 0;
  assert.deepEqual(await seed(db, data), { existing: 96, inserted: 0, total: 96 });
  assert.deepEqual(db.rows(), before);
  assert.equal(db.calls.some(call => call[0] === 'insert'), false);
});

test('Golden revierte todos los lotes si falla cualquier tabla o el commit', async () => {
  const data = fixture();
  for (const fail of [...tables, 'commit']) {
    const db = databaseMock({ fail });
    const before = structuredClone(db.rows());
    await assert.rejects(seed(db, data), /simulated Golden failure/);
    assert.deepEqual(db.rows(), before);
  }
});

test('Golden aborta ante identidades, catálogo y colisiones sin corregir datos existentes', async () => {
  for (const mutate of [
    db => db.rows().neighborhood.pop(),
    db => { db.rows().neighborhood[0].comuna = 1; },
    db => db.rows().user.push({ ...fixture().user[0], name: 'Modificado' }),
    db => db.rows().user.push({ ...fixture().user[0],
      id: 'c3000001-0000-4000-8000-000000000099', email: fixture().user[0].email.toUpperCase() }),
    db => db.rows().technician.push({ ...fixture().technician[0], id: 'c3000002-0000-4000-8000-000000000099' }),
  ]) {
    const db = databaseMock(); mutate(db);
    const before = structuredClone(db.rows());
    await assert.rejects(seed(db), /discrepancias/);
    assert.equal(db.calls.some(call => call[0] === 'insert'), false);
    assert.deepEqual(db.rows(), before);
  }
  const db = databaseMock({ identity: 'urbanfix_seed_cp21_test' });
  await assert.rejects(seed(db), /Identidad/);
  assert.equal(db.calls.some(call => call[0] === 'read'), false);
});

test('Golden conserva contrato DA, UUID deterministas, campos auxiliares y R fijo', () => {
  const data = fixture();
  assert.deepEqual(data, fixture());
  assert.equal(data.reference, '2026-12-07T15:00:00.000Z');
  assert.deepEqual(Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value))
    .map(([key, rows]) => [key, rows.length])), {
    user: 17, technician: 9, technicianSpecialty: 13, technicianNeighborhood: 19,
    serviceRequest: 18, serviceOffer: 20,
  });
  assert.equal(validate(data), data);
  assert.deepEqual(data.user.filter(row => row.isTestUser).map(row => row.name).sort(),
    ['Golden C7', 'Golden T9']);
  for (const user of data.user) {
    assert.match(user.email, /^urbanfix\.golden\.[act]\d@example\.com$/);
    assert.equal(user.phone === null, user.role === 'ADMIN');
    assert.equal(require('bcryptjs').compareSync('UrbanFixGolden2026!', user.passwordHash), true);
  }
});

test('Golden conserva las 18 solicitudes y sus hechos temporales del DA', () => {
  const data = fixture();
  const byName = new Map(data.user.map(row => [row.id, row.name]));
  const tech = new Map(data.technician.map(row => [row.id, byName.get(row.userId)]));
  assert.deepEqual(data.serviceRequest.map(row => [row.status, row.acceptedAt, row.completedAt]), [
    ['COMPLETED', '2026-12-01T13:30:00.000Z', '2026-12-01T18:00:00.000Z'],
    ['COMPLETED', '2026-12-01T16:00:00.000Z', '2026-12-02T12:00:00.000Z'],
    ['COMPLETED', '2026-12-02T14:01:00.000Z', '2026-12-02T19:00:00.000Z'],
    ['COMPLETED', '2026-12-02T18:00:00.000Z', '2026-12-03T15:00:00.000Z'],
    ['COMPLETED', '2026-12-04T11:59:00.000Z', '2026-12-04T20:00:00.000Z'],
    ['IN_PROGRESS', '2026-12-04T16:00:00.000Z', null],
    ['PENDING', null, null], ['CANCELLED', null, null],
    ['CANCELLED', '2026-12-05T14:00:00.000Z', null], ['PENDING', null, null],
    ['ACCEPTED', '2026-12-06T16:00:00.000Z', null],
    ['IN_PROGRESS', '2026-12-06T17:00:00.000Z', null], ['PENDING', null, null],
    ['COMPLETED', '2026-11-29T17:30:00.000Z', '2026-11-30T12:00:00.000Z'],
    ['COMPLETED', '2026-11-29T16:00:00.000Z', '2026-11-30T10:00:00.000Z'],
    ['CANCELLED', null, null],
    ['COMPLETED', '2026-12-04T14:00:00.000Z', '2026-12-04T19:00:00.000Z'],
    ['COMPLETED', '2026-12-02T10:30:00.000Z', '2026-12-02T11:30:00.000Z'],
  ]);
  assert.deepEqual(data.serviceRequest.filter(row => ['ACCEPTED', 'IN_PROGRESS'].includes(row.status))
    .map(row => tech.get(row.technicianId)).sort(), ['Golden T1', 'Golden T2', 'Golden T5']);
  assert.equal(data.serviceOffer[10].status, 'PENDING');
  assert.equal(data.serviceOffer[13].expiresAt, '2026-12-08T10:00:00.000Z');
});

test('Golden reproduce resultados Seed v1 con ambas variantes de moderación y filtro R2', () => {
  const data = fixture();
  const testUsers = new Set(data.user.filter(row => row.isTestUser).map(row => row.id));
  const clean = data.serviceRequest.filter(row => !testUsers.has(row.clientId));
  const r = Date.parse(data.reference);
  const day = 86400000;
  const mature = clean.filter(row => Date.parse(row.createdAt) >= r - 8 * day && Date.parse(row.createdAt) < r - day);
  const admin = data.user.find(row => row.role === 'ADMIN').id;
  for (const exclude of [true, false]) {
    const rows = mature.filter(row => !exclude || row.acceptedAt || row.cancelledById !== admin);
    assert.equal(rows.length, exclude ? 13 : 14);
    for (const [minutes, expected] of [[Infinity, exclude ? '76.92' : '71.43'],
      [120, exclude ? '30.77' : '28.57'], [1440, exclude ? '69.23' : '64.29']]) {
      const accepted = rows.filter(row => row.acceptedAt &&
        (Date.parse(row.acceptedAt) - Date.parse(row.createdAt)) / 60000 <= minutes).length;
      assert.equal((100 * accepted / rows.length).toFixed(2), expected);
    }
  }
  const recent = clean.filter(row => Date.parse(row.createdAt) >= r - 7 * day);
  assert.equal(recent.length, 15);
  const times = recent.filter(row => row.acceptedAt).map(row =>
    (Date.parse(row.acceptedAt) - Date.parse(row.createdAt)) / 60000).sort((a, b) => a - b);
  assert.equal((times[4] + times[5]) / 2, 150.5);
  assert.equal(Number((times[8] + 0.1 * (times[9] - times[8])).toFixed(1)), 1451.1);
  const testTechs = new Set(data.technician.filter(row => testUsers.has(row.userId)).map(row => row.id));
  const active = new Set(data.serviceOffer.filter(row => !testTechs.has(row.technicianId) &&
    Date.parse(row.createdAt) >= r - 7 * day && ['ACCEPTED', 'REJECTED'].includes(row.status))
    .map(row => row.technicianId));
  assert.equal(active.size, 5);
  assert.equal(recent.length / active.size, 3);
  const cleanIds = new Set(clean.map(row => row.id));
  const offers = data.serviceOffer.filter(row => cleanIds.has(row.requestId));
  const states = {};
  for (const row of offers) {
    const state = row.status === 'PENDING' && Date.parse(row.expiresAt) <= r ? 'EXPIRED' : row.status;
    states[state] = (states[state] || 0) + 1;
  }
  assert.deepEqual(states, { ACCEPTED: 12, REJECTED: 1, EXPIRED: 2, CANCELLED: 2, PENDING: 1, RELEASED: 1 });
  const response = offers.filter(row => Date.parse(row.createdAt) >= r - 8 * day &&
    Date.parse(row.createdAt) < r - day && !['CANCELLED', 'RELEASED'].includes(row.status));
  assert.equal(response.length, 13);
  assert.equal(response.filter(row => row.status === 'ACCEPTED').length, 10);
  assert.equal((100 * response.filter(row => row.status === 'ACCEPTED').length / response.length).toFixed(2), '76.92');
  assert.deepEqual(['Palermo', 'Caballito', 'Almagro'].map(name => clean.filter(row => row.neighborhoodName === name).length), [6, 6, 5]);
  const categoryOrder = ['PLUMBING', 'ELECTRICITY', 'GAS', 'LOCKSMITH', 'MASONRY'];
  assert.deepEqual(categoryOrder.map(category => clean.filter(row => row.category === category).length), [7, 4, 3, 2, 1]);
  assert.deepEqual(categoryOrder.map(category => recent.filter(row => row.category === category).length), [5, 4, 3, 2, 1]);
  const moderated = mature.filter(row => row.acceptedAt || row.cancelledById !== admin);
  assert.deepEqual(categoryOrder.map(category => moderated.filter(row => row.category === category).length), [6, 3, 2, 2, 0]);
  assert.deepEqual(categoryOrder.map(category => moderated.filter(row => row.category === category && !row.acceptedAt).length), [2, 0, 1, 0, 0]);
  const enabled = new Set(data.technician.filter(row => row.approvalStatus === 'APPROVED' &&
    data.user.some(user => user.id === row.userId && user.accountStatus === 'ACTIVE' && !user.isTestUser)).map(row => row.id));
  assert.deepEqual(categoryOrder.map(category => data.technicianSpecialty.filter(row =>
    enabled.has(row.technicianId) && row.category === category).length), [3, 2, 2, 1, 1]);
  assert.deepEqual(['ANY', 'MORNING', 'AFTERNOON'].map(time => clean.filter(row => row.preferredTime === time).length), [15, 1, 1]);
  assert.deepEqual(['COMPLETED', 'IN_PROGRESS', 'ACCEPTED', 'PENDING', 'CANCELLED']
    .map(status => clean.filter(row => row.status === status).length), [8, 2, 1, 3, 3]);
  assert.equal(clean.filter(request => offers.filter(offer => offer.requestId === request.id).length > 1).length, 2);
});

test('Golden rechaza contratos, identidades, campos y referencias inconsistentes', () => {
  for (const mutate of [
    d => d.user.pop(), d => { d.reference = '2026-12-08T15:00:00.000Z'; },
    d => { d.user[1].id = d.user[0].id; }, d => { d.user[1].phone = null; },
    d => { d.user[0].phone = '+5491100000000'; }, d => { d.user[1].email = 'QA@example.com'; },
    d => { d.user[1].isTestUser = true; }, d => { d.technicianSpecialty[1].licenseNumber = null; },
    d => { d.serviceRequest[0].clientId = d.user[0].id; },
    d => { d.serviceRequest[0].description = 'corta'; },
    d => { d.serviceRequest[0].neighborhoodName = 'Desconocido'; },
    d => { d.serviceRequest[0].technicianId = null; },
    d => { d.serviceRequest[0].preferredTime = 'NIGHT'; },
    d => { d.technicianNeighborhood[0].neighborhoodName = 'Desconocido'; },
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => validate(data), /Golden inválido/);
  }
});

test('Golden rechaza fechas y estados incompatibles, solapamientos y ofertas a técnicos no elegibles', () => {
  for (const mutate of [
    d => { d.serviceRequest[0].completedAt = '2026-12-01T13:00:00.000Z'; },
    d => { d.serviceRequest[0].updatedAt = '2026-12-08T00:00:00.000Z'; },
    d => { d.serviceRequest[6].acceptedAt = '2026-12-04T13:00:00.000Z'; },
    d => { d.serviceRequest[8].cancelledById = d.serviceRequest[8].clientId; },
    d => { d.serviceOffer[0].expiresAt = '2026-12-02T14:00:00.000Z'; },
    d => { d.serviceOffer[0].createdAt = '2026-12-01T13:01:00.000Z'; },
    d => { d.serviceOffer[0].technicianId = d.technician[5].id; },
    d => { d.serviceOffer[0].technicianId = d.technician[1].id; },
    d => { d.technician[0].approvalStatus = 'PENDING'; },
    d => { d.serviceRequest[0].completedAt = '2026-12-03T18:00:00.000Z'; d.serviceRequest[0].updatedAt = d.serviceRequest[0].completedAt; },
    d => { d.serviceOffer[10].status = 'ACCEPTED'; },
    d => { d.serviceOffer[17].status = 'PENDING'; },
    d => { d.serviceOffer[18].technicianId = d.technician[1].id; },
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => validate(data), /Golden inválido/);
  }
});
