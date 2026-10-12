# Release verification — 12 October 2026

Version: 0.3.0-alpha.5. Experimental friend-test build, not a finished multiplayer release.

- 28 unit checks passed, including private invites, bounded combat/world authority, launch concurrency, pairwise social messaging and offline cache/repair preservation across replacement of a temporary install folder.
- The actual packaged Windows launcher passed hidden UI checks: profile navigation, Host/Join via public signaling, readiness, both validated launch handlers, duplicate Start protection and automatic guest preparation after rejoining an active lobby. Game launches were replaced by test callbacks; no GTA process was started.
- Two hidden renderer contexts exchanged real WebRTC social presence, text and delivery receipts using a local signaling relay.
- Two hidden renderers exchanged signed lobby rosters, synthetic movement and launch signaling over real WebRTC. Same-PC tests do not establish internet/NAT connectivity or gameplay quality.
- A separate hidden test used electron-updater with an older version adapter (0.3.0-alpha.4), discovered the live GitHub 0.3.0-alpha.5 release, and downloaded the 113,019,905-byte Setup file with updater SHA-512 verification. Installation/relaunch was deliberately disabled. A full NSIS installed-to-installed upgrade is still unverified.
- The GitHub Pages invitation page deployed successfully. Installed links use vicetogether://; uninstalled users must install, then return to the invitation page. Custom-protocol browser prompts are controlled by Windows/browser settings.
- Remote-only overhead names and stock radar/map entity blips compiled in the native engine. They have not been visually checked after this change.
- A publicly documented free TURN candidate failed forced-relay data delivery (no relay candidates). It is not configured. Metered Cloudflare TURN was not enabled because the user requires no possible overage. Direct WebRTC plus default STUN remains enabled. Restricted networks may fail to connect.

Not verified: clean Windows installation, two different internet networks, full combat/vehicle/world synchronization, and the 15 deferred game modes. No guarantee of perfect synchronization or guaranteed connectivity is made.
