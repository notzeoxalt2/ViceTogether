# Reusable peer transport

This MIT-licensed module has no Vice City engine dependency. Other games can import `networking/index.mjs` or copy this directory while preserving the license. It is experimental, not a complete networking SDK or matchmaking service.

- `RealtimeTransport`: unordered WebRTC snapshots without retransmission, bounded buffers, monotonic sequence rejection, matched RTT echoes and a rolling 20-sample latency/jitter report. Snapshot kinds can be configured per game.
- `SnapshotSender`: one in-flight send and one newest replacement during backpressure. Use only for replaceable state, never transactions or damage events.
- `FrameDispatch`: immediately forward an accepted change when the rate budget permits; coalesce bursts at up to 60 Hz by default. Close it when leaving a session.

```js
import {RealtimeTransport, FrameDispatch} from './networking/index.mjs';
const stream = new RealtimeTransport({
  kinds: ['state', 'input'],
  receive(kind, data, peerId) {
    // Validate game-specific bounds and authenticated authority before applying.
  }
});
// With Trystero, pass stream.Peer as rtcPolyfill so incoming channels are observed.
// After an authenticated peer joins, attach(peerId, pc) on both ends and call
// initiate(peerId, pc) on exactly one end. Both games must agree on kind names.
// Keep reliable authentication, inventory and combat messages on another channel.
```

This module does not authenticate peers, choose signaling providers, supply STUN/TURN, implement prediction or alter ISP routes. ViceTogether implements authentication and session authority above it. Game integrations must do the same. Public discovery is external infrastructure even when free; direct connectivity is not guaranteed. A relay or VPN can change a route but requires a reachable service and may increase latency. No metered relay or proprietary Radmin component is included.

## Measurements, 15 October 2026

Hidden Windows tests used two Chromium contexts on one PC. Public discovery formed an authenticated lobby in 780 ms. This is setup time, not game ping.

Twenty synthetic guest-input/host-return samples per mode reproduced the old fixed 50 ms gate and compared immediate/coalesced dispatch on the same established connection:

| Dispatch | Median | 95th percentile |
|---|---:|---:|
| Old fixed gate | 39.2 ms | 54.6 ms |
| Immediate/coalesced | 25.9 ms | 26.9 ms |

The fixture sends a new input after the previous return plus 7 ms, intentionally exercising burst coalescing. Results do not represent all game workloads. The movement-channel echo measured 0.5 ms over loopback; it is not an internet-latency claim. OS scheduling can exceed the nominal dispatch interval.

A separate 20-second hidden native test replicated walking between two actual engines over WebRTC at measured median rendering rates of about 143 FPS. Its position comparison permits historical lag and cannot establish perceptual smoothness or 1:1 synchronization. Cross-network gameplay and fresh Windows remain unverified.

For later route comparisons, record discovery time, authenticated setup time, selected candidate types/protocol and transport RTT, movement-channel RTT p50/p95/jitter, reliable-message RTT, dropped probes/snapshots, buffered bytes and dispatch wait. Do not hide a slow route by relabeling setup time or smoothing away spikes. Compare alternatives on the same two endpoints; select a relay only when measurements and availability justify it.
