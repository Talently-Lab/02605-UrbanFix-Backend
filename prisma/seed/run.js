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
  readGolden = () => require('../data/golden').createGoldenDataset(),
  readVolume = reference => require('../data/volume').createVolumeDataset(reference),
  createClient = createSeedClient,
} = {}) {
  const { mode, connectionString, target } = validateSeedOptions({ args, env });
  const csv = readCatalog();
  validateCatalogCsv(csv);
  let golden;
  if (mode === 'golden') {
    golden = readGolden();
    require('./golden').validateGoldenDataset(golden);
  }
  let volume;
  if (mode === 'volume') {
    require('../data/volume').volumeReference(env.URBANFIX_SEED_REFERENCE_TIME);
    volume = readVolume(env.URBANFIX_SEED_REFERENCE_TIME);
    if (volume?.reference !== env.URBANFIX_SEED_REFERENCE_TIME) throw new Error('Referencia Volumen inconsistente');
    require('./volume').validateVolumeDataset(volume, csv);
  }
  const prisma = createClient(connectionString);
  try {
    if (mode === 'volume') return await require('./volume').seedVolume(prisma, volume, csv, target);
    return mode === 'golden' ? await require('./golden').seedGolden(prisma, golden, csv, target) : await seedCatalog(prisma, csv, target);
  } finally {
    await prisma.$disconnect();
  }
}

function runSeedCli() {
  return runSeed().then(result => {
    console.log(JSON.stringify({ mode: process.argv[2].slice('--mode='.length), ...result }));
  }).catch(error => {
    const discrepancy = error?.code === 'SEED_CATALOG_DISCREPANCY' &&
      Number.isSafeInteger(error.unexpectedCount) && error.unexpectedCount > 0;
    console.error(JSON.stringify(discrepancy
      ? { event: 'SEED_FAILED', reason: 'CATALOG_DISCREPANCY', unexpectedCount: error.unexpectedCount }
      : { event: 'SEED_FAILED', reason: 'VALIDATION_OR_DATABASE_ERROR' }));
    process.exitCode = 1;
  });
}

if (require.main === module) runSeedCli();

module.exports = { runSeed, runSeedCli };
