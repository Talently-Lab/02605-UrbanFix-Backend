const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSeedOptions, validateSeedIntegrationOptions } = require('../prisma/seed/target');

const localUrl = 'postgresql://127.0.0.1:55432/urbanfix_s3_test';
const options = (url, extra = {}) => ({
  args: ['--mode=catalog'], env: { URBANFIX_SEED_DATABASE_URL: url, ...extra },
});

test('seed exige modo catalog explícito y rechaza datasets todavía no implementados', () => {
  for (const args of [[], ['catalog'], ['--mode'], ['--mode=golden'], ['--mode=volume'],
    ['--mode=all'], ['--mode=catalog', '--force'], ['--mode=catalog', '--mode=catalog']]) {
    assert.throws(() => validateSeedOptions({ ...options(localUrl), args }), /modo catalog explícito/);
  }
});

test('seed conserva el destino local previo con conexión dedicada', () => {
  for (const url of [localUrl, localUrl.replace('postgresql:', 'postgres:'),
    localUrl.replace('://', '://fixture:fixture@')]) {
    assert.deepEqual(validateSeedOptions(options(url)), { mode: 'catalog', connectionString: url });
  }
});

test('seed rechaza destinos remotos, alternativos y componentes ambiguos incluso en development', () => {
  for (const url of [undefined, null, '', 123, 'invalid',
    localUrl.replace('127.0.0.1', 'localhost'), localUrl.replace('127.0.0.1', 'production.example.test'),
    localUrl.replace('127.0.0.1', '127.0.0.2'), localUrl.replace('55432', '5432'),
    localUrl.replace('urbanfix_s3_test', 'urbanfix_production'),
    localUrl.replace('postgresql:', 'https:'), `${localUrl}?host=production.example.test`,
    `${localUrl}?`, `${localUrl}#`, `${localUrl}#fragment`, `${localUrl}/`,
    `${localUrl}\n`, ` ${localUrl}`, `${localUrl}\\`,
    localUrl.replace('urbanfix_s3_test', '%75rbanfix_s3_test'),
    localUrl.replace('://', '://fixture@production.example.test@'),
    localUrl.replace('://', '://fixture:%ZZ@')]) {
    assert.throws(() => validateSeedOptions(options(url, { NODE_ENV: 'development' })),
      /Destino del seed no autorizado/);
  }
});

test('seed no utiliza DATABASE_URL como fallback ni admite producción por NODE_ENV', () => {
  assert.throws(() => validateSeedOptions({ args: ['--mode=catalog'], env: { DATABASE_URL: localUrl } }),
    /Destino del seed no autorizado/);
  for (const NODE_ENV of ['production', 'PRODUCTION', ' production ']) {
    assert.throws(() => validateSeedOptions(options(localUrl, { NODE_ENV })), /Destino del seed no autorizado/);
  }
});

test('seed no incluye credenciales ni el destino recibido en mensajes de validación', () => {
  const secretUrl = 'postgresql://private-user:private-secret@production.example.test/database';
  assert.throws(() => validateSeedOptions(options(secretUrl)), error => {
    assert.match(error.message, /Destino del seed no autorizado/);
    assert.ok(!error.message.includes('private-'));
    assert.ok(!error.message.includes('production.example.test'));
    return true;
  });
});

test('seed admite los dos destinos desechables solo con su puerto específico', () => {
  for (const database of ['urbanfix_seed_test', 'urbanfix_seed_concurrency_test']) {
    const url = `postgresql://127.0.0.1:55433/${database}`;
    assert.deepEqual(validateSeedOptions(options(url)), { mode: 'catalog', connectionString: url });
    assert.throws(() => validateSeedOptions(options(url.replace('55433', '55432'))), /Destino del seed no autorizado/);
  }
  for (const url of [localUrl.replace('55432', '55433'),
    'postgresql://127.0.0.1:55433/urbanfix_seed_other_test',
    'postgresql://production.example.test:55433/urbanfix_seed_test',
    'postgresql://127.0.0.1:55433/urbanfix_seed_test?schema=public']) {
    assert.throws(() => validateSeedOptions(options(url)), /Destino del seed no autorizado/);
  }
});

