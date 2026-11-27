const { REFERENCE } = require('../data/golden');
const { validateCatalogCsv } = require('./validate');
const { GOLDEN_DATABASE } = require('./target');

function validateGoldenDataset(data) {
  const check = (condition) => { if (!condition) throw new Error('Golden inválido'); };
  check(data && data.reference === REFERENCE);
  for (const [table, count] of Object.entries({ user: 17, technician: 9, technicianSpecialty: 13,
    technicianNeighborhood: 19, serviceRequest: 18, serviceOffer: 20 })) {
    check(Array.isArray(data[table]) && data[table].length === count);
  }
  const r = Date.parse(REFERENCE);
  const date = (value, deadline = false) => {
    check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
    const time = Date.parse(value);
    check(Number.isFinite(time) && new Date(time).toISOString() === value && (deadline || time <= r));
    return time;
  };
  const unique = (rows, key) => check(new Set(rows.map(key)).size === rows.length);
  const identified = [...data.user, ...data.technician, ...data.serviceRequest, ...data.serviceOffer];
  check(identified.every(row => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)));
  unique(identified, row => row.id);
  unique(data.user, row => row.email.toLowerCase());
  unique(data.technician, row => row.userId);
  unique(data.technicianSpecialty, row => `${row.technicianId}/${row.category}`);
  unique(data.technicianNeighborhood, row => `${row.technicianId}/${row.neighborhoodName}`);
  const users = new Map(data.user.map(row => [row.id, row]));
  const techs = new Map(data.technician.map(row => [row.id, row]));
  const requests = new Map(data.serviceRequest.map(row => [row.id, row]));
  const categories = ['PLUMBING', 'ELECTRICITY', 'GAS', 'LOCKSMITH', 'MASONRY'];
  const neighborhoods = ['Palermo', 'Caballito', 'Almagro'];
  for (const user of data.user) {
    check(['CLIENT', 'TECHNICIAN', 'ADMIN'].includes(user.role));
    check(['ACTIVE', 'SUSPENDED'].includes(user.accountStatus));
    check(typeof user.name === 'string' && user.name.length > 0 &&
      /^urbanfix\.golden\.[act]\d@example\.com$/.test(user.email));
    check(typeof user.passwordHash === 'string' && /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/.test(user.passwordHash));
    check(user.role === 'ADMIN' ? user.phone === null : /^\+[1-9][0-9]{1,14}$/.test(user.phone || ''));
    check(user.isTestUser === ['Golden C7', 'Golden T9'].includes(user.name));
    check(user.lastLoginAt === null);
    date(user.createdAt);
  }
  for (const tech of data.technician) {
    check(users.get(tech.userId)?.role === 'TECHNICIAN');
    check(['APPROVED', 'PENDING', 'REJECTED'].includes(tech.approvalStatus));
    check(data.technicianSpecialty.some(row => row.technicianId === tech.id));
    check(data.technicianNeighborhood.some(row => row.technicianId === tech.id));
  }
  for (const specialty of data.technicianSpecialty) {
    check(techs.has(specialty.technicianId) && categories.includes(specialty.category));
    if (['GAS', 'ELECTRICITY'].includes(specialty.category)) {
      check(typeof specialty.licenseNumber === 'string' && specialty.licenseNumber.trim().length > 0);
    }
  }
  for (const coverage of data.technicianNeighborhood) {
    check(techs.has(coverage.technicianId) && neighborhoods.includes(coverage.neighborhoodName));
  }
  for (const request of data.serviceRequest) {
    check(users.get(request.clientId)?.role === 'CLIENT');
    check(categories.includes(request.category) && neighborhoods.includes(request.neighborhoodName));
    check(typeof request.description === 'string' && request.description.length >= 20 && request.description.length <= 500);
    check(typeof request.street === 'string' && request.street.trim() && typeof request.streetNumber === 'string' && request.streetNumber.trim());
    check(['MORNING', 'AFTERNOON', 'ANY'].includes(request.preferredTime));
    const created = date(request.createdAt);
    check(date(users.get(request.clientId).createdAt) < created);
    const accepted = request.acceptedAt === null ? null : date(request.acceptedAt);
    const completed = request.completedAt === null ? null : date(request.completedAt);
    const cancelled = request.cancelledAt === null ? null : date(request.cancelledAt);
    check(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(request.status));
    check((accepted === null) === (request.technicianId === null));
    check(request.status === 'PENDING' ? accepted === null : request.status === 'CANCELLED' || accepted !== null);
    check((request.status === 'COMPLETED') === (completed !== null));
    check((request.status === 'CANCELLED') === (cancelled !== null));
    check((cancelled === null) === (request.cancelledById === null));
    if (accepted !== null) check(techs.has(request.technicianId) && accepted >= created);
    if (completed !== null) check(accepted !== null && completed >= accepted);
    if (cancelled !== null) {
      check(cancelled > (accepted ?? created));
      check(users.get(request.cancelledById)?.role === 'ADMIN' ||
        (accepted === null && request.cancelledById === request.clientId));
    }
    check(date(request.updatedAt) >= Math.max(created, accepted ?? created, completed ?? created, cancelled ?? created));
  }
  const activeAt = (tech, time) => data.serviceRequest.some(request => request.technicianId === tech &&
    request.acceptedAt && Date.parse(request.acceptedAt) <= time &&
    time < Date.parse(request.completedAt || request.cancelledAt || '9999-12-31T00:00:00.000Z'));
  for (const tech of data.technician) {
    const jobs = data.serviceRequest.filter(row => row.technicianId === tech.id && row.acceptedAt)
      .sort((a, b) => Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt));
    for (let i = 1; i < jobs.length; i++) {
      const previous = jobs[i - 1];
      check(previous.completedAt || previous.cancelledAt);
      check(Date.parse(previous.completedAt || previous.cancelledAt) <= Date.parse(jobs[i].acceptedAt));
    }
  }
  for (const offer of data.serviceOffer) {
    const request = requests.get(offer.requestId);
    const tech = techs.get(offer.technicianId);
    check(request && tech && tech.approvalStatus === 'APPROVED' && users.get(tech.userId).accountStatus === 'ACTIVE');
    check(data.technicianSpecialty.some(row => row.technicianId === tech.id && row.category === request.category));
    check(data.technicianNeighborhood.some(row => row.technicianId === tech.id && row.neighborhoodName === request.neighborhoodName));
    const created = date(offer.createdAt);
    const expires = date(offer.expiresAt, true);
    check(created >= date(request.createdAt) && created > date(users.get(tech.userId).createdAt));
    check(expires - created === 86400000 && !activeAt(tech.id, created));
    check(['ACCEPTED', 'PENDING', 'EXPIRED', 'REJECTED', 'CANCELLED', 'RELEASED'].includes(offer.status));
    if (offer.status === 'ACCEPTED') {
      check(request.technicianId === tech.id && request.acceptedAt !== null);
      check(Date.parse(request.acceptedAt) >= created && Date.parse(request.acceptedAt) < expires);
    }
    if (offer.status === 'EXPIRED') check(expires <= r);
    if (offer.status === 'CANCELLED') check(request.cancelledAt && Date.parse(request.cancelledAt) >= created);
    if (offer.status === 'RELEASED') {
      check(data.serviceRequest.some(row => row.id !== request.id && row.technicianId === tech.id &&
        row.acceptedAt && created <= Date.parse(row.acceptedAt) && Date.parse(row.acceptedAt) < expires));
    }
    if (offer.status === 'PENDING') {
      check(request.status === 'PENDING');
      check(!data.serviceRequest.some(row => row.technicianId === tech.id && row.acceptedAt &&
        created <= Date.parse(row.acceptedAt) && Date.parse(row.acceptedAt) < expires));
    }
  }
  for (const request of data.serviceRequest) {
    const offers = data.serviceOffer.filter(row => row.requestId === request.id)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    check(offers.length > 0 && offers[0].createdAt === request.createdAt);
    check(offers.filter(row => row.status === 'PENDING').length <= 1);
    check(offers.filter(row => row.status === 'ACCEPTED').length === (request.acceptedAt ? 1 : 0));
    for (let i = 1; i < offers.length; i++) {
      const previous = offers[i - 1];
      check(['REJECTED', 'EXPIRED', 'RELEASED'].includes(previous.status));
      if (previous.status === 'EXPIRED') check(Date.parse(offers[i].createdAt) >= Date.parse(previous.expiresAt));
      if (['REJECTED', 'EXPIRED'].includes(previous.status)) {
        check(!offers.slice(i).some(row => row.technicianId === previous.technicianId));
      }
      if (previous.status === 'RELEASED') {
        check(data.serviceRequest.some(row => row.technicianId === previous.technicianId && row.acceptedAt &&
          Date.parse(previous.createdAt) <= Date.parse(row.acceptedAt) &&
          Date.parse(row.acceptedAt) <= Date.parse(offers[i].createdAt) &&
          Date.parse(row.acceptedAt) < Date.parse(previous.expiresAt)));
      }
    }
  }
  return data;
}

