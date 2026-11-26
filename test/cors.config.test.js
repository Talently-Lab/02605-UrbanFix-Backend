const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { parseFrontendOrigins } = require('../src/config/cors.config');

test('FRONTEND_URL exige configuración no vacía sin mostrar su contenido', () => {
  for (const value of [undefined, null, '', ' ', 123, [], {}, ',', 'http://localhost:5173,']) {
    assert.throws(() => parseFrontendOrigins(value), error =>
      error.message.includes('FRONTEND_URL') && !error.message.includes('localhost'));
  }
});

test('FRONTEND_URL admite uno o varios orígenes HTTP/HTTPS y elimina duplicados', () => {
  assert.deepEqual(parseFrontendOrigins('http://localhost:5173'), ['http://localhost:5173']);
  assert.deepEqual(parseFrontendOrigins(' https://frontend.example.test/ , http://localhost:5173, https://frontend.example.test '),
    ['https://frontend.example.test', 'http://localhost:5173']);
});

test('FRONTEND_URL rechaza comodines, credenciales y componentes ajenos al origen', () => {
  for (const value of ['*', 'https://*.example.test', 'https://example.test/*', 'null',
    'ftp://example.test', 'example.test', '//example.test',
    'https://private-user:private-password@example.test', 'https://private-user@example.test',
    'https://example.test/app', 'https://example.test/?secret=value', 'https://example.test/#fragment',
    'https://example.test?', 'https://example.test#', 'https://example.test/../',
    'https://example.test\\app', 'https://exa\nmple.test']) {
    assert.throws(() => parseFrontendOrigins(value), error =>
      error.message.includes('FRONTEND_URL') && !error.message.includes(value) && !error.message.includes('private-'));
  }
});

function runStartup(frontendUrl) {
  const events = [];
  const logs = [];
  const app = { use() {}, get() {}, listen() { events.push('listen'); } };
  const express = Object.assign(() => app, { json: () => () => {} });
  const entry = require.resolve('../src/index');
  const localRequire = createRequire(entry);
  const module = { exports: {} };
  const fakeRequire = name => {
    if (name === 'dotenv/config') { events.push('dotenv'); return {}; }
    if (name === './lib/prisma') { events.push('prisma'); return {}; }
    if (name === 'express') return express;
    if (name === './routes') return { createApiRouter: () => () => {} };
    return localRequire(name);
  };
  fakeRequire.main = module;
  const process = { env: { FRONTEND_URL: frontendUrl } };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    require: fakeRequire, module, process,
    console: { error: message => logs.push(message), log() {} },
  });
  return { events, logs, process };
}

test('arranque inválido se detiene antes de cargar Prisma o escuchar, sin leer .env real', () => {
  for (const value of [undefined, 'https://private-user:private-password@example.test']) {
    const { events, logs, process } = runStartup(value);
    assert.deepEqual(events, ['dotenv']);
    assert.equal(process.exitCode, 1);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /FRONTEND_URL/);
    assert.ok(!logs[0].includes('private-'));
  }
});

test('arranque válido carga la configuración antes de Prisma y del servidor', () => {
  const { events, logs, process } = runStartup('https://frontend.example.test');
  assert.deepEqual(events, ['dotenv', 'prisma', 'listen']);
  assert.deepEqual(logs, []);
  assert.equal(process.exitCode, undefined);
});
