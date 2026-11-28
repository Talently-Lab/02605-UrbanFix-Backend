const { isArgentinePhone } = require('../../src/validators/phone.validator');
const { volumeReference } = require('../data/volume');
const { validateCatalogCsv } = require('./validate');
const { assertSeedIdentity } = require('./target');
const TABLES = ['user', 'technician', 'technicianSpecialty', 'technicianNeighborhood', 'serviceRequest', 'serviceOffer'];

function validateVolumeDataset(data, csv) {
  const check = condition => { if (!condition) throw new Error('Volumen inválido'); };
  let d;
  try { d = volumeReference(data?.reference); } catch { check(false); }
  const hour = 3600000, day = 24 * hour;
  for (const [table, count] of Object.entries({ user: 62, technician: 15, technicianSpecialty: 43,
    technicianNeighborhood: 135, serviceRequest: 200, serviceOffer: 240, cancellationOrigins: 31 })) {
    check(Array.isArray(data[table]) && data[table].length === count);
  }
  const instant = (value, deadline = false) => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    check(Number.isFinite(time) && new Date(time).toISOString() === value && (deadline || time <= d));
    return time;
  };
  const unique = (rows, key) => check(new Set(rows.map(key)).size === rows.length);
  const identified = [...data.user, ...data.technician, ...data.serviceRequest, ...data.serviceOffer];
  check(identified.every(row => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)));
  unique(identified, row => row.id);
  unique(data.user, row => row.email);
  unique(data.technician, row => row.userId);
  unique(data.technicianSpecialty, row => `${row.technicianId}/${row.category}`);
  unique(data.technicianNeighborhood, row => `${row.technicianId}/${row.neighborhoodName}`);
  const users = new Map(data.user.map(row => [row.id, row]));
  const techs = new Map(data.technician.map(row => [row.id, row]));
  const requests = new Map(data.serviceRequest.map(row => [row.id, row]));
  const catalog = new Map(validateCatalogCsv(csv).map(row => [row.name, row.comuna]));
  const categories = ['PLUMBING', 'ELECTRICITY', 'LOCKSMITH', 'GAS', 'MASONRY'];
  const covered = new Set(data.technicianNeighborhood.map(row => `${row.technicianId}/${row.neighborhoodName}`));
  const qualified = new Set(data.technicianSpecialty.map(row => `${row.technicianId}/${row.category}`));
  for (const [role, count] of [['CLIENT', 45], ['TECHNICIAN', 15], ['ADMIN', 2]]) check(data.user.filter(row => row.role === role).length === count);
  for (const user of data.user) {
    check(typeof user.name === 'string' && user.name.trim().length > 0);
    check(/^urbanfix\.volume\.[act][1-9][0-9]*@example\.com$/.test(user.email));
    check(user.isTestUser === ['urbanfix.volume.c44@example.com', 'urbanfix.volume.c45@example.com', 'urbanfix.volume.t11@example.com'].includes(user.email));
    check(user.role === 'ADMIN' ? user.phone === null : isArgentinePhone(user.phone));
    check(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/.test(user.passwordHash));
    check(['ACTIVE', 'SUSPENDED'].includes(user.accountStatus) && user.lastLoginAt === null);
    const created = instant(user.createdAt);
    check(created >= d - 42 * day && created <= d - day);
  }
  check(data.user.filter(row => row.isTestUser).length === 3);
  check(data.user.filter(row => row.accountStatus === 'SUSPENDED').length === 1);
  for (const tech of data.technician) {
    check(users.get(tech.userId)?.role === 'TECHNICIAN');
    check(['APPROVED', 'PENDING', 'REJECTED'].includes(tech.approvalStatus));
    check(data.technicianSpecialty.some(row => row.technicianId === tech.id));
    check(data.technicianNeighborhood.some(row => row.technicianId === tech.id));
  }
  check(data.technician.filter(row => row.approvalStatus === 'APPROVED').length === 12);
  check(data.technician.filter(row => row.approvalStatus === 'PENDING').length === 2);
  check(data.technician.filter(row => row.approvalStatus === 'REJECTED').length === 1);
  for (const row of data.technicianSpecialty) {
    check(techs.has(row.technicianId) && categories.includes(row.category));
    if (['GAS', 'ELECTRICITY'].includes(row.category)) check(typeof row.licenseNumber === 'string' && row.licenseNumber.trim().length > 0);
  }
  for (const row of data.technicianNeighborhood) check(techs.has(row.technicianId) && catalog.has(row.neighborhoodName));
  const used = new Set(data.serviceRequest.map(row => row.neighborhoodName));
  check(used.size === 9 && new Set([...used].map(name => catalog.get(name))).size >= 5);
  for (let week = 0; week < 5; week++) check(data.serviceRequest.filter(row =>
    Date.parse(row.createdAt) >= d - (35 - week * 7) * day &&
    Date.parse(row.createdAt) < d - (28 - week * 7) * day).length === [25, 35, 45, 55, 40][week]);
  for (const row of data.serviceRequest) {
    const client = users.get(row.clientId);
    check(client?.role === 'CLIENT' && categories.includes(row.category) && catalog.has(row.neighborhoodName));
    check(typeof row.description === 'string' && row.description.length >= 20 && row.description.length <= 500);
    check(typeof row.street === 'string' && row.street.trim() && typeof row.streetNumber === 'string' && row.streetNumber.trim());
    check(['ANY', 'MORNING', 'AFTERNOON'].includes(row.preferredTime));
    const created = instant(row.createdAt);
    check(created >= d - 35 * day && created <= d - hour && instant(client.createdAt) < created);
    const localHour = new Date(created - 3 * hour).getUTCHours();
    check(localHour >= 8 && localHour < 22);
    const accepted = row.acceptedAt === null ? null : instant(row.acceptedAt);
    const completed = row.completedAt === null ? null : instant(row.completedAt);
    const cancelled = row.cancelledAt === null ? null : instant(row.cancelledAt);
    check(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(row.status));
    check((accepted === null) === (row.technicianId === null));
    check(row.status === 'PENDING' ? accepted === null : row.status === 'CANCELLED' || accepted !== null);
    check((row.status === 'COMPLETED') === (completed !== null));
    check((row.status === 'CANCELLED') === (cancelled !== null));
    check((cancelled === null) === (row.cancelledById === null));
    if (accepted !== null) check(techs.has(row.technicianId) && accepted >= created);
    if (completed !== null) check(accepted !== null && completed - accepted >= 2 * hour && completed - accepted <= 48 * hour);
    if (cancelled !== null) check(cancelled > (accepted ?? created) &&
      (users.get(row.cancelledById)?.role === 'ADMIN' || (accepted === null && row.cancelledById === row.clientId)));
    check(instant(row.updatedAt) >= Math.max(created, accepted ?? created, completed ?? created, cancelled ?? created));
  }
  const jobs = new Map();
  for (const tech of data.technician) {
    const rows = data.serviceRequest.filter(row => row.technicianId === tech.id && row.acceptedAt)
      .sort((a, b) => Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt));
    jobs.set(tech.id, rows);
    for (let i = 1; i < rows.length; i++) check((rows[i - 1].completedAt || rows[i - 1].cancelledAt) &&
      Date.parse(rows[i - 1].completedAt || rows[i - 1].cancelledAt) <= Date.parse(rows[i].acceptedAt));
  }
  for (const offer of data.serviceOffer) {
    const request = requests.get(offer.requestId), tech = techs.get(offer.technicianId);
    check(request && tech && tech.approvalStatus === 'APPROVED' && users.get(tech.userId).accountStatus === 'ACTIVE');
    check(qualified.has(`${tech.id}/${request.category}`) && covered.has(`${tech.id}/${request.neighborhoodName}`));
    check(users.get(tech.userId).isTestUser === users.get(request.clientId).isTestUser);
    const created = instant(offer.createdAt), expires = instant(offer.expiresAt, true);
    check(created >= instant(request.createdAt) && created <= d - hour && created > instant(users.get(tech.userId).createdAt));
    check(expires - created === day && ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'RELEASED', 'CANCELLED'].includes(offer.status));
    check(!jobs.get(tech.id).some(job => Date.parse(job.acceptedAt) <= created &&
      created < Date.parse(job.completedAt || job.cancelledAt || '9999-12-31T00:00:00.000Z')));
    if (offer.status === 'ACCEPTED') check(request.technicianId === tech.id && request.acceptedAt &&
      Date.parse(request.acceptedAt) >= created && Date.parse(request.acceptedAt) < expires);
    if (offer.status === 'EXPIRED') check(expires <= d);
    if (offer.status === 'CANCELLED') check(request.cancelledAt && Date.parse(request.cancelledAt) >= created);
    const intervening = jobs.get(tech.id).filter(job => job.id !== request.id &&
      created <= Date.parse(job.acceptedAt) && Date.parse(job.acceptedAt) < expires);
    if (offer.status === 'RELEASED') check(intervening.length > 0);
    if (['PENDING', 'EXPIRED'].includes(offer.status)) check(intervening.length === 0);
    if (offer.status === 'PENDING') check(request.status === 'PENDING');
  }
  for (const request of data.serviceRequest) {
    const offers = data.serviceOffer.filter(row => row.requestId === request.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    check(offers.length && offers[0].createdAt === request.createdAt);
    check(offers.filter(row => row.status === 'PENDING').length <= 1);
    check(offers.filter(row => row.status === 'ACCEPTED').length === (request.acceptedAt ? 1 : 0));
    unique(offers, row => row.technicianId);
    for (let i = 1; i < offers.length; i++) {
      const previous = offers[i - 1];
      check(['REJECTED', 'EXPIRED', 'RELEASED'].includes(previous.status));
      if (previous.status === 'EXPIRED') check(Date.parse(offers[i].createdAt) >= Date.parse(previous.expiresAt));
      if (previous.status === 'RELEASED') check(jobs.get(previous.technicianId).some(job =>
        Date.parse(job.acceptedAt) >= Date.parse(previous.createdAt) &&
        Date.parse(job.acceptedAt) <= Date.parse(offers[i].createdAt) && Date.parse(job.acceptedAt) < Date.parse(previous.expiresAt)));
    }
  }
  unique(data.cancellationOrigins, row => row.requestId);
  for (const origin of data.cancellationOrigins) {
    const request = requests.get(origin.requestId);
    check(request?.status === 'CANCELLED' && ['PENDING', 'ACCEPTED', 'IN_PROGRESS'].includes(origin.from));
    check((origin.from === 'PENDING') === (request.acceptedAt === null));
  }
  check(data.cancellationOrigins.filter(row => row.from === 'IN_PROGRESS').length === 2);
  check(data.serviceRequest.filter(row => !row.acceptedAt && row.cancelledAt && users.get(row.cancelledById)?.role === 'ADMIN').length >= 5);
  check(data.serviceRequest.filter(row => users.get(row.clientId).isTestUser).length === 10);
  return data;
}

