const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('entrypoint público delega una sola vez al CLI existente y no ejecuta al importar', () => {
  const source = fs.readFileSync(path.join(__dirname, '../prisma/seed.js'), 'utf8');
  for (const main of [false, true]) {
    let calls = 0;
    const module = { exports: {} };
    const require = name => {
      assert.equal(name, './seed/run');
      return { runSeedCli: () => { calls++; } };
    };
    require.main = main ? module : {};
    vm.runInNewContext(source, { module, require });
    assert.equal(calls, main ? 1 : 0);
  }
  assert.equal(typeof require('../prisma/seed/run').runSeedCli, 'function');
});

test('package y Prisma config comparten el seed explícito sin agregar automatismos', () => {
  const { scripts } = require('../package.json');
  assert.equal(scripts.seed, 'node prisma/seed.js');
  const config = fs.readFileSync(path.join(__dirname, '../prisma7.config.ts'), 'utf8');
  assert.match(config, /seed:\s*['"]node prisma\/seed.js['"]/);
  assert.equal(scripts.start, 'node src/index.js');
  assert.equal(scripts.postinstall, undefined);
});
