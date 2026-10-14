# ViceTogether alpha.13 - experimental

Joining now shows discovery, direct-route negotiation, authenticated-lobby verification and specific failure states. A stalled initial join retries automatically up to twice. Active direct negotiation gets 45 seconds per attempt before reporting a timeout; established lobbies are not restarted. Connection reports include the discovery and negotiation stages without IP addresses or invite secrets.

All 38 unit checks pass. A hidden same-PC test using public discovery and real WebRTC connected an authenticated lobby in 930 ms and checked friend presence, chat, lobby readiness and launch messages. It did not measure two-network gameplay or Radmin latency. No games were opened for this launcher test.

Includes alpha.12 native rejoin resets and discovery-endpoint changes, plus alpha.11 vehicle/menu fixes. Installed launchers download updates from GitHub; finish playing and close/reopen the launcher to apply them. Both players should use the same version. Portable users replace their executable manually. Game assets, profiles and saves remain local and are not included in public installers.

Public discovery services can rate-limit or become unavailable. Direct WebRTC depends on NAT/firewall conditions; no TURN relay is configured. This update cannot guarantee connectivity or 20 ms ping. Distributed NPC simulation, complete AI reactions, shared pickups, full world/particle parity, clean Windows testing and comprehensive two-network gameplay remain unfinished. No Radmin proprietary components, APK project or metered service is integrated.
