const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
async function sync() { return import('data:text/javascript;base64,' + Buffer.from(await fs.readFile(require.resolve('../engine/sync.js'), 'utf8')).toString('base64')); }
const state = (x, angle = 0) => [x, 0, 5, angle, 0, 0, 0, 2, 100, 0];
test('interpolates transforms and wraps headings without rotating the long way', async () => {
  const { SnapshotBuffer } = await sync();
  const buffer = new SnapshotBuffer();
  buffer.push(state(0, 3.1), 0); buffer.push(state(10, -3.1), 100);
  const result = buffer.sample(50);
  assert.equal(result[0], 5);
  assert.ok(Math.abs(Math.abs(result[3]) - Math.PI) < 0.01);
});
test('rejects malformed snapshots, bounds history, and snaps on teleports', async () => {
  const { SnapshotBuffer, validState } = await sync();
  assert.equal(validState(state(NaN)), false);
  assert.equal(validState(state(99999)), false);
  const buffer = new SnapshotBuffer();
  assert.equal(buffer.push(state(0), 0), true);
  assert.equal(buffer.push(state(10), -1), false);
  buffer.push(state(200), 100);
  assert.equal(buffer.sample(50)[0], 200);
  for (let i = 0; i < 100; i++) buffer.push(state(i), 200 + i);
  assert.equal(buffer.frames.length, 40);
});
