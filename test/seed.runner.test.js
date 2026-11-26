const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { runSeed } = require('../prisma/seed/run');
const { validateCatalogCsv } = require('../prisma/seed/validate');

const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
const catalog = validateCatalogCsv(csv);
const env = { URBANFIX_SEED_DATABASE_URL: 'postgresql://127.0.0.1:55432/urbanfix_s3_test' };
const args = ['--mode=catalog'];

function mockClient(events, failure) {
  return {
    $transaction: async callback => {
      events.push('transaction');
      if (failure) throw failure;
      return callback({
        $queryRaw: async () => [{ database: 'urbanfix_s3_test', schema: 'public' }],
        neighborhood: { findMany: async () => catalog.map((row, index) => ({ id: String(index), ...row })) },
      });
    },
    $disconnect: async () => { events.push('disconnect'); },
  };
}

test('seed runner valida modo y destino antes de leer CSV o construir el cliente', async () => {
  for (const invalid of [{ args: [] }, { env: {} }, { env: { ...env, NODE_ENV: 'production' } }]) {
    const events = [];
    await assert.rejects(runSeed({ args, env, ...invalid,
      readCatalog: () => { events.push('read'); return csv; },
      createClient: () => { events.push('client'); return mockClient(events); },
    }));
    assert.deepEqual(events, []);
  }
});

test('seed runner rechaza CSV inválido o inaccesible antes de construir el cliente', async () => {
  for (const readCatalog of [() => 'invalid', () => { throw new Error('read failure'); }]) {
    let constructed = false;
    await assert.rejects(runSeed({ args, env, readCatalog,
      createClient: () => { constructed = true; },
    }));
    assert.equal(constructed, false);
  }
});

test('seed runner utiliza la conexión dedicada y desconecta después de una ejecución simulada', async () => {
  const events = [];
  const result = await runSeed({ args, env: { ...env, DATABASE_URL: 'ignored' },
    readCatalog: () => { events.push('read'); return csv; },
    createClient: connectionString => {
      assert.equal(connectionString, env.URBANFIX_SEED_DATABASE_URL);
      events.push('client');
      return mockClient(events);
    },
  });
  assert.deepEqual(result, { existing: 48, inserted: 0, total: 48 });
  assert.deepEqual(events, ['read', 'client', 'transaction', 'disconnect']);
});

test('seed runner desconecta también cuando falla la transacción', async () => {
  const events = [];
  const failure = new Error('simulated transaction failure');
  await assert.rejects(runSeed({ args, env, readCatalog: () => csv,
    createClient: () => mockClient(events, failure),
  }), error => error === failure);
  assert.deepEqual(events, ['transaction', 'disconnect']);
});

async function runEntry({ entryArgs = args, entryEnv = env, content = csv, failure, main = true } = {}) {
  const events = [];
  const logs = [];
  const errors = [];
  const entry = require.resolve('../prisma/seed/run');
  const localRequire = createRequire(entry);
  const module = { exports: {} };
  const process = { argv: ['node', 'run.js', ...entryArgs], env: entryEnv };
  const fakeRequire = name => {
    if (name === 'node:fs') return { readFileSync: file => {
      assert.equal(file, join(__dirname, '../prisma/data/Barrios.csv'));
      events.push('read'); return content;
    } };
    if (name === '@prisma/adapter-pg') {
      events.push('load-adapter');
      return { PrismaPg: class { constructor(config) {
        assert.equal(config.connectionString, env.URBANFIX_SEED_DATABASE_URL);
        events.push('adapter');
      } } };
    }
    if (name === '@prisma/client') {
      events.push('load-prisma');
      return { PrismaClient: class { constructor() { events.push('client'); return mockClient(events, failure); } } };
    }
    assert.ok(!name.includes('dotenv') && !name.includes('lib/prisma'));
    return localRequire(name);
  };
  fakeRequire.main = main ? module : {};
  vm.runInNewContext(readFileSync(entry, 'utf8'), {
    require: fakeRequire, module, __dirname: join(__dirname, '../prisma/seed'), process,
    console: { log: value => logs.push(JSON.parse(value)), error: value => errors.push(JSON.parse(value)) },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { events, logs, errors, process };
}

test('seed entrypoint importado no lee archivos, configura entorno ni carga Prisma', async () => {
  const result = await runEntry({ main: false });
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.errors, []);
});

test('seed entrypoint valida todo antes de cargar Prisma y comunica solo el resumen', async () => {
  const result = await runEntry();
  assert.deepEqual(result.events.slice(0, 1), ['read']);
  assert.ok(result.events.includes('adapter'));
  assert.ok(result.events.includes('client'));
  assert.equal(result.events.at(-1), 'disconnect');
  assert.deepEqual(result.logs, [{ mode: 'catalog', existing: 48, inserted: 0, total: 48 }]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.process.exitCode, undefined);
});

test('seed entrypoint inválido termina con código 1 sin cargar Prisma ni filtrar entradas', async () => {
  for (const input of [{ entryArgs: [] }, { entryEnv: {} }, { content: 'private-csv' }]) {
    const result = await runEntry(input);
    assert.ok(!result.events.includes('client') && !result.events.includes('load-prisma'));
    assert.equal(result.process.exitCode, 1);
    assert.deepEqual(result.logs, []);
    assert.equal(result.errors.length, 1);
    assert.ok(!JSON.stringify(result.errors).includes('private-'));
  }
});

test('seed entrypoint sanitiza errores de base y comunica el número de discrepancias', async () => {
  for (const failure of [new Error('private-secret postgresql://private-host'),
    Object.assign(new Error('private-neighborhood'), { code: 'SEED_CATALOG_DISCREPANCY', unexpectedCount: 2 })]) {
    const result = await runEntry({ failure });
    assert.equal(result.events.at(-1), 'disconnect');
    assert.equal(result.process.exitCode, 1);
    assert.deepEqual(result.logs, []);
    assert.equal(result.errors.length, 1);
    assert.ok(!JSON.stringify(result.errors).includes('private-'));
    if (failure.code === 'SEED_CATALOG_DISCREPANCY') {
      assert.equal(result.errors[0].unexpectedCount, 2);
    }
  }
});
