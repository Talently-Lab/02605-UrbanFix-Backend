const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateSeedOptions, validateSeedIntegrationOptions, validateGoldenIntegrationOptions, validateVolumeIntegrationOptions, assertSeedIdentity } = require('../prisma/seed/target');
const { runSeed } = require('../prisma/seed/run');
const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');
const manifest = { project: '02605-urbanfix', branch: 'golden', host: 'ep-golden-fixture.eu-central-1.aws.neon.tech', database: 'neondb', user: 'seed_owner' };
const url = `postgresql://seed_owner:fixture@${manifest.host}:5432/neondb?sslmode=verify-full`;
const env = { URBANFIX_SEED_DATABASE_URL: url, URBANFIX_SEED_ALLOW_NEON: '1', URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify(manifest) };
const options = (mode, overrides = {}) => validateSeedOptions({ args: [`--mode=${mode}`], env: { ...env, ...overrides } });

test('Neon exige autorización explícita exacta y separa Golden de Volume', () => {
  for (const mode of ['catalog', 'golden']) assert.equal(options(mode).connectionString, url);
  assert.throws(() => options('volume'));
  const volumeManifest = { ...manifest, branch: 'preproduction', host: 'ep-volume-fixture.eu-central-1.aws.neon.tech' };
  const volumeUrl = url.replace(manifest.host, volumeManifest.host);
  assert.equal(options('volume', { URBANFIX_SEED_DATABASE_URL: volumeUrl,
    URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify(volumeManifest) }).mode, 'volume');
  for (const overrides of [{ URBANFIX_SEED_ALLOW_NEON: undefined }, { URBANFIX_SEED_ALLOW_NEON: '0' },
    { URBANFIX_SEED_NEON_AUTHORIZATION: undefined }, { URBANFIX_SEED_NEON_AUTHORIZATION: '{}' },
    { DATABASE_URL: 'different' }, { NODE_ENV: 'production' }]) assert.throws(() => options('golden', overrides));
  for (const [key, value] of [['project', 'another'], ['branch', 'production'], ['host', 'ep-unknown.neon.tech'],
    ['database', 'other'], ['user', 'other'], ['branch', 'preproduction']]) {
    assert.throws(() => options('golden', { URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify({ ...manifest, [key]: value }) }));
  }
  for (const branch of ['constructor', 'toString', '__proto__', ['golden']]) {
    assert.throws(() => options('catalog', { URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify({ ...manifest, branch }) }));
  }
  assert.throws(() => options('catalog', { URBANFIX_SEED_DATABASE_URL: url.replace('/neondb?', '/undefined?'),
    URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify({ ...manifest, database: undefined }) }));
});

test('Neon rechaza TLS ausente, parámetros ambiguos y nunca habilita integraciones locales', () => {
  for (const connectionString of [url.replace('?sslmode=verify-full', ''), url.replace('verify-full', 'disable'),
    url + '&host=other', url + '&sslmode=disable', url + '#fragment', url + '&schema=private',
    url.replace(':5432', ':55434'), url.replace('seed_owner:', 'other:'), url + '\n']) {
    assert.throws(() => options('golden', { URBANFIX_SEED_DATABASE_URL: connectionString }));
  }
  for (const validate of [validateGoldenIntegrationOptions, validateVolumeIntegrationOptions]) {
    assert.throws(() => validate({ ...env, URBANFIX_RUN_SEED_DB_TESTS: '1' }));
  }
  const primary = url.replace('/neondb?', '/urbanfix_seed_test?');
  const concurrency = url.replace('/neondb?', '/urbanfix_seed_concurrency_test?');
  assert.throws(() => validateSeedIntegrationOptions({ ...env, URBANFIX_RUN_SEED_DB_TESTS: '1',
    URBANFIX_SEED_DATABASE_URL: primary, URBANFIX_SEED_CONCURRENCY_DATABASE_URL: concurrency,
    URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify({ ...manifest, database: 'urbanfix_seed_test' }) }));
});

test('identidad Neon no acepta autorizaciones construidas fuera del validador ni reutilizadas para otro modo', () => {
  const identity = { database: 'neondb', schema: 'public', user: 'seed_owner' };
  assert.throws(() => assertSeedIdentity(identity, 'golden', { ...identity, mode: 'golden' }), /Identidad/);
  const { target } = options('golden');
  assert.doesNotThrow(() => assertSeedIdentity(identity, 'golden', target));
  assert.throws(() => assertSeedIdentity(identity, 'volume', target), /Identidad/);
  assert.throws(() => assertSeedIdentity(identity, 'catalog', target), /Identidad/);
});

test('runner verifica base, schema y usuario transaccionales antes de cualquier escritura Neon', async () => {
  for (const mode of ['catalog', 'golden', 'volume']) {
    for (const identity of [{ database: 'other', schema: 'public', user: 'seed_owner' },
      { database: 'neondb', schema: 'private', user: 'seed_owner' },
      { database: 'neondb', schema: 'public', user: 'other' },
      { database: 'neondb', schema: 'public', user: 'seed_owner' }]) {
      let reads = 0, disconnected = false;
      const operation = runSeed({ args: [`--mode=${mode}`], env: { ...env,
        URBANFIX_SEED_NEON_AUTHORIZATION: JSON.stringify({ ...manifest, branch: mode === 'volume' ? 'preproduction' : 'golden' }),
        URBANFIX_SEED_REFERENCE_TIME: '2026-12-07T03:00:00.000Z' }, readCatalog: () => csv,
        createClient: () => ({ $disconnect: async () => { disconnected = true; },
          $transaction: async callback => callback({ $queryRaw: async () => [identity],
            neighborhood: { findMany: async () => { reads++; throw new Error('identity accepted'); } } }) }) });
      if (identity.database === 'neondb' && identity.schema === 'public' && identity.user === 'seed_owner') {
        await assert.rejects(operation, /identity accepted/); assert.equal(reads, 1);
      } else { await assert.rejects(operation, /Identidad/); assert.equal(reads, 0); }
      assert.equal(disconnected, true);
    }
  }
});
