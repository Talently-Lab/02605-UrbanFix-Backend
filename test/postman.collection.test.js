const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/postman', name), 'utf8'));
}

test('colección Postman no exporta credenciales y limita sus requests a operaciones implementadas', () => {
  const collection = read('UrbanFix.postman_collection.json');
  const environment = read('UrbanFix.postman_environment.json');
  for (const key of ['baseUrl', 'approvedBaseUrl', 'email', 'password', 'accessToken', 'registrationEmail']) {
    assert.equal(environment.values.find(item => item.key === key).value, '');
  }
  const operations = new Set(Object.entries(require('../docs/openapi.json').paths)
    .flatMap(([url, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${url}`)));
  for (const folder of collection.item) for (const item of folder.item) {
    assert.ok(operations.has(`${item.request.method} ${item.request.url.replace('{{baseUrl}}', '')}`));
    for (const event of item.event ?? []) new vm.Script(event.script.exec.join('\n'));
  }
});

test('guarda Postman omite requests sin destino aprobado y escrituras sin opt-in', () => {
  const collection = read('UrbanFix.postman_collection.json');
  const script = collection.event.find(event => event.listen === 'prerequest').script.exec.join('\n');
  function run(method, overrides) {
    const values = { baseUrl: 'https://backend.example.test', approvedBaseUrl: 'https://backend.example.test', target: 'preproduction', ...overrides };
    let skipped = false;
    const stop = new Error('skip');
    const pm = { environment: { get: key => values[key] }, request: { method, url: { toString: () => '{{baseUrl}}/api/barrios' } },
      variables: { replaceIn: value => value.replace('{{baseUrl}}', values.baseUrl) },
      execution: { skipRequest: () => { skipped = true; throw stop; } } };
    try { vm.runInNewContext(script, { pm }); } catch (error) { if (error !== stop) throw error; }
    return skipped;
  }
  assert.equal(run('GET'), false);
  assert.equal(run('POST'), true);
  assert.equal(run('PATCH', { allowWrites: 'true' }), false);
  for (const overrides of [{ approvedBaseUrl: '' }, { target: 'golden' }, { target: 'production' },
    { baseUrl: 'http://backend.example.test' }, { baseUrl: 'https://user:password@backend.example.test' }]) {
    assert.equal(run('GET', overrides), true);
  }
});
