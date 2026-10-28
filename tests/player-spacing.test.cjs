const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

test('player transforms use a high-rate stream and jitter-adaptive interpolation buffer',()=>{
  const native=fs.readFileSync(require.resolve('../engine/native-source/ViceTogetherNetwork.cpp'),'utf8');
  const transport=fs.readFileSync(require.resolve('../networking/realtime-transport.mjs'),'utf8');
  const dispatch=fs.readFileSync(require.resolve('../networking/frame-dispatch.mjs'),'utf8');
  assert.match(native,/constexpr DWORD playerSnapshotIntervalMs=14/,'Native player states are sampled at about 71 Hz');
  assert.match(native,/interval<1000&&interval<=std::max\(100\.0f,s\.meanInterval\*4\.0f\)/,'Long scheduler stalls must not inflate the interpolation delay for many seconds');
  assert.match(native,/jitterSample=std::min\(fabsf\(interval-s\.meanInterval\),s\.meanInterval\*2\.0f\)/,'A single packet gap must not dominate the jitter estimate');
  assert.match(native,/s\.jitter=s\.jitter\*0\.9f\+jitterSample\*0\.1f/,'Interpolation must adapt to each peer’s measured packet cadence');
  assert.match(native,/std::max\(minimumInterpolationDelayMs,s\.meanInterval\+s\.jitter\*2\.0f\)/,'Interpolation must keep enough history for the observed interval and jitter');
  assert.match(native,/constexpr float minimumInterpolationDelayMs=25\.0f/,'Low-jitter peers should not get an unnecessarily large fixed buffer');
  assert.match(transport,/movement:90/,'Movement channel must allow the higher-rate native snapshots without rate limiting');
  assert.match(dispatch,/interval=1000\/90/,'The authoritative player frame must keep pace with the native snapshots up to 90 Hz');
});

test('display prediction is route-aware per recipient and leaves authoritative state intact',()=>{
  const network=fs.readFileSync(require.resolve('../ui/network.js'),'utf8');
  const prediction=fs.readFileSync(require.resolve('../ui/player-prediction.mjs'),'utf8');
  assert.match(network,/previousState: previous\?\.state, previousTime: previous\?\.time/);
  assert.match(network,/this\.fast\?\.latency\(id\)\?\.rttMs/,'Prediction should use the measured peer route when available');
  assert.match(network,/forViewer\(viewerId\)/,'Snapshots must be projected separately for recipients with different routes');
  assert.match(network,/routeOneWayMs\(player\.id\) \+ routeOneWayMs\(viewerId\) \+ 35/,'Display prediction must cover the measured native playback buffer and dispatch interval');
  assert.match(network,/projectPlayerState\(sample, now, routeMs\)/);
  assert.match(network,/this\.sendSnapshot\('players', this\.world, forViewer\(viewerId\), \[viewerId\]\)/);
  assert.match(prediction,/state\[9\] !== 0/,'Do not predict a player body while attached to a vehicle');
  assert.match(prediction,/maxHorizonMs = 220/,'Prediction must stop after a bounded time horizon');
});
