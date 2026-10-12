# ViceTogether alpha.9 — experimental

Guests can request an empty shared driver's seat with F; either player can request a passenger seat with G. A hidden two-engine fixture verified the guest driving roughly 290 metres with the host riding in the same car. Destroyed cars reject seat grants. Internet driving and all entry/exit transitions still need testing.

Replaceable snapshots use an additional unordered WebRTC stream without retransmissions when both clients support it. Lobby, damage and other gameplay events retain reliable delivery. This reduces one cause of packet backlog, without guaranteeing low ping or unrestricted NAT connectivity. Troubleshooting reports transport RTT and applied guest-hit counters without IP addresses or invitation secrets.

Hosts can start alone and accept ready players into a running session. Friends have connection/message notifications. Ctrl+O opens a small keyboard weapon menu: arrows, Enter, Backspace. This is an initial menu, not a full Menyoo equivalent or vehicle catalogue. Multiplayer user pause no longer stops world simulation. Seat transitions, weapon replacement, adaptive player buffering, near-death-location respawn and remote name/health labels have been adjusted.

Approved guest instant-hit gunfire is recast against the host's world for NPC/vehicle damage. This is implemented but not verified as complete NPC combat. Police behavior, shared pickups, all particles, distant-area population simulation, public lobby browsing and 15 game modes remain unfinished. World synchronization is not 1:1.

The missing latest.yml metadata is repaired. Future releases publish both latest.yml and alpha.yml; the app explicitly chooses the alpha channel and shows download progress. Updates preserve game files, profiles and saves. Finish playing before closing the launcher to install. Portable users replace their executable manually. GitHub installers contain no original GTA assets.

Verified: 34 unit tests; hidden public-signaling friend/lobby/solo-start/late-join tests; actual two-way unordered WebRTC snapshots; and hidden guest-driver/host-passenger gameplay on one PC. The old default-channel updater detected and downloaded alpha.8 with checksum verification, without executing the installer. Clean Windows and comprehensive two-network gameplay remain unverified. No TURN fallback or metered hosting is enabled.
