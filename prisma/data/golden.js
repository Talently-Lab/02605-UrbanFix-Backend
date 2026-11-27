const REFERENCE = '2026-12-07T15:00:00.000Z';
const uuid = (group, number) => `c300000${group}-0000-4000-8000-${String(number).padStart(12, '0')}`;
const instant = (value) => value ? `2026-${value}:00.000Z` : null;

function createGoldenDataset() {
  const passwordHash = require('bcryptjs').hashSync('UrbanFixGolden2026!', '$2b$10$abcdefghijklmnopqrstuu');
  const ids = { A1: uuid(1, 1) };
  for (let n = 1; n <= 9; n++) ids[`T${n}`] = uuid(1, n + 1);
  for (let n = 1; n <= 7; n++) ids[`C${n}`] = uuid(1, n + 10);
  const registrations = {
    A1: '11-15T12:00', T1: '11-15T13:00', T2: '11-16T13:00', T3: '11-17T13:00',
    T4: '11-18T13:00', T5: '11-19T13:00', T6: '12-05T13:00', T7: '11-25T13:00',
    T8: '11-22T13:00', T9: '11-26T13:00', C1: '11-20T14:00', C2: '11-21T14:00',
    C3: '11-22T14:00', C4: '11-23T14:00', C5: '11-24T14:00', C6: '11-28T14:00', C7: '11-26T14:00',
  };
  const user = Object.entries(registrations).map(([key, createdAt], index) => ({
    id: ids[key], name: `Golden ${key}`, email: `urbanfix.golden.${key.toLowerCase()}@example.com`,
    phone: key === 'A1' ? null : `+549110000${String(index).padStart(4, '0')}`,
    passwordHash, role: key[0] === 'A' ? 'ADMIN' : key[0] === 'C' ? 'CLIENT' : 'TECHNICIAN',
    accountStatus: key === 'T8' ? 'SUSPENDED' : 'ACTIVE', lastLoginAt: null,
    isTestUser: ['C7', 'T9'].includes(key), createdAt: instant(createdAt),
  }));
  const technician = Array.from({ length: 9 }, (_, index) => ({
    id: uuid(2, index + 1), userId: ids[`T${index + 1}`],
    approvalStatus: index === 5 ? 'PENDING' : index === 6 ? 'REJECTED' : 'APPROVED',
  }));
  const categories = [
    ['PLUMBING'], ['ELECTRICITY'], ['PLUMBING', 'LOCKSMITH', 'ELECTRICITY'],
    ['GAS', 'PLUMBING'], ['GAS', 'MASONRY'], ['PLUMBING'], ['GAS'], ['LOCKSMITH'], ['PLUMBING'],
  ];
  const technicianSpecialty = categories.flatMap((list, index) => list.map(category => ({
    technicianId: uuid(2, index + 1), category,
    licenseNumber: ['GAS', 'ELECTRICITY'].includes(category) ? `GOLDEN-T${index + 1}-${category}` : null,
  })));
  const technicianNeighborhood = technician.flatMap((row, index) =>
    (index < 5 ? ['Palermo', 'Caballito', 'Almagro'] : ['Palermo']).map(neighborhoodName => ({
      technicianId: row.id, neighborhoodName,
    })));
  const requests = [
    [1, 'PLUMBING', 'Palermo', '12-01T13:00', '12-01T13:30', '12-01T18:00', null, null, 1, 'COMPLETED'],
    [2, 'ELECTRICITY', 'Caballito', '12-01T14:00', '12-01T16:00', '12-02T12:00', null, null, 2, 'COMPLETED'],
    [3, 'PLUMBING', 'Almagro', '12-02T12:00', '12-02T14:01', '12-02T19:00', null, null, 1, 'COMPLETED'],
    [4, 'LOCKSMITH', 'Palermo', '12-02T13:00', '12-02T18:00', '12-03T15:00', null, null, 3, 'COMPLETED'],
    [5, 'ELECTRICITY', 'Caballito', '12-03T12:00', '12-04T11:59', '12-04T20:00', null, null, 2, 'COMPLETED'],
    [5, 'GAS', 'Almagro', '12-03T14:00', '12-04T16:00', null, null, null, 5, 'IN_PROGRESS'],
    [1, 'PLUMBING', 'Palermo', '12-04T12:00', null, null, null, null, null, 'PENDING'],
    [2, 'PLUMBING', 'Caballito', '12-04T15:00', null, null, '12-04T18:00', 'C2', null, 'CANCELLED'],
    [3, 'LOCKSMITH', 'Almagro', '12-05T13:00', '12-05T14:00', null, '12-05T20:00', 'A1', 3, 'CANCELLED'],
    [4, 'GAS', 'Palermo', '12-05T14:00', null, null, null, null, null, 'PENDING'],
    [5, 'PLUMBING', 'Caballito', '12-06T13:00', '12-06T16:00', null, null, null, 1, 'ACCEPTED'],
    [5, 'ELECTRICITY', 'Almagro', '12-06T16:00', '12-06T17:00', null, null, null, 2, 'IN_PROGRESS'],
    [5, 'GAS', 'Palermo', '12-07T10:00', null, null, null, null, null, 'PENDING'],
    [1, 'PLUMBING', 'Caballito', '11-29T16:00', '11-29T17:30', '11-30T12:00', null, null, 3, 'COMPLETED'],
    [2, 'PLUMBING', 'Almagro', '11-29T14:59', '11-29T16:00', '11-30T10:00', null, null, 4, 'COMPLETED'],
    [3, 'MASONRY', 'Palermo', '12-01T15:00', null, null, '12-01T16:00', 'A1', null, 'CANCELLED'],
    [4, 'ELECTRICITY', 'Caballito', '12-03T20:00', '12-04T14:00', '12-04T19:00', null, null, 3, 'COMPLETED'],
    [7, 'PLUMBING', 'Palermo', '12-02T10:00', '12-02T10:30', '12-02T11:30', null, null, 9, 'COMPLETED'],
  ];
  const serviceRequest = requests.map(([client, category, neighborhoodName, created, accepted, completed,
    cancelled, cancelledBy, tech, status], index) => ({
    id: uuid(3, index + 1), clientId: ids[`C${client}`], technicianId: tech ? uuid(2, tech) : null,
    neighborhoodName, category, street: 'Calle Ficticia Golden', streetNumber: String(100 + index),
    floor: null, apartment: null, directions: null,
    preferredTime: index === 0 ? 'MORNING' : index === 3 ? 'AFTERNOON' : 'ANY',
    description: `Problema ficticio de control Golden G${String(index + 1).padStart(2, '0')}.`,
    status, createdAt: instant(created), acceptedAt: instant(accepted), completedAt: instant(completed),
    cancelledAt: instant(cancelled), cancelledById: cancelledBy ? ids[cancelledBy] : null,
    updatedAt: instant(cancelled || completed || accepted || created),
  }));
  const offers = [
    [1, 1, '12-01T13:00', 'ACCEPTED'], [2, 2, '12-01T14:00', 'ACCEPTED'],
    [3, 1, '12-02T12:00', 'ACCEPTED'], [4, 3, '12-02T13:00', 'ACCEPTED'],
    [5, 2, '12-03T12:00', 'ACCEPTED'], [6, 4, '12-03T14:00', 'REJECTED'],
    [6, 5, '12-04T10:00', 'ACCEPTED'], [7, 1, '12-04T12:00', 'EXPIRED'],
    [8, 1, '12-04T15:00', 'CANCELLED'], [9, 3, '12-05T13:00', 'ACCEPTED'],
    [10, 4, '12-05T14:00', 'PENDING'], [11, 1, '12-06T13:00', 'ACCEPTED'],
    [12, 2, '12-06T16:00', 'ACCEPTED'], [13, 4, '12-07T10:00', 'PENDING'],
    [14, 3, '11-29T16:00', 'ACCEPTED'], [15, 4, '11-29T14:59', 'ACCEPTED'],
    [16, 5, '12-01T15:00', 'CANCELLED'], [17, 2, '12-03T20:00', 'RELEASED'],
    [17, 3, '12-04T13:00', 'ACCEPTED'], [18, 9, '12-02T10:00', 'ACCEPTED'],
  ];
  const serviceOffer = offers.map(([request, tech, created, status], index) => ({
    id: uuid(4, index + 1), requestId: uuid(3, request), technicianId: uuid(2, tech), status,
    createdAt: instant(created), expiresAt: new Date(Date.parse(instant(created)) + 86400000).toISOString(),
  }));
  return { reference: REFERENCE, user, technician, technicianSpecialty, technicianNeighborhood, serviceRequest, serviceOffer };
}

module.exports = { REFERENCE, createGoldenDataset };
