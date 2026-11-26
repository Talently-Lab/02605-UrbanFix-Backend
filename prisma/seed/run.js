const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateSeedOptions } = require('./target');
const { validateCatalogCsv } = require('./validate');
const { seedCatalog } = require('./catalog');

function createSeedClient(connectionString) {
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

async function runSeed({
  args = process.argv.slice(2),
  env = process.env,
  readCatalog = () => readFileSync(join(__dirname, '../data/Barrios.csv'), 'utf8'),
  createClient = createSeedClient,
} = {}) {
  const { connectionString } = validateSeedOptions({ args, env });
  const csv = readCatalog();
  validateCatalogCsv(csv);
  const prisma = createClient(connectionString);
  try {
    return await seedCatalog(prisma, csv);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runSeed().then(result => {
    console.log(JSON.stringify({ mode: 'catalog', ...result }));
  }).catch(error => {
    const discrepancy = error?.code === 'SEED_CATALOG_DISCREPANCY' &&
      Number.isSafeInteger(error.unexpectedCount) && error.unexpectedCount > 0;
    console.error(JSON.stringify(discrepancy
      ? { event: 'SEED_FAILED', reason: 'CATALOG_DISCREPANCY', unexpectedCount: error.unexpectedCount }
      : { event: 'SEED_FAILED', reason: 'VALIDATION_OR_DATABASE_ERROR' }));
    process.exitCode = 1;
  });
}

module.exports = { runSeed };
