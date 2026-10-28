const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

test('player transforms use a high-rate stream and jitter-adaptive interpolation buffer',()=>{
  const native=fs.readFileSync(require.resolve('../engine/native-source/ViceTogetherNetwork.cpp'),'utf8');
  const transport=fs.readFileSync(require.resolve('../networking/realtime-transport.mjs'),'utf8');
  const dispatch=fs.readFileSync(require.resolve('../networking/frame-dispatch.mjs'),'utf8');
  assert.match(native,/constexpr DWORD playerSnapshotIntervalMs=14/,'Native player states must be sampled at roughly 60 Hz on common game frame rates');
  assert.match(native,/s\.jitter=s\.jitter\*0\.9f\+fabsf\(interval-s\.meanInterval\)\*0\.1f/,'Interpolation must adapt to each peer’s measured packet cadence');
  assert.match(native,/std::max\(minimumInterpolationDelayMs,s\.meanInterval\+s\.jitter\*2\.0f\)/,'Interpolation must keep enough history for the observed interval and jitter');
  assert.match(native,/constexpr float minimumInterpolationDelayMs=25\.0f/,'Low-jitter peers should not get an unnecessarily large fixed buffer');
  assert.match(transport,/movement:90/,'Movement channel must allow the higher-rate native snapshots without rate limiting');
  assert.match(dispatch,/interval=1000\/60/,'The authoritative player frame must be forwarded at 60 Hz');
});
