const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { seedCatalog } = require('../prisma/seed/catalog');
const { validateCatalogCsv } = require('../prisma/seed/validate');

const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
const catalog = validateCatalogCsv(csv);

function databaseMock(
  existing = [],
  {
    failInsert = false,
    failCommit = false,
    database = 'urbanfix_s3_test',
    schema = 'public',
  } = {},
) {
  let rows = structuredClone(existing);
  const calls = [];
  const prisma = {
    $transaction: async (callback, options) => {
      calls.push(['transaction', options]);
      const staged = structuredClone(rows);
      const result = await callback({
        $queryRaw: async () => {
          calls.push(['identity']);
          return [{ database, schema }];
        },
        neighborhood: {
          findMany: async (args) => {
            calls.push(['findMany', args]);
            return structuredClone(staged);
          },
          createMany: async (args) => {
            calls.push(['createMany', args]);
            for (const data of args.data) {
              staged.push({ id: randomUUID(), ...data });
              if (failInsert) throw new Error('simulated insert failure');
            }
            return { count: args.data.length };
          },
        },
      });
      if (failCommit) throw new Error('simulated commit failure');
      rows = staged;
      return result;
    },
  };
  return { prisma, calls, rows: () => structuredClone(rows) };
}

test('seed inserta el catálogo vacío en un único lote y una transacción Serializable', async () => {
  const db = databaseMock();
  assert.deepEqual(await seedCatalog(db.prisma, csv), {
    existing: 0,
    inserted: 48,
    total: 48,
  });
  assert.equal(db.rows().length, 48);
  assert.deepEqual(
    db.calls.map(([name]) => name),
    ['transaction', 'identity', 'findMany', 'createMany'],
  );
  assert.deepEqual(db.calls[0][1], {
    isolationLevel: 'Serializable',
    maxWait: 5000,
    timeout: 10000,
  });
  assert.deepEqual(db.calls[2][1], {
    select: { id: true, name: true, comuna: true },
  });
  assert.deepEqual(db.calls[3][1], { data: catalog });
});

test('seed conserva UUID y relaciones existentes e inserta únicamente los faltantes', async () => {
  const existing = catalog.slice(0, 12).map((row) => ({
    ...row,
    id: randomUUID(),
    technicians: ['existing-technician'],
    requests: ['existing-request'],
  }));
  const db = databaseMock(existing);
  assert.deepEqual(await seedCatalog(db.prisma, csv), {
    existing: 12,
    inserted: 36,
    total: 48,
  });
  assert.deepEqual(db.rows().slice(0, 12), existing);
  assert.deepEqual(db.calls.find(([name]) => name === 'createMany')[1], {
    data: catalog.slice(12),
  });
});

test('seed es idempotente y no escribe en la segunda ejecución', async () => {
  const db = databaseMock();
  await seedCatalog(db.prisma, csv);
  const snapshot = db.rows();
  db.calls.length = 0;
  assert.deepEqual(await seedCatalog(db.prisma, csv), {
    existing: 48,
    inserted: 0,
    total: 48,
  });
  assert.deepEqual(db.rows(), snapshot);
  assert.deepEqual(
    db.calls.map(([name]) => name),
    ['transaction', 'identity', 'findMany'],
  );
});

test('seed informa discrepancias y aborta sin corregir variantes ni barrios ajenos', async () => {
  for (const name of ['palermo', 'Nunez', ' Palermo ', 'Fuera del catálogo']) {
    const existing = [{ id: randomUUID(), name, requests: ['preserved'] }];
    const db = databaseMock(existing);
    await assert.rejects(
      seedCatalog(db.prisma, csv),
      (error) =>
        error.code === 'SEED_CATALOG_DISCREPANCY' &&
        error.unexpectedCount === 1,
    );
    assert.deepEqual(db.rows(), existing);
    assert.ok(!db.calls.some(([operation]) => operation === 'createMany'));
  }
});

test('seed rechaza comunas incorrectas sin modificar los registros existentes', async () => {
  for (const comuna of [13, 0, 16, null, undefined]) {
    const existing = [
      {
        id: randomUUID(),
        name: 'Palermo',
        comuna,
        requests: ['preserved'],
      },
    ];

    const db = databaseMock(existing);

    await assert.rejects(
      seedCatalog(db.prisma, csv),
      (error) =>
        error.code === 'SEED_CATALOG_DISCREPANCY' &&
        error.unexpectedCount === 1,
    );

    assert.deepEqual(db.rows(), existing);
    assert.ok(!db.calls.some(([operation]) => operation === 'createMany'));
  }
});

test('seed valida CSV antes de iniciar una transacción y verifica identidad antes de consultar barrios', async () => {
  const invalidCsv = databaseMock();
  await assert.rejects(
    seedCatalog(invalidCsv.prisma, 'invalid'),
    /CSV de barrios/,
  );
  assert.deepEqual(invalidCsv.calls, []);
  for (const identity of [
    { database: 'production' },
    { schema: 'other_schema' },
  ]) {
    const db = databaseMock([], identity);
    await assert.rejects(
      seedCatalog(db.prisma, csv),
      /Identidad de la base no autorizada/,
    );
    assert.deepEqual(
      db.calls.map(([name]) => name),
      ['transaction', 'identity'],
    );
    assert.deepEqual(db.rows(), []);
  }
});

test('seed revierte todas las inserciones ante errores del lote o del commit', async () => {
  const existing = [
    {
      id: randomUUID(),
      name: 'Palermo',
      comuna: 14,
    },
  ];
  for (const failure of [{ failInsert: true }, { failCommit: true }]) {
    const db = databaseMock(existing, failure);
    await assert.rejects(seedCatalog(db.prisma, csv), /simulated/);
    assert.deepEqual(db.rows(), existing);
  }
});

test('seed reconoce la identidad de ambas bases desechables sin cambiar la carga por lotes', async () => {
  for (const database of [
    'urbanfix_seed_test',
    'urbanfix_seed_concurrency_test',
  ]) {
    const db = databaseMock([], { database });
    assert.deepEqual(await seedCatalog(db.prisma, csv), {
      existing: 0,
      inserted: 48,
      total: 48,
    });
    assert.deepEqual(
      db.calls.map(([name]) => name),
      ['transaction', 'identity', 'findMany', 'createMany'],
    );
  }
  const unknown = databaseMock([], { database: 'urbanfix_seed_other_test' });
  await assert.rejects(
    seedCatalog(unknown.prisma, csv),
    /Identidad de la base no autorizada/,
  );
  assert.deepEqual(unknown.rows(), []);
});
