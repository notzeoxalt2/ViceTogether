# Experimental friend-test build

Alpha.8 keeps only the newest pending player and ambient-world snapshot per peer when transport is busy, reducing obsolete updates queued during congestion. Gameplay events (shots, damage, seat requests and launch) retain their existing delivery path. It adds private connection reports in Friends and the lobby, including selected-route RTT and candidate types without IP addresses or invite secrets. Failed friend pairing now explains discovery versus direct-connectivity limitations. This does not guarantee lower internet latency or resolve every NAT restriction.

Validated with 30 unit tests and hidden same-PC launcher, friend presence/chat, lobby and movement delivery tests using public signaling. Actual gameplay on two internet connections remains unverified.

Install the Setup edition for automatic launcher updates. Import your own original PC Vice City folder once. Host a private lobby, share its code, and start when both players are ready. Keep both launchers open while playing.

Updates preserve the launcher profile, local game cache and saves. The portable edition requires manual replacement. No original GTA game assets are included in GitHub downloads.

This is an experimental multiplayer prototype, not a finished or 1:1 GTA Online experience. Full combat, guest driving and police interactions remain unfinished. No TURN service is configured; some networks cannot connect. Fresh Windows and cross-network tests have not been completed. Fifteen game modes are deferred.

This build adds saved friends and text chat (both launchers open), lobby setup controls, duplicate-launch protection, late-join launch signaling, an editable local player name, remote-only overhead names and native radar/map blips. The Rust migration preview is source-only here; the packaged multiplayer build still uses Electron.