async function seedGolden(prisma, dataset, csv) {
  validateGoldenDataset(dataset);
  const catalog = validateCatalogCsv(csv);
  const tables = ['user', 'technician', 'technicianSpecialty', 'technicianNeighborhood', 'serviceRequest', 'serviceOffer'];
  const discrepancy = () => { throw new Error('Golden presenta discrepancias; no se realizaron cambios'); };
  const key = (row) => row.id || `${row.technicianId}/${row.category || row.neighborhoodId}`;
  const value = (field) => field instanceof Date ? field.toISOString() : field;
  return prisma.$transaction(async (tx) => {
    const [identity] = await tx.$queryRaw`SELECT current_database() AS database, current_schema() AS schema`;
    if (identity?.database !== GOLDEN_DATABASE || identity?.schema !== 'public') {
      throw new Error('Identidad de la base Golden no autorizada');
    }
    const neighborhoods = await tx.neighborhood.findMany({ select: { id: true, name: true, comuna: true } });
    const official = new Map(catalog.map(row => [row.name, row.comuna]));
    if (neighborhoods.length !== 48 || new Set(neighborhoods.map(row => row.name)).size !== 48 ||
      neighborhoods.some(row => official.get(row.name) !== row.comuna)) discrepancy();
    const neighborhoodIds = new Map(neighborhoods.map(row => [row.name, row.id]));
    const expected = {};
    const existing = {};
    for (const table of tables) {
      expected[table] = dataset[table].map(row => {
        const { neighborhoodName, ...fields } = row;
        if (neighborhoodName) fields.neighborhoodId = neighborhoodIds.get(neighborhoodName);
        for (const field of Object.keys(fields)) {
          if (field.endsWith('At') && fields[field] !== null) fields[field] = new Date(fields[field]);
        }
        return fields;
      });
      existing[table] = await tx[table].findMany({
        select: Object.fromEntries(Object.keys(expected[table][0]).map(field => [field, true])),
      });
    }
    const emails = new Map(expected.user.map(row => [row.email, row.id]));
    if (existing.user.some(row => emails.has(row.email.toLowerCase()) && emails.get(row.email.toLowerCase()) !== row.id)) discrepancy();
    const technicianUsers = new Map(expected.technician.map(row => [row.userId, row.id]));
    if (existing.technician.some(row => technicianUsers.has(row.userId) && technicianUsers.get(row.userId) !== row.id)) discrepancy();
    const missing = {};
    let total = 0;
    let inserted = 0;
    for (const table of tables) {
      const byKey = new Map(existing[table].map(row => [key(row), row]));
      missing[table] = [];
      for (const row of expected[table]) {
        const current = byKey.get(key(row));
        if (current && Object.keys(row).some(field => value(current[field]) !== value(row[field]))) discrepancy();
        if (!current) missing[table].push(row);
      }
      total += expected[table].length;
      inserted += missing[table].length;
    }
    for (const table of tables) {
      if (missing[table].length) await tx[table].createMany({ data: missing[table] });
    }
    return { existing: total - inserted, inserted, total };
  }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
}

module.exports = { validateGoldenDataset, seedGolden };
