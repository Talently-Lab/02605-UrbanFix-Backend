const { validateCatalogCsv } = require('./validate');
const { assertSeedIdentity } = require('./target');

async function seedCatalog(prisma, csv, target) {
  const catalog = validateCatalogCsv(csv);
  const officialCommunes = new Map(
    catalog.map((row) => [row.name, row.comuna]),
  );
  return prisma.$transaction(
    async (tx) => {
      const [identity] =
        await tx.$queryRaw`SELECT current_database() AS database, current_schema() AS schema, current_user AS user`;
      assertSeedIdentity(identity, 'catalog', target);
      const existing = await tx.neighborhood.findMany({
        select: { id: true, name: true, comuna: true },
      });
      const unexpectedCount = existing.filter(
        (row) =>
          !officialCommunes.has(row.name) ||
          officialCommunes.get(row.name) !== row.comuna,
      ).length;
      if (unexpectedCount) {
        throw Object.assign(
          new Error(
            'El catálogo existente presenta discrepancias; no se realizaron cambios',
          ),
          {
            code: 'SEED_CATALOG_DISCREPANCY',
            unexpectedCount,
          },
        );
      }
      const existingNames = new Set(existing.map((row) => row.name));
      const missing = catalog.filter((row) => !existingNames.has(row.name));
      if (missing.length) {
        await tx.neighborhood.createMany({ data: missing });
      }
      return {
        existing: existing.length,
        inserted: missing.length,
        total: catalog.length,
      };
    },
    { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 },
  );
}

module.exports = { seedCatalog };
