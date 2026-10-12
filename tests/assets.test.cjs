const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { AssetStore, ESSENTIAL, inside } = require('../src/assets.cjs');
test('asset cache imports, detects missing files, repairs corruption and preserves source', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vice-assets-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'owned-fixture');
  for (const file of ESSENTIAL) { await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true }); await fs.writeFile(path.join(source, file), 'SYNTHETIC TEST FIXTURE ' + file); }
  await fs.writeFile(path.join(source, 'gta-vc.exe'), 'NOT AN EXECUTABLE');
  await fs.writeFile(path.join(source, 'data/map.zon'), 'SYNTHETIC ZONE DATA');
  const store = new AssetStore(path.join(root, 'cache'));
  assert.equal((await store.import(source)).gameReady, true);
  assert.equal(await fs.readFile(path.join(root,'cache/game/data/map.zon'),'utf8'), 'SYNTHETIC ZONE DATA');
  await assert.rejects(fs.access(path.join(root, 'cache/game/gta-vc.exe')));
  const target = path.join(root, 'cache/game', ESSENTIAL[0]);
  await fs.writeFile(target, 'broken');
  assert.equal((await store.status()).gameReady, false);
  assert.equal((await store.ensureReady()).repaired, 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'SYNTHETIC TEST FIXTURE ' + ESSENTIAL[0]);
  await fs.rm(target);
  assert.equal((await store.repair()).repaired, 1);
  await fs.writeFile(target, 'broken');
  await fs.writeFile(path.join(source, ESSENTIAL[0]), 'changed source');
  await assert.rejects(store.repair(), /has changed/);
});
test('unsafe paths cannot escape the asset root', () => {
  for (const value of ['../secrets', 'C:/Windows', '\\Windows', 'file:stream', 'foo\0bar']) assert.throws(() => inside('C:/cache', value));
});
