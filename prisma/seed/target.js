const GOLDEN_DATABASE = 'urbanfix_seed_cp3_golden_test';
const VOLUME_DATABASE = 'urbanfix_seed_cp4_volume_test';
const SEED_TARGETS = Object.freeze({
  [GOLDEN_DATABASE]: '55434',
  [VOLUME_DATABASE]: '55434',
  urbanfix_s3_test: '55432',
  urbanfix_seed_test: '55433',
  urbanfix_seed_concurrency_test: '55433',
  urbanfix_seed_cp21_test: '55434',
  urbanfix_seed_cp21_concurrency_test: '55434',
});
const authorizedNeonTargets = new WeakSet();

function validateNeonTarget(connectionString, mode, env) {
  const authorization = JSON.parse(env.URBANFIX_SEED_NEON_AUTHORIZATION);
  const url = new URL(connectionString);
  const branchMode = authorization?.branch === 'golden' ? 'golden'
    : authorization?.branch === 'preproduction' ? 'volume' : undefined;
  if (env.URBANFIX_SEED_ALLOW_NEON !== '1' || authorization?.project !== '02605-urbanfix' ||
      !branchMode || (mode !== 'catalog' && mode !== branchMode) ||
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(authorization.host) ||
      url.hostname !== authorization.host || (url.port && url.port !== '5432') ||
      typeof authorization.database !== 'string' || !/^[a-zA-Z0-9_]+$/.test(authorization.database) || url.pathname !== `/${authorization.database}` ||
      !/^[a-zA-Z0-9_]+$/.test(authorization.user) || decodeURIComponent(url.username) !== authorization.user ||
      !url.password || url.hash || !url.search ||
      url.searchParams.get('sslmode') !== 'verify-full' ||
      [...url.searchParams].some(([key, value]) => !['sslmode', 'channel_binding'].includes(key) ||
        url.searchParams.getAll(key).length !== 1 || (key === 'channel_binding' && value !== 'require')) ||
      (env.DATABASE_URL !== undefined && env.DATABASE_URL !== connectionString)) throw new Error();
  decodeURIComponent(url.password);
  const target = Object.freeze({ database: authorization.database, user: authorization.user, mode });
  authorizedNeonTargets.add(target);
  return target;
}

function assertSeedIdentity(identity, mode, target) {
  const expectedDatabase = mode === 'golden' ? GOLDEN_DATABASE : VOLUME_DATABASE;
  const valid = target
    ? authorizedNeonTargets.has(target) && target.mode === mode && identity?.database === target.database && identity?.user === target.user
    : mode === 'catalog' ? Object.hasOwn(SEED_TARGETS, identity?.database) : identity?.database === expectedDatabase;
  if (!valid || identity?.schema !== 'public') throw new Error('Identidad de la base no autorizada');
}

function validateSeedOptions({ args, env }) {
  if (!Array.isArray(args) || args.length !== 1 || !['--mode=catalog', '--mode=golden', '--mode=volume'].includes(args[0])) {
    throw new Error('Se requiere modo catalog explícito, modo golden explícito o modo volume explícito');
  }
  const mode = args[0].slice('--mode='.length);
  const connectionString = env.URBANFIX_SEED_DATABASE_URL;
  const production = typeof env.NODE_ENV === 'string' && env.NODE_ENV.trim().toLowerCase() === 'production';
  try {
    if (production || typeof connectionString !== 'string' || /[\s\\#]/.test(connectionString)) throw new Error();
    if (/^postgres(?:ql)?:\/\//.test(connectionString) && new URL(connectionString).hostname !== '127.0.0.1') {
      const target = validateNeonTarget(connectionString, mode, env);
      return { mode, connectionString, target };
    }
    if (production || typeof connectionString !== 'string' || /[\s\\?#]/.test(connectionString) ||
        !/^postgres(?:ql)?:\/\/(?:[^@/?#\\\s]+@)?127\.0\.0\.1:(?:55432|55433|55434)\/[a-z0-9_]+$/.test(connectionString)) {
      throw new Error();
    }
    const url = new URL(connectionString);
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    const database = url.pathname.slice(1);
    if (url.hostname !== '127.0.0.1' || !Object.hasOwn(SEED_TARGETS, database) ||
        url.port !== SEED_TARGETS[database] || url.search || url.hash ||
        (mode === 'golden' && database !== GOLDEN_DATABASE) ||
        (mode === 'volume' && database !== VOLUME_DATABASE)) {
      throw new Error();
    }
  } catch {
    throw new Error('Destino del seed no autorizado');
  }
  return { mode, connectionString };
}

function validateGoldenIntegrationOptions(env) {
  if (env.URBANFIX_RUN_SEED_DB_TESTS !== '1') {
    throw new Error('Integración Golden no autorizada');
  }
  const { connectionString, target } = validateSeedOptions({ args: ['--mode=golden'], env });
  if (target) throw new Error('Integración Golden no autorizada');
  return { connectionString };
}

function validateVolumeIntegrationOptions(env) {
  if (env.URBANFIX_RUN_SEED_DB_TESTS !== '1') throw new Error('Integración Volumen no autorizada');
  const { connectionString, target } = validateSeedOptions({ args: ['--mode=volume'], env });
  if (target) throw new Error('Integración Volumen no autorizada');
  return { connectionString };
}

function validateSeedIntegrationOptions(env) {
  try {
    if (env.URBANFIX_RUN_SEED_DB_TESTS !== '1') throw new Error();
    const { connectionString, target } = validateSeedOptions({ args: ['--mode=catalog'], env });
    const { connectionString: concurrencyConnectionString, target: concurrencyTarget } = validateSeedOptions({
      args: ['--mode=catalog'],
      env: { ...env, URBANFIX_SEED_DATABASE_URL: env.URBANFIX_SEED_CONCURRENCY_DATABASE_URL },
    });
    if (target || concurrencyTarget) throw new Error();
    const database = new URL(connectionString).pathname;
    const concurrencyDatabase = new URL(concurrencyConnectionString).pathname;
    const authorizedPair = [
      ['/urbanfix_seed_test', '/urbanfix_seed_concurrency_test'],
      ['/urbanfix_seed_cp21_test', '/urbanfix_seed_cp21_concurrency_test'],
    ].some(([primary, concurrent]) => database === primary && concurrencyDatabase === concurrent);
    if (!authorizedPair) {
      throw new Error();
    }
    return { connectionString, concurrencyConnectionString };
  } catch {
    throw new Error('Destinos de integración del seed no autorizados');
  }
}

module.exports = { SEED_TARGETS, GOLDEN_DATABASE, VOLUME_DATABASE, validateSeedOptions, assertSeedIdentity,
  validateSeedIntegrationOptions, validateGoldenIntegrationOptions, validateVolumeIntegrationOptions };
