const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

test('player transforms use a high-rate stream and jitter-adaptive interpolation buffer',()=>{
  const native=fs.readFileSync(require.resolve('../engine/native-source/ViceTogetherNetwork.cpp'),'utf8');
  const historyCapacity=Number(native.match(/constexpr int playerSnapshotHistoryCapacity=(\d+)/)?.[1]);
  const snapshotInterval=Number(native.match(/constexpr DWORD playerSnapshotIntervalMs=(\d+)/)?.[1]);
  assert.ok(historyCapacity>0&&snapshotInterval>0,'Native snapshot cadence and bounded history capacity must be declared');
  assert.ok((historyCapacity-1)*snapshotInterval>160,'The native history must span the full adaptive interpolation-delay range');
  assert.match(native,/times\[playerSnapshotHistoryCapacity\]; float states\[playerSnapshotHistoryCapacity\]/,'Snapshot time and pose histories must use the same bounded capacity');
  assert.match(native,/if\(s\.count==playerSnapshotHistoryCapacity\)/,'The oldest state must be evicted only when the bounded history is full');
  assert.match(native,/if\(vx\*vx\+vy\*vy>0\.0004f\)\{x\+=vx\*ahead;y\+=vy\*ahead;\}/,'Brief snapshot gaps should continue moving horizontal gait instead of freezing it');
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
  assert.match(network,/sourceTime:performance\.now\(\)/,'Movement packets preserve sender sample cadence across jitter bursts');
  assert.match(network,/previousSourceTime:previous\?\.sourceTime/,'The receiver retains sender timing for display-only velocity estimates');
  assert.match(network,/this\.fast\?\.latency\(id\)\?\.rttMs/,'Prediction should use the measured peer route when available');
  assert.match(network,/forViewer\(viewerId\)/,'Snapshots must be projected separately for recipients with different routes');
  assert.match(network,/const displaySequence=\+\+this\.displaySequence/,'Fresh projected display samples need their own monotonic sequence');
  assert.match(network,/displaySeq:displaySequence/,'Projected positions must refresh at the render-frame cadence even when source input has not advanced');
  assert.match(network,/routeOneWayMs\(player\.id\) \+ routeOneWayMs\(viewerId\) \+ 25/,'Display prediction should use the measured native interpolation buffer; frame-dispatch age is included in sample age');
  assert.match(network,/projectPlayerState\(sample, now, routeMs\)/);
  assert.match(network,/this\.sendSnapshot\('players', this\.world, forViewer\(viewerId\), \[viewerId\]\)/);
  assert.match(prediction,/state\[9\] !== 0/,'Do not predict a player body while attached to a vehicle');
  assert.match(prediction,/maxHorizonMs = 220/,'Prediction must stop after a bounded time horizon');
  const harness=fs.readFileSync(require.resolve('../src/native-game-test.cjs'),'utf8');
  assert.match(harness,/VT_TEST_NETWORK_JITTER_MS/,'Two-client native verification must support repeatable variable one-way delay');
  assert.match(harness,/\['movement','players','driver'\]\.includes\(kind\)/,'Controlled network delay should cover vehicle snapshots as well as player movement');
  assert.match(harness,/testCurrentDriverSentAt/,'Native car accuracy must compare host transforms against the guest snapshot send time, not its delayed receive time');
  assert.match(harness,/seq:\+\+entry\.sequence,data/,'The network test allocates snapshot ordering before injecting delay');
  assert.match(harness,/setTimeout\(\(\)=>\{if\(channel\.readyState==='open'\)\{try\{channel\.send\(packet\)/,'The network test injects delay after packet sequencing at the transport boundary');
  assert.match(harness,/simulatedJitterAmplitudePerDirectionMs/,'Native test reports the injected jitter alongside its measured spacing');
});

test('remote name and health tag sit clearly above the projected head',()=>{
  const source=fs.readFileSync(require.resolve('../engine/native-source/ViceTogether.cpp'),'utf8');
  assert.match(source,/remoteTagHeadClearance\(\)\{return SCREEN_SCALE_Y\(76\.0f\);\}/,'Keep a little more breathing room above the remote player head');
});