const integrationEnv = {
  URBANFIX_RUN_SEED_DB_TESTS: '1',
  URBANFIX_SEED_DATABASE_URL: 'postgresql://127.0.0.1:55433/urbanfix_seed_test',
  URBANFIX_SEED_CONCURRENCY_DATABASE_URL: 'postgresql://127.0.0.1:55433/urbanfix_seed_concurrency_test',
};

test('integración del seed exige activación y dos bases distintas antes de construir clientes', () => {
  assert.deepEqual(validateSeedIntegrationOptions(integrationEnv), {
    connectionString: integrationEnv.URBANFIX_SEED_DATABASE_URL,
    concurrencyConnectionString: integrationEnv.URBANFIX_SEED_CONCURRENCY_DATABASE_URL,
  });
  for (const invalid of [
    { URBANFIX_RUN_SEED_DB_TESTS: undefined }, { URBANFIX_RUN_SEED_DB_TESTS: '0' },
    { URBANFIX_SEED_DATABASE_URL: undefined }, { URBANFIX_SEED_CONCURRENCY_DATABASE_URL: undefined },
    { URBANFIX_SEED_DATABASE_URL: localUrl }, { URBANFIX_SEED_CONCURRENCY_DATABASE_URL: localUrl },
    { URBANFIX_SEED_CONCURRENCY_DATABASE_URL: integrationEnv.URBANFIX_SEED_DATABASE_URL },
    { URBANFIX_SEED_DATABASE_URL: integrationEnv.URBANFIX_SEED_CONCURRENCY_DATABASE_URL },
    { NODE_ENV: 'production' },
  ]) {
    assert.throws(() => validateSeedIntegrationOptions({ ...integrationEnv, ...invalid }),
      /integración del seed no autorizad/);
  }
});

test('seed acepta las dos bases CP2.1 exclusivamente en 127.0.0.1:55434', () => {
  for (const database of ['urbanfix_seed_cp21_test', 'urbanfix_seed_cp21_concurrency_test']) {
    const url = `postgresql://127.0.0.1:55434/${database}`;
    for (const connectionString of [url, url.replace('postgresql:', 'postgres:'),
      url.replace('://', '://fixture:fixture@')]) {
      assert.deepEqual(validateSeedOptions(options(connectionString)), { mode: 'catalog', connectionString });
    }
  }
});

test('seed rechaza combinaciones incorrectas de nombres y puertos entre los tres entornos', () => {
  for (const database of ['urbanfix_seed_cp21_test', 'urbanfix_seed_cp21_concurrency_test']) {
    for (const port of ['55432', '55433', '5432', '55435']) {
      assert.throws(() => validateSeedOptions(options(`postgresql://127.0.0.1:${port}/${database}`)),
        /Destino del seed no autorizado/);
    }
  }
  for (const database of ['urbanfix_s3_test', 'urbanfix_seed_test', 'urbanfix_seed_concurrency_test',
    'urbanfix_seed_cp21_other_test', 'urbanfix_seed_cp21_concurrency_tests']) {
    assert.throws(() => validateSeedOptions(options(`postgresql://127.0.0.1:55434/${database}`)),
      /Destino del seed no autorizado/);
  }
});

const cp21IntegrationEnv = {
  URBANFIX_RUN_SEED_DB_TESTS: '1',
  URBANFIX_SEED_DATABASE_URL: 'postgresql://127.0.0.1:55434/urbanfix_seed_cp21_test',
  URBANFIX_SEED_CONCURRENCY_DATABASE_URL: 'postgresql://127.0.0.1:55434/urbanfix_seed_cp21_concurrency_test',
};

