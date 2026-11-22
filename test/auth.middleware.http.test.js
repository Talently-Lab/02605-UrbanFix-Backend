const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticate, authorize } = require('../src/middleware/auth.middleware');

const secret = 'middleware-http-test-key';
const userId = '11111111-1111-4111-8111-111111111111';
const sign = (options = {}) => jwt.sign({ userId, role: 'CLIENT' }, secret,
  { algorithm: 'HS256', expiresIn: 3600, ...options });

async function setup(t, account) {
  const app = express();
  let queries = 0;
  let actions = 0;
  const prisma = { user: { findUnique: async () => { queries++; return account; } } };
  const authenticated = authenticate({ prisma, jwtSecret: secret });
  app.get('/protected', authenticated, authorize('ADMIN'), (req, res) => {
    actions++;
    res.json({ id: req.user.id, role: req.user.role });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  return {
    request: header => fetch(`http://127.0.0.1:${server.address().port}/protected`, {
      headers: header === undefined ? {} : { Authorization: header },
    }),
    queries: () => queries,
    actions: () => actions,
  };
}

test('HTTP 401 conserva RFC 9457 y challenge y bloquea el handler antes de consultar Prisma', async t => {
  const fixture = await setup(t, { id: userId, role: 'ADMIN', accountStatus: 'ACTIVE' });
  for (const [header, type] of [[undefined, 'authentication-required'], ['Bearer malformed', 'invalid-token'],
    [`Bearer ${sign({ expiresIn: -1 })}`, 'token-expired']]) {
    const response = await fixture.request(header);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal(response.headers.get('www-authenticate'), type === 'authentication-required'
      ? 'Bearer realm="urbanfix"' : 'Bearer realm="urbanfix", error="invalid_token"');
    const body = await response.json();
    assert.equal(body.type, `/problems/${type}`);
    assert.equal(body.status, 401);
    assert.ok(body.title && body.detail);
  }
  assert.equal(fixture.queries(), 0);
  assert.equal(fixture.actions(), 0);
});

test('HTTP permisos usan el rol actual y distinguen suspensión, eliminación y rol incorrecto', async t => {
  for (const [account, status, type] of [
    [{ id: userId, role: 'CLIENT', accountStatus: 'ACTIVE' }, 403, 'forbidden'],
    [{ id: userId, role: 'ADMIN', accountStatus: 'SUSPENDED' }, 403, 'account-suspended'],
    [null, 401, 'invalid-token'],
    [{ id: userId, role: 'ADMIN', accountStatus: 'ACTIVE' }, 200, null],
  ]) {
    const fixture = await setup(t, account);
    const response = await fixture.request(`Bearer ${sign()}`);
    assert.equal(response.status, status);
    const body = await response.json();
    if (type) {
      assert.equal(body.type, `/problems/${type}`);
      assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    } else assert.deepEqual(body, { id: userId, role: 'ADMIN' });
    assert.equal(fixture.queries(), 1);
    assert.equal(fixture.actions(), status === 200 ? 1 : 0);
  }
});