async function seedVolume(prisma, dataset, csv, target) {
  validateVolumeDataset(dataset, csv);
  const official = new Map(validateCatalogCsv(csv).map(row => [row.name, row.comuna]));
  const discrepancy = () => { throw new Error('Volumen presenta discrepancias; no se realizaron cambios'); };
  const key = row => row.id || `${row.technicianId}/${row.category || row.neighborhoodId}`;
  const scalar = value => value instanceof Date ? value.toISOString() : value;
  return prisma.$transaction(async tx => {
    const [identity] = await tx.$queryRaw`SELECT current_database() AS database, current_schema() AS schema, current_user AS user`;
    assertSeedIdentity(identity, 'volume', target);
    const neighborhoods = await tx.neighborhood.findMany({ select: { id: true, name: true, comuna: true } });
    if (neighborhoods.length !== 48 || new Set(neighborhoods.map(row => row.name)).size !== 48 ||
      neighborhoods.some(row => official.get(row.name) !== row.comuna)) discrepancy();
    const ids = new Map(neighborhoods.map(row => [row.name, row.id]));
    const expected = {}, existing = {}, missing = {};
    for (const table of TABLES) {
      expected[table] = dataset[table].map(({ neighborhoodName, ...row }) => {
        if (neighborhoodName) row.neighborhoodId = ids.get(neighborhoodName);
        for (const field of Object.keys(row)) if (field.endsWith('At') && row[field] !== null) row[field] = new Date(row[field]);
        return row;
      });
      existing[table] = await tx[table].findMany({ select: Object.fromEntries(Object.keys(expected[table][0]).map(field => [field, true])) });
    }
    const emails = new Map(expected.user.map(row => [row.email, row.id]));
    if (existing.user.some(row => emails.has(row.email.toLowerCase()) && emails.get(row.email.toLowerCase()) !== row.id)) discrepancy();
    const owners = new Map(expected.technician.map(row => [row.userId, row.id]));
    if (existing.technician.some(row => owners.has(row.userId) && owners.get(row.userId) !== row.id)) discrepancy();
    let total = 0, inserted = 0;
    for (const table of TABLES) {
      const current = new Map(existing[table].map(row => [key(row), row]));
      missing[table] = [];
      for (const row of expected[table]) {
        const previous = current.get(key(row));
        if (previous && Object.keys(row).some(field => scalar(previous[field]) !== scalar(row[field]))) discrepancy();
        if (!previous) missing[table].push(row);
      }
      total += expected[table].length;
      inserted += missing[table].length;
    }
    for (const table of TABLES) if (missing[table].length) await tx[table].createMany({ data: missing[table] });
    return { existing: total - inserted, inserted, total };
  }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
}

module.exports = { validateVolumeDataset, seedVolume, TABLES };