test('integración acepta la pareja completa CP2.1 y conserva las conexiones explícitas', () => {
  for (const scheme of ['postgresql:', 'postgres:']) {
    const env = { ...cp21IntegrationEnv, DATABASE_URL: localUrl };
    for (const field of ['URBANFIX_SEED_DATABASE_URL', 'URBANFIX_SEED_CONCURRENCY_DATABASE_URL']) {
      env[field] = env[field].replace('postgresql:', scheme).replace('://', '://fixture:fixture@');
    }
    assert.deepEqual(validateSeedIntegrationOptions(env), {
      connectionString: env.URBANFIX_SEED_DATABASE_URL,
      concurrencyConnectionString: env.URBANFIX_SEED_CONCURRENCY_DATABASE_URL,
    });
  }
});

test('integración rechaza las 14 parejas cruzadas, intercambiadas o repetidas entre CP2 y CP2.1', () => {
  const endpoints = [integrationEnv.URBANFIX_SEED_DATABASE_URL,
    integrationEnv.URBANFIX_SEED_CONCURRENCY_DATABASE_URL,
    cp21IntegrationEnv.URBANFIX_SEED_DATABASE_URL,
    cp21IntegrationEnv.URBANFIX_SEED_CONCURRENCY_DATABASE_URL];
  let rejectedPairs = 0;
  for (const [primaryIndex, primary] of endpoints.entries()) {
    for (const [concurrentIndex, concurrent] of endpoints.entries()) {
      if ((primaryIndex === 0 && concurrentIndex === 1) ||
          (primaryIndex === 2 && concurrentIndex === 3)) continue;
      assert.throws(() => validateSeedIntegrationOptions({
        URBANFIX_RUN_SEED_DB_TESTS: '1',
        URBANFIX_SEED_DATABASE_URL: primary,
        URBANFIX_SEED_CONCURRENCY_DATABASE_URL: concurrent,
      }), /integración del seed no autorizad/);
      rejectedPairs++;
    }
  }
  assert.equal(rejectedPairs, 14);
});

test('integración CP2.1 conserva la activación, prohíbe producción y nunca usa DATABASE_URL como fallback', () => {
  for (const invalid of [
    { URBANFIX_RUN_SEED_DB_TESTS: undefined }, { URBANFIX_RUN_SEED_DB_TESTS: '0' },
    { NODE_ENV: 'production' }, { NODE_ENV: 'PRODUCTION' }, { NODE_ENV: ' production ' },
    { URBANFIX_SEED_DATABASE_URL: undefined, DATABASE_URL: cp21IntegrationEnv.URBANFIX_SEED_DATABASE_URL },
    { URBANFIX_SEED_CONCURRENCY_DATABASE_URL: undefined, DATABASE_URL: cp21IntegrationEnv.URBANFIX_SEED_CONCURRENCY_DATABASE_URL },
  ]) {
    assert.throws(() => validateSeedIntegrationOptions({ ...cp21IntegrationEnv, ...invalid }),
      /integración del seed no autorizad/);
  }
});

test('integración CP2.1 rechaza nombres y URLs no autorizados en cualquiera de las dos conexiones sin exponer valores', () => {
  for (const field of ['URBANFIX_SEED_DATABASE_URL', 'URBANFIX_SEED_CONCURRENCY_DATABASE_URL']) {
    const url = cp21IntegrationEnv[field];
    for (const invalid of [null, '', 'invalid',
      url.replace('127.0.0.1', 'localhost'), url.replace('127.0.0.1', '127.0.0.2'),
      url.replace('127.0.0.1', 'private-host.example.test'), url.replace('55434', '55433'),
      url.replace('cp21_', 'cp21_unknown_'), url.replace('postgresql:', 'https:'),
      url.replace('://', '://fixture:%ZZ@'),
      `${url}?host=private-host.example.test`, `${url}?`, `${url}#`, `${url}/`, `${url}\n`, ` ${url}`, `${url}\\`]) {
      assert.throws(() => validateSeedIntegrationOptions({ ...cp21IntegrationEnv, [field]: invalid }), error => {
        assert.match(error.message, /integración del seed no autorizad/);
        assert.ok(!error.message.includes('private-host'));
        assert.ok(!error.message.includes('fixture'));
        return true;
      });
    }
  }
});
