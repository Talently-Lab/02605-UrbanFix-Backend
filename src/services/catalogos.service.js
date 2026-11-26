function listSpecialties() {
  return [
    { category: 'ELECTRICITY', name: 'Electricidad', licenseRequired: true },
    { category: 'PLUMBING', name: 'Plomería', licenseRequired: false },
    { category: 'GAS', name: 'Gas', licenseRequired: true },
    { category: 'LOCKSMITH', name: 'Cerrajería', licenseRequired: false },
    { category: 'MASONRY', name: 'Albañilería', licenseRequired: false },
  ];
}

async function listNeighborhoods({ prisma }) {
  const neighborhoods = await prisma.neighborhood.findMany({
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  });
  return neighborhoods.map(({ id, name }) => ({ id, name }));
}

module.exports = { listSpecialties, listNeighborhoods };
