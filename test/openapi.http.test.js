const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/index');

test('Swagger y OpenAPI públicos describen solo las operaciones implementadas sin consultar Prisma', async t => {
  const prisma = new Proxy({}, { get() { throw new Error('No database access allowed'); } });
  const server = createApp({ prisma, jwtSecret: 'fixture-secret' }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/openapi.json`);
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.openapi, '3.0.3');
  assert.deepEqual(Object.entries(spec.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method} ${path}`)).sort(), [
    'get /', 'get /api/barrios', 'get /api/especialidades', 'get /api/usuarios/me',
    'patch /api/usuarios/me', 'post /api/auth/login', 'post /api/auth/register',
  ]);
  assert.deepEqual(spec.paths['/api/usuarios/me'].get.security, [{ bearerAuth: [] }]);
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
  const page = await fetch(`${base}/docs/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /swagger-ui/);
  const script = await fetch(`${base}/docs/swagger-ui-init.js`);
  const settings = await script.text();
  assert.match(settings, /"validatorUrl": null/);
  assert.match(settings, /"persistAuthorization": false/);
  assert.ok(!settings.includes('passwordHash'));
  const health = await fetch(base);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { message: 'UrbanFix API funcionando' });
});

test('OpenAPI resuelve referencias y conserva schemas, permisos y errores del contrato vigente', () => {
  const spec = require('../docs/openapi.json');
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.match(value.$ref, /^#\/components\/schemas\//);
      assert.ok(spec.components.schemas[value.$ref.split('/').at(-1)]);
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(spec);
  const { schemas } = spec.components;
  assert.deepEqual(schemas.ClientRegistration.properties.role.enum, ['CLIENT']);
  assert.deepEqual(schemas.TechnicianRegistration.properties.role.enum, ['TECHNICIAN']);
  assert.equal(schemas.ClientRegistration.additionalProperties, false);
  assert.equal(schemas.TechnicianRegistration.additionalProperties, false);
  assert.deepEqual(Object.keys(schemas.ProfilePatch.properties).sort(), ['name', 'phone']);
  assert.equal(schemas.Profile.properties.phone.nullable, true);
  assert.equal(schemas.Identity.properties.phone, undefined);
  assert.ok(schemas.TechnicianRegistration.required.includes('neighborhoodIds'));
  assert.ok(schemas.TechnicianRegistration.required.includes('specialties'));
  for (const status of [400, 404, 409, 500]) assert.ok(spec.paths['/api/auth/register'].post.responses[status]);
  for (const status of [400, 401, 403, 500]) assert.ok(spec.paths['/api/usuarios/me'].patch.responses[status]);
  assert.equal(spec.paths['/api/barrios'].get.security, undefined);
  assert.equal(schemas.Neighborhood.properties.comuna, undefined);
});
