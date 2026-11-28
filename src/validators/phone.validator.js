const { codes } = require('../data/argentina-area-codes.json');
const areaCodes = [...codes].sort((a, b) => b.length - a.length);

function isArgentinePhone(value) {
  if (typeof value !== 'string' || !/^\+54(?:[0-9]{10}|9[0-9]{10})$/.test(value)) return false;
  const national = value.slice(value.length === 14 ? 4 : 3);
  const area = areaCodes.find(code => national.startsWith(code));
  return Boolean(area && /^[2-9][0-9]+$/.test(national.slice(area.length)));
}

module.exports = { isArgentinePhone };
