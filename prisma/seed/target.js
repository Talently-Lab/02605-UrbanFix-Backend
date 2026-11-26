const SEED_TARGETS = Object.freeze({
  urbanfix_s3_test: '55432',
  urbanfix_seed_test: '55433',
  urbanfix_seed_concurrency_test: '55433',
});

function validateSeedOptions({ args, env }) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--mode=catalog') {
    throw new Error('Se requiere modo catalog explícito: --mode=catalog');
  }
  const connectionString = env.URBANFIX_SEED_DATABASE_URL;
  const production = typeof env.NODE_ENV === 'string' && env.NODE_ENV.trim().toLowerCase() === 'production';
  try {
    if (production || typeof connectionString !== 'string' || /[\s\\?#]/.test(connectionString) ||
        !/^postgres(?:ql)?:\/\/(?:[^@/?#\\\s]+@)?127\.0\.0\.1:(?:55432|55433)\/[a-z0-9_]+$/.test(connectionString)) {
      throw new Error();
    }
    const url = new URL(connectionString);
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    const database = url.pathname.slice(1);
    if (url.hostname !== '127.0.0.1' || !Object.hasOwn(SEED_TARGETS, database) ||
        url.port !== SEED_TARGETS[database] || url.search || url.hash) {
      throw new Error();
    }
  } catch {
    throw new Error('Destino del seed no autorizado');
  }
  return { mode: 'catalog', connectionString };
}

function validateSeedIntegrationOptions(env) {
  try {
    if (env.URBANFIX_RUN_SEED_DB_TESTS !== '1') throw new Error();
    const { connectionString } = validateSeedOptions({ args: ['--mode=catalog'], env });
    const { connectionString: concurrencyConnectionString } = validateSeedOptions({
      args: ['--mode=catalog'],
      env: { ...env, URBANFIX_SEED_DATABASE_URL: env.URBANFIX_SEED_CONCURRENCY_DATABASE_URL },
    });
    if (new URL(connectionString).pathname !== '/urbanfix_seed_test' ||
        new URL(concurrencyConnectionString).pathname !== '/urbanfix_seed_concurrency_test') {
      throw new Error();
    }
    return { connectionString, concurrencyConnectionString };
  } catch {
    throw new Error('Destinos de integración del seed no autorizados');
  }
}

module.exports = { SEED_TARGETS, validateSeedOptions, validateSeedIntegrationOptions };
