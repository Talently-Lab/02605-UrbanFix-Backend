const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateCatalogCsv } = require('../prisma/seed/validate');

const csv = readFileSync(join(__dirname, '../prisma/data/Barrios.csv'), 'utf8');

test('seed valida los 48 barrios oficiales y mapea únicamente Barrio a name', () => {
  const result = validateCatalogCsv(csv);
  assert.equal(result.length, 48);
  assert.deepEqual(result[0], { name: 'Agronomía' });
  assert.deepEqual(result[47], { name: 'Villa Urquiza' });
  assert.equal(new Set(result.map(row => row.name)).size, 48);
  assert.ok(result.some(row => row.name === 'Núñez'));
  assert.ok(result.every(row => Object.keys(row).join() === 'name'));
});

test('seed admite los espacios del CSV original y finales de línea CRLF o LF', () => {
  assert.deepEqual(validateCatalogCsv(csv.replace(/\r\n/g, '\n')), validateCatalogCsv(csv));
});

test('seed rechaza CSV vacío, columnas distintas, filas incompletas y cantidades incorrectas', () => {
  for (const input of [undefined, null, '', '   ', Buffer.from(csv),
    csv.replace('id_comuna', 'comuna'), csv.replace('id_comuna', 'id_comuna,extra'),
    csv.replace('1, Agronomía, 15', '1, Agronomía'),
    csv.replace('1, Agronomía, 15', '1, , 15'),
    csv.replace('1, Agronomía, 15', ', Agronomía, 15'),
    csv.replace('1, Agronomía, 15', '1, Agronomía, '),
    csv.split(/\r?\n/).slice(0, 48).join('\n'),
    `${csv.trim()}\n49, Otro barrio, 1\n`,
    csv.replace('2, Almagro, 5', '\n2, Almagro, 5')]) {
    assert.throws(() => validateCatalogCsv(input), /CSV de barrios/);
  }
});

test('seed rechaza duplicados, IDs fuera de rango y comunas inválidas', () => {
  for (const input of [
    csv.replace('2, Almagro, 5', '1, Almagro, 5'),
    csv.replace('Almagro', 'Agronomía'),
    csv.replace('1, Agronomía, 15', '0, Agronomía, 15'),
    csv.replace('1, Agronomía, 15', '49, Agronomía, 15'),
    csv.replace('1, Agronomía, 15', '1.5, Agronomía, 15'),
    csv.replace('1, Agronomía, 15', '1, Agronomía, 0'),
    csv.replace('1, Agronomía, 15', '1, Agronomía, 16'),
    csv.replace('1, Agronomía, 15', '1, Agronomía, x')]) {
    assert.throws(() => validateCatalogCsv(input), /CSV de barrios/);
  }
});

test('seed rechaza sustituciones plausibles de nombres o correspondencias del archivo oficial', () => {
  for (const input of [csv.replace('Agronomía', 'Barrio inventado'),
    csv.replace('Núñez', 'Nunez'), csv.replace('1, Agronomía, 15', '1, Agronomía, 14'),
    csv.replace('1, Agronomía, 15', '2, Agronomía, 15').replace('2, Almagro, 5', '1, Almagro, 5')]) {
    assert.throws(() => validateCatalogCsv(input), /CSV de barrios/);
  }
});
