const HOUR = 3600000;
const DAY = 24 * HOUR;
const CATEGORIES = ['PLUMBING', 'ELECTRICITY', 'LOCKSMITH', 'GAS', 'MASONRY'];
const NEIGHBORHOODS = ['Palermo', 'Caballito', 'Almagro', 'Balvanera', 'Barracas', 'Belgrano', 'Constitución', 'Flores', 'Villa Lugano'];
const uuid = (group, number) => `c400000${group}-0000-4000-8000-${String(number).padStart(12, '0')}`;

function volumeReference(reference) {
  const time = typeof reference === 'string' ? Date.parse(reference) : NaN;
  const date = new Date(time);
  if (!Number.isFinite(time) || date.toISOString() !== reference || date.getUTCDay() !== 1 ||
    date.getUTCHours() !== 3 || date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) {
    throw new Error('Referencia Volumen requerida: lunes 00:00 Buenos Aires, ISO UTC con milisegundos');
  }
  return time;
}

function shuffle(rows) {
  const result = [...rows];
  let state = 42026;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createVolumeDataset(reference) {
  const d = volumeReference(reference);
  const iso = time => new Date(time).toISOString();
  const passwordHash = require('bcryptjs').hashSync('UrbanFixVolume2026!', '$2b$10$abcdefghijklmnopqrstuu');
  const user = [];
  for (const [role, prefix, count, start] of [['ADMIN', 'a', 2, 0], ['TECHNICIAN', 't', 15, 2], ['CLIENT', 'c', 45, 17]]) {
    for (let n = 1; n <= count; n++) user.push({
      id: uuid(1, start + n), name: `Volume ${prefix.toUpperCase()}${n}`,
      email: `urbanfix.volume.${prefix}${n}@example.com`, role,
      phone: role === 'ADMIN' ? null : `+549116401${String(start + n).padStart(4, '0')}`,
      passwordHash, accountStatus: prefix === 't' && n === 15 ? 'SUSPENDED' : 'ACTIVE',
      isTestUser: (prefix === 'c' && n >= 44) || (prefix === 't' && n === 11), lastLoginAt: null,
      createdAt: iso(prefix === 'c' && n >= 37 && n <= 43 ? d - (n - 36) * DAY : d - 42 * DAY + (start + n) * HOUR),
    });
  }
  const specialties = [
    ['PLUMBING', 'LOCKSMITH', 'MASONRY'], ['PLUMBING', 'MASONRY', 'ELECTRICITY'],
    ['ELECTRICITY', 'GAS', 'LOCKSMITH'], ['ELECTRICITY', 'GAS', 'PLUMBING'],
    ['LOCKSMITH', 'MASONRY', 'GAS'], ['GAS', 'PLUMBING', 'MASONRY'],
    ['GAS', 'ELECTRICITY', 'LOCKSMITH'], ['MASONRY', 'LOCKSMITH', 'PLUMBING'], CATEGORIES, CATEGORIES, CATEGORIES,
    ['PLUMBING'], ['PLUMBING'], ['GAS'], ['LOCKSMITH'],
  ];
  const technician = Array.from({ length: 15 }, (_, i) => ({ id: uuid(2, i + 1), userId: uuid(1, i + 3),
    approvalStatus: i === 11 || i === 12 ? 'PENDING' : i === 13 ? 'REJECTED' : 'APPROVED' }));
  const technicianSpecialty = specialties.flatMap((list, i) => list.map(category => ({
    technicianId: uuid(2, i + 1), category,
    licenseNumber: ['GAS', 'ELECTRICITY'].includes(category) ? `VOLUME-T${i + 1}-${category}` : null,
  })));
  const technicianNeighborhood = technician.flatMap(tech => NEIGHBORHOODS.map(neighborhoodName => ({
    technicianId: tech.id, neighborhoodName,
  })));
  const dates = [];
  for (const [week, count] of [25, 35, 45, 55, 40].entries()) {
    const days = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6];
    for (let day = 0; day < 7; day++) {
      const slots = Array.from({ length: count }, (_, j) => days[j % days.length]).filter(value => value === day).length;
      for (let slot = 0; slot < slots; slot++) dates.push(d - (35 - week * 7 - day) * DAY +
        8 * HOUR + Math.floor((slot + 1) * 13 * HOUR / (slots + 1)));
    }
  }
  dates.sort((a, b) => a - b);
  const expand = (values, counts) => shuffle(values.flatMap((value, i) => Array(counts[i]).fill(value)));
  const categories = expand(CATEGORIES, [70, 50, 30, 30, 20]);
  const neighborhoods = expand(NEIGHBORHOODS, [40, 35, 25, 20, 20, 20, 15, 15, 10]);
  const preferred = expand(['ANY', 'MORNING', 'AFTERNOON'], [100, 60, 40]);
  const testIndices = new Set(Array.from({ length: 10 }, (_, i) => i * 20 + 19));
  const donors = new Set(Array.from({ length: 8 }, (_, i) => i * 20));
  const pairs = new Set([...donors].flatMap(i => [i, i + 1]));
  const candidates = shuffle(dates.map((_, i) => i).filter(i => !testIndices.has(i) && !pairs.has(i)));
  const reoffers = new Map(candidates.filter(i => dates[i] < d - 2 * DAY).slice(0, 32)
    .map((index, i) => [index, i < 16 ? 'REJECTED' : 'EXPIRED']));
  const remaining = candidates.filter(i => !reoffers.has(i));
  const pending = new Set([
    ...remaining.filter(i => dates[i] > d - DAY).slice(0, 4),
    ...remaining.filter(i => dates[i] < d - 2 * DAY).slice(0, 26),
  ]);
  const cancellations = new Set(remaining.filter(i => !pending.has(i) && dates[i] < d - 2 * DAY).slice(0, 25));
  const postCancellations = new Set(remaining.filter(i => !pending.has(i) && !cancellations.has(i) && dates[i] < d - 3 * DAY).slice(0, 6));
  const storedExpired = new Set([...pending].filter(i => dates[i] < d - DAY).slice(0, 4));
  const activeIndices = new Map(dates.map((_, i) => i).filter(i => !testIndices.has(i) &&
    !pending.has(i) && !cancellations.has(i) && !postCancellations.has(i) && !pairs.has(i))
    .slice(-2).map((index, i) => [index, i === 0 ? 'ACCEPTED' : 'IN_PROGRESS']));
  const serviceRequest = [];
  const serviceOffer = [];
  const cancellationOrigins = [];
  const free = new Map(technician.map(row => [row.id, -Infinity]));
  let realClient = 0, preCancel = 0, postCancel = 0;
  const pool = (index, exclude, testOnly) => technician.filter((tech, i) => tech.approvalStatus === 'APPROVED' && i !== 14 &&
      (testOnly ? i === 10 : i < 9 || (i === 9 && index > Math.max(...pairs))) && !exclude.includes(tech.id) &&
      specialties[i].includes(categories[index]));
  const availableAt = (index, at, exclude = [], testOnly = false) => Math.max(at,
    Math.min(...pool(index, exclude, testOnly).map(tech => free.get(tech.id))));
  const choose = (index, at, exclude = [], testOnly = false) => {
    const eligible = pool(index, exclude, testOnly).filter(tech => free.get(tech.id) <= at);
    if (!eligible.length) throw new Error(`Agenda Volumen sin técnico disponible en posición ${index}`);
    return eligible[index % eligible.length];
  };
  const request = index => {
    const testOnly = testIndices.has(index);
    const client = testOnly ? 44 + (Math.floor(index / 20) % 2) : 1 + (realClient++ % 36);
    const row = { id: uuid(3, index + 1), clientId: uuid(1, 17 + client), technicianId: null,
      neighborhoodName: neighborhoods[index], category: categories[index],
      street: 'Calle Ficticia Volumen', streetNumber: String(index + 100),
      floor: null, apartment: null, directions: null, preferredTime: preferred[index],
      description: `Solicitud ficticia Volumen V${index + 1} para control de datos.`, status: 'PENDING',
      createdAt: iso(dates[index]), updatedAt: iso(dates[index]), acceptedAt: null,
      completedAt: null, cancelledAt: null, cancelledById: null };
    serviceRequest.push(row);
    return row;
  };
  const offer = (row, tech, created, status) => {
    serviceOffer.push({ id: uuid(4, serviceOffer.length + 1), requestId: row.id, technicianId: tech.id,
      createdAt: iso(created), expiresAt: iso(created + DAY), status });
  };
  const accept = (row, tech, time, index) => {
    row.technicianId = tech.id;
    row.acceptedAt = iso(time);
    row.updatedAt = iso(time);
    const terminal = time + (2 + index % 7) * HOUR;
    if (postCancellations.has(index)) {
      row.status = 'CANCELLED'; row.cancelledAt = iso(terminal); row.cancelledById = uuid(1, 1);
      cancellationOrigins.push({ requestId: row.id, from: postCancel++ < 2 ? 'IN_PROGRESS' : 'ACCEPTED' });
    } else if (terminal <= d && index < 197 && !activeIndices.has(index)) {
      row.status = 'COMPLETED'; row.completedAt = iso(terminal);
    } else row.status = activeIndices.get(index) || (index % 2 ? 'IN_PROGRESS' : 'ACCEPTED');
    row.updatedAt = row.cancelledAt || row.completedAt || row.acceptedAt;
    free.set(tech.id, row.completedAt || row.cancelledAt ? terminal : Infinity);
  };
  for (let i = 0; i < dates.length; i++) {
    if (!donors.has(i)) {
      const week = Math.floor((dates[i] - d + 35 * DAY) / (7 * DAY));
      dates[i] = availableAt(i, dates[i], [], testIndices.has(i));
      const timeOfDay = ((dates[i] - d) % DAY + DAY) % DAY;
      if (timeOfDay < 8 * HOUR) dates[i] += 8 * HOUR - timeOfDay;
      else if (timeOfDay >= 22 * HOUR) dates[i] += DAY - timeOfDay + 8 * HOUR;
      if (Math.floor((dates[i] - d + 35 * DAY) / (7 * DAY)) !== week || dates[i] > d - HOUR) {
        throw new Error('Agenda Volumen fuera de la semana prevista');
      }
    }
    const row = request(i);
    const created = dates[i];
    if (donors.has(i)) {
      const winner = request(i + 1);
      const owner = technician[9];
      if (free.get(owner.id) > created) throw new Error('Agenda Volumen de liberación incompatible');
      const released = dates[i + 1] + HOUR / 2;
      offer(row, owner, created, 'RELEASED');
      offer(winner, owner, dates[i + 1], 'ACCEPTED');
      accept(winner, owner, released, i + 1);
      const next = availableAt(i, released + HOUR / 4, [owner.id]);
      const tech = choose(i, next, [owner.id]);
      offer(row, tech, next, 'ACCEPTED');
      accept(row, tech, next + HOUR, i);
      i++;
      continue;
    }
    const tech = choose(i, created, [], testIndices.has(i));
    if (cancellations.has(i)) {
      offer(row, tech, created, 'CANCELLED');
      row.status = 'CANCELLED'; row.cancelledAt = iso(created + HOUR);
      row.cancelledById = preCancel++ < 5 ? uuid(1, 1) : row.clientId;
      row.updatedAt = row.cancelledAt;
      cancellationOrigins.push({ requestId: row.id, from: 'PENDING' });
      free.set(tech.id, created + HOUR);
    } else if (pending.has(i)) {
      const status = storedExpired.has(i) || created > d - DAY ? 'PENDING' : i % 2 ? 'REJECTED' : 'EXPIRED';
      offer(row, tech, created, status);
      free.set(tech.id, created + (status === 'REJECTED' ? 60000 : DAY));
    } else if (reoffers.has(i)) {
      const status = reoffers.get(i);
      offer(row, tech, created, status);
      const end = created + (status === 'EXPIRED' ? 24 : 2) * HOUR;
      free.set(tech.id, end);
      const next = availableAt(i, end, [tech.id]);
      const recipient = choose(i, next, [tech.id]);
      offer(row, recipient, next, 'ACCEPTED');
      accept(row, recipient, next + (status === 'EXPIRED' ? 2 : 0.5) * HOUR, i);
    } else {
      const delay = testIndices.has(i) ? 0.5 : [0.5, 1, 1.5, 2, 2, 2.5, 3, 5, 12, 23 + 59 / 60][i % 10];
      offer(row, tech, created, 'ACCEPTED');
      accept(row, tech, created + Math.min(delay * HOUR, d - created - 60000), i);
    }
  }
  serviceRequest.sort((a, b) => a.id.localeCompare(b.id));
  const testUsers = new Set(user.filter(row => row.isTestUser).map(row => row.id));
  const requestsById = new Map(serviceRequest.map(row => [row.id, row]));
  const offersByRequest = new Map(serviceRequest.map(row => [row.id, []]));
  for (const offer of serviceOffer) offersByRequest.get(offer.requestId).push(offer);
  const matureClean = row => !testUsers.has(row.clientId) && Date.parse(row.createdAt) < d - DAY;
  const fastAcceptances = serviceRequest.filter(row => matureClean(row) && row.status === 'COMPLETED' &&
    offersByRequest.get(row.id).length === 1 &&
    Date.parse(row.acceptedAt) - Date.parse(row.createdAt) > 2 * HOUR &&
    Date.parse(row.acceptedAt) - Date.parse(row.createdAt) <= DAY).slice(0, 9);
  const rejectedOffers = serviceOffer.filter(offer => {
    const row = requestsById.get(offer.requestId);
    return offer.status === 'EXPIRED' && row.status === 'PENDING' && matureClean(row) &&
      offersByRequest.get(row.id).length === 1;
  }).slice(0, 10);
  if (fastAcceptances.length !== 9 || rejectedOffers.length !== 10) {
    throw new Error('Calibración Volumen incompatible con los escenarios previstos');
  }
  for (const row of fastAcceptances) row.acceptedAt = iso(Date.parse(row.createdAt) + 2 * HOUR);
  for (const offer of rejectedOffers) offer.status = 'REJECTED';
  return { reference, cancellationOrigins, user, technician, technicianSpecialty, technicianNeighborhood, serviceRequest, serviceOffer };
}

module.exports = { createVolumeDataset, volumeReference };
