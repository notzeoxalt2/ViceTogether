const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectPlayerState } = require('../ui/player-prediction.mjs');

const player = (x, y, move = 1, vehicle = 0) => [x, y, 8, 0, 0, 0, 0, move, 100, vehicle];

test('display prediction advances only horizontal on-foot movement by a bounded route lead', () => {
  const state = player(0, 0);
  const sample = { state, time: 100, previousState: player(-0.06, 0), previousTime: 80 };
  const projected = projectPlayerState(sample, 110, 90);
  assert.ok(Math.abs(projected[0] - 0.3) < 1e-9);
  assert.equal(projected[1], 0);
  assert.equal(projected[2], state[2]);
  assert.deepEqual(state, player(0, 0), 'Projection must not mutate authoritative lobby state');
});

test('prediction uses sender sample cadence when network delivery bunches snapshots together',()=>{
  const sample={state:player(0,0),time:151,previousState:player(-0.084,0),previousTime:150.2,sourceTime:114,previousSourceTime:100};
  const projected=projectPlayerState(sample,151,185);
  assert.ok(Math.abs(projected[0]-1.11)<1e-8,'A sub-millisecond receive gap must not disable prediction when sender samples are 14 ms apart');
});

test('prediction blends the native ped velocity with sender-timed movement for stable spacing',()=>{
  const sample={state:[0,0,8,0,0.08,0,0,1,100,0],time:110,previousState:[-0.06,0,8,0,0.08,0,0,1,100,0],previousTime:90};
  const projected=projectPlayerState(sample,110,100);
  assert.ok(Math.abs(projected[0]-0.35)<1e-9,'Average the 3 m/s position slope and 4 m/s native velocity over 100 ms');
  assert.equal(projected[1],0);
});

test('prediction refuses seated, idle, stale, discontinuous and vertical-only states', () => {
  const current = player(0, 0);
  const previous = player(-0.06, 0);
  const unchanged = sample => assert.deepEqual(projectPlayerState(sample, 110, 90), sample.state);
  unchanged({ state: player(0, 0, 1, 1), time: 100, previousState: player(-0.06, 0, 1, 1), previousTime: 80 });
  unchanged({ state: player(0, 0, 0), time: 100, previousState: previous, previousTime: 80 });
  unchanged({ state: current, time: -200, previousState: previous, previousTime: -220 });
  unchanged({ state: current, time: 100, previousState: player(-4, 0), previousTime: 80 });
  unchanged({ state: current, time: 100, previousState: player(0, 0), previousTime: 80 });
});

test('high RTT projection and state age are capped to the configured horizon', () => {
  const sample = { state: player(0, 0), time: 100, previousState: player(-0.24, 0), previousTime: 80 };
  const projected = projectPlayerState(sample, 120, 600);
  assert.equal(projected[0], 2.64, '12 m/s maximum speed is limited to 220 ms');
  assert.equal(projected[2], 8, 'Vertical movement is never predicted');
});
