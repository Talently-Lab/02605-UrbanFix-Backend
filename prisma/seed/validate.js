const { createHash } = require('node:crypto');

const CATALOG_SHA256 = '314bcbf1322d47cebe7d6534ea09d79b253c74d9518ebd93a0f5e7b621765c3a';

function validateCatalogCsv(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('CSV de barrios vacío o inválido');
  }
  const rows = content.trim().split(/\r?\n/).map(line => line.split(',').map(value => value.trim()));
  if (rows.length !== 49 || rows[0].join(',') !== 'id_barrio,Barrio,id_comuna') {
    throw new Error('CSV de barrios: se requieren las tres columnas originales y 48 registros');
  }
  const ids = new Set();
  const names = new Set();
  for (const row of rows.slice(1)) {
    const [id, name, commune] = row;
    if (row.length !== 3 || !/^[1-9][0-9]*$/.test(id) || Number(id) > 48 ||
        !name || !/^[1-9][0-9]*$/.test(commune) || Number(commune) > 15 ||
        ids.has(id) || names.has(name)) {
      throw new Error('CSV de barrios: registro inválido o duplicado');
    }
    ids.add(id);
    names.add(name);
  }
  const canonical = rows.map(row => row.join(',')).join('\n');
  if (createHash('sha256').update(canonical).digest('hex') !== CATALOG_SHA256) {
    throw new Error('CSV de barrios: el contenido no coincide con el catálogo oficial versionado');
  }
  return rows.slice(1).map(([, name]) => ({ name }));
}

module.exports = { validateCatalogCsv };
