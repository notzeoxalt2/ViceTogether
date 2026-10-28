# ViceTogether alpha.48 — lift player name tags slightly

Moved the transparent player name and health group 6 scaled pixels higher above the rendered head. The name and health bar remain centered and aligned.

Validation: all 99 repository tests passed. A hidden 15-second two-client native render test passed at about 143.9 FPS per client. The health line measured 36 px above the animated head anchor and the name/health alignment error was below 0.00002 px p95. This is a same-PC test, not an internet-route test.

---

# ViceTogether alpha.47 — reduce on-foot position lag

Remote on-foot player positions now use a bounded, RTT-aware display prediction. Each recipient gets a snapshot projected for its measured route; only horizontal display coordinates change, so vehicle motion and authoritative hit/seat checks stay untouched. The transparent name/health group remains aligned and 30 scaled pixels above the rendered head.

Validation: all 98 repository tests passed. Two hidden native game instances ran at about 143.8 FPS with frame-time p95 near 7.1 ms. Same-PC present-position gap p95 measured 0.145 m and 0.134 m with no injected delay, 0.345 m and 0.260 m at 150 ms simulated RTT, and 0.399 m and 0.378 m at 300 ms simulated RTT. These are controlled same-PC delay simulations, not tests across separate ISPs or NATs. Public internet connectivity, full vehicle coverage, and fresh-Windows first-run remain unverified. Each player imports their own legally obtained Vice City files; no original game assets are included.

---

# ViceTogether alpha.46 — lift the floating name tag

Raised the floating name and health group by 3 pixels above the animated head anchor. The name and health remain centered together and have no background panel.

Validation: all 95 repository tests passed. A hidden 30-second two-client native-game render check passed: both clients averaged 143.7 FPS; name/health alignment error stayed below 0.00003 px p95; the health line sat 30 px above the rendered head anchor in both views; timestamp-aligned player spacing error was 0.161 m and 0.165 m p95. This is same-PC testing, not a public-internet connectivity test. Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.45 — tighten name-tag head spacing

The alpha.44 two-client run measured the name/health group 30 px above the projected head anchor in both views. This update sets the extra offset to 13 scaled pixels, keeping the name and health line aligned while lifting them just slightly.

Validation: all 95 repository tests passed. A hidden 30-second paired native-game test passed on this PC: both clients averaged 143.9 FPS, timestamp-aligned player spacing error was 0.168 m and 0.155 m p95, head clearance measured 27 px p95 in both views, and name/health alignment stayed within 0.00003 px. This is same-PC testing, not public-internet connectivity testing. Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.44 — lift player labels slightly

The floating name and health line now sit 4 scaled pixels higher over the player's head, staying aligned and centered without a background panel.

Validation: all 95 repository tests passed. The prior hidden two-client render check passed at alpha.43; this small offset change has not yet been visually rechecked in a new paired game session. Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.43 — clearer player labels

The floating player name and health line now sit 8 scaled pixels higher above the animated head. They remain centered together, without a background panel.

The updated Windows native build passed a 30-second hidden two-client session. In both views, the name and health line stayed centered together (alignment error below 0.00002 px p95), with 26 px p95 clearance above the projected head anchor. Both clients averaged 143.9 FPS; timestamp-buffered movement error was 0.17 m p95. This verifies same-PC rendering and movement only; it does not establish perfect synchronization or public-internet connectivity.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.42 — smoother movement and grounded Maverick spawns

Player snapshots now run at roughly 60 Hz. Interpolation ignores isolated long scheduler stalls so one missed update does not leave both players with an unnecessarily large smoothing delay. Remote player names and health lines are centered together and raised slightly above the animated head.

Guest-requested Mavericks spawn at a safe ground-level position away from the requester. The idle helicopter stays parked with its engine and rotors off. A guest who rejoins the running room can request a helicopter, and both game clients receive the same vehicle.

Validation on the Windows CI build:

- All 95 JavaScript tests passed, and the Windows installer and portable build completed in GitHub Actions.
- Two hidden native game clients ran for 30 seconds in the same-PC walking test. Both averaged about 143.9 FPS; player state packets arrived at 14 ms p95, and timestamp-aligned remote movement error was 0.17 m p95. The projected name/health alignment error was below 0.00002 px.
- The two-client helicopter check passed after an in-process guest rejoin. Both games rendered the requested Maverick 24 m from the guest and 1.0002 m above measured ground; its rotors and engine stayed off, drift was 0 m, and the fast snapshot channel was confirmed after rejoin.
- A separate two-client passenger test observed Vice City's stock helicopter boarding animation and kept the host attached to the passenger seat for 1.27 seconds.

These are same-PC tests, not public-internet or cross-NAT tests. The helicopter request test used the lobby spawn action because the native menu injection hook was unavailable in this build. Vehicle flight, all vehicle models, full combat, NPC AI, and a fresh Windows installation remain unverified. This is experimental multiplayer, not a claim of perfect 1:1 synchronization.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.39 — stable multiplayer helicopters

Network Mavericks now use the native stationary helicopter route while nobody is piloting, instead of the script route that follows the local player and climbs. Empty replicas are corrected only after measurable drift; the game is left alone while a seat is occupied or a remote pilot is sending movement. Local menu spawns place helicopters 15 m ahead, and guest requests retain the host's 18 m clearance.

The hidden two-client test now records seat-claim decisions and helicopter health/position after spawn, checks requester clearance, and can reset/rejoin the guest's native world during the same session. The Windows native-engine build and paired flight/rejoin checks are pending; this alpha will not be published until those checks pass.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.36 — higher-rate vehicle motion

The native driver-state stream now targets 90 updates per second instead of 60, reducing the motion step size guests see between game frames. The transport and host validation limits were adjusted to accept this rate while keeping snapshot traffic bounded and dropping stale/reordered updates.

Validation: all 74 repository tests passed. A hidden 25-second same-PC test used two Windows native game instances in a real private WebRTC lobby. The guest received host-car updates at 87.5 Hz (13 ms median, 15 ms p95), applied 1,609 updates, and interpolated at 129 Hz. Both games stayed near 143.6 FPS; no vehicle packets were dropped or rate-limited. This is a driver-stream smoothness test only: passengers, other vehicle classes, and public internet routes were not tested.

The higher cadence should reduce visible stepping; it does not remove route latency, guarantee equal physics, or establish 1:1 synchronization.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.35 — host-driven vehicle smoothness

Host-driven vehicles now use the same high-rate native driver-state stream that already kept guest-driven vehicles smooth. Guests apply these validated snapshots to the native car replica and interpolate between samples instead of relying on the slower ambient-world update. The change covers supported cars, bikes, boats, and aircraft through the shared vehicle stream.

Validation: all 74 repository tests passed. A hidden same-PC test used two native game instances and a real private WebRTC lobby for a 25-second host-driven car session. The guest received 1,171 of 1,171 host snapshots, with 14 ms median and 21 ms p95 arrival intervals; it applied 1,161 snapshots and rendered about 2.04 interpolation ticks per packet. Both local engines measured about 143 FPS. The test did not cover a passenger in the car or public internet routes; this is a smoothness improvement, not proof of perfect physics or guaranteed connectivity.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.34 — vehicle sync verification

Multiplayer vehicle construction now checks the game's handling flags, so Maverick/Hunter helicopters and the Skimmer are created with their aircraft classes instead of falling through the generic model category. Boat test setup searches farther for open water. Guest seat occupants send bounded door-angle changes during stock enter/exit tasks; the host validates the current seat claim and replays them with the native `OpenDoor` animation path.

The native paired test now records local entry/exit animation state and door angles, checks the model's constructed vehicle class, and can drive a car into a controlled barrier to verify damage replication while testing a guest driver and host passenger. Passenger exit now uses Vice City's stock input instead of an AI objective. Door visibility and the car, bike, boat, and helicopter scenarios still need to pass against the Windows CI-built engine before this alpha is published. Broader collision cases, passenger pose/audio fidelity, public-network routes, and a clean Windows VM still need separate validation. This remains an experimental prototype, not 1:1 synchronization.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.32 — centered player labels

Remote player names and health lines now share one head-projected center. The text uses the engine's centered text layout, and its drop shadow is removed so the tag stays clean with no backing panel. The native two-client test now records the name/health center offset and the health line's gap from the animated head.

Validation on the Windows CI-built engine: all 69 repository tests passed; two native clients launched through the actual launcher lobby and moved for 30 seconds. Instrumented name/health center offset was 0 px p95, animated-head spacing error was 0.16 m and 0.21 m p95 across the two views, and median frame rates were 141.6 and 142.1 FPS. This was a same-PC test, not a public internet or fresh-Windows test, and it does not establish perfect gameplay synchronization.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.31 — smoother vehicle snapshots

Guest-driven car, bike, boat, and aircraft motion now sends native driver snapshots near 60 Hz instead of 20 Hz. The host accepts those replaceable snapshots at the matching rate while continuing to reject invalid ownership, teleports, and malformed vehicle state. The two-game guest-drive test now checks the measured arrival cadence as well as car motion, orientation, seats, exits, and frame rate.

This is an incremental smoothness improvement, not a claim of perfect vehicle synchronization. Vehicle physics and collisions can still differ between each player's local game; internet route latency is not removed by a higher snapshot rate. The Windows build and paired-game test must pass before publishing this update.

Each player imports their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.30 — head-anchored player labels

Remote player labels now follow the animated head bone instead of a fixed offset from the ped root. The name and slim health line use the same projected center, with the line directly below the name and no backing panel. The paired native game test now measures world-space head separation and confirms the name/health projection stays together.

The updated native build and two-client test must pass before publishing. Each player imports their own legally obtained Vice City installation; no game assets are included.

---

# ViceTogether alpha.29 — shared vehicle rotation

Guest-driven cars now send their angular velocity to the host, and host-owned world vehicle snapshots include angular velocity for remote playback. This lets the other game follow turning, pitching, rolling, and settling motion instead of only copying position and orientation while losing the car's rotational momentum.

Two repeated same-PC native host/guest runs passed using the actual launcher lobby and stock enter, drive, and exit controls. Both clients stayed around 143 FPS; the second run recorded 53 ms maximum sample age, 0.025 basis error p95, 0.0049 angular-velocity error p95, and 1.96 m position error p95. Position mismatch remains visible at times. The test did not cover rollovers, every vehicle type, public internet/NAT routes, or a fresh Windows install, so this is an incremental experimental fix rather than a claim of perfect synchronization.

Each player must import their own legally obtained Vice City installation. No game assets are included.

---

# ViceTogether alpha.28 — guest-driven vehicle replication

Guest driver updates include the car’s health and visual state, and the guest sends driver motion at 20 Hz instead of 10 Hz. The host accepts motion only after the lobby validates an exclusive driver claim. The native bridge now tolerates the short interval where Vice City has granted that claim but its stock seat task has not attached the remote player to `pDriver`; it still refuses to overwrite a locally driven car or an unrelated driver. Wreck status stays authoritative across later cosmetic updates.

The Windows native build and two-game guest-drive test must pass before this is published as an update. The test compares the two car transforms directly (passenger ped coordinates are car-local), checks both cars travel, confirms the host receives driver visuals, and records FPS during the drive. Same-PC results do not establish smooth internet driving, cross-NAT connectivity, or pixel-perfect 1:1 game synchronization.

ViceTogether remains an experimental prototype. Each player must import their own legally obtained Vice City installation; no game files are included.

---

# ViceTogether alpha.22 — centered player labels

Player names and their health lines now use one measured center point, with the text drawn left-aligned at that calculated position. This corrects the offset visible in the two-window screenshot while keeping the label background transparent.

The screenshot's player-to-player screen gap is nearly the same in both views. Each view follows a different player, so character size and scenery perspective still differ. In the alpha.21 same-PC native run, source-to-remote position error was about 0.10 m p95; that does not test internet paths.

---

# ViceTogether alpha.21 — player labels and nearby vehicle blast

The floating player label is now transparent, and multiplayer snapshot validation no longer drops vehicle updates when an older engine includes unsupported civilian peds in the same frame. The Ctrl+I menu adds a **Nearby Big Bang (35 m)** action for either player; the host checks the guest's recent living position and performs the blast in the authoritative game world.

The two-client same-PC test from alpha.20 measured remote player positions within 0.08–0.14 m p95 of the source snapshots. The screenshot's screen-space gap varies because each game camera follows a different player; this is not a calibrated distance comparison. That run used the prior native binary, so it does not verify the new name rendering or nearby blast in-game. This remains an experimental prototype; cross-internet play, NPC AI, vehicles, and combat are not fully synchronized. Each player supplies their own legally obtained game files.

The complete automated JS suite passes (64 tests). The Windows CI build must compile the updated native engine before the installer is published.

---

# ViceTogether alpha.20 — startup repair

Fixes a packaging mistake in alpha.19 that made the launcher fail at startup for everyone. The installer now includes the vehicle-spawn validator required by the native launcher, and a regression test checks that native launcher engine dependencies stay in the packaged-file allowlist.

**If alpha.19 is installed and shows “Cannot find module '../engine/vehicle-spawn.cjs', download and run the alpha.20 installer below.** That crash happens before automatic updates can start. Your launcher settings and imported game files are stored outside the application folder and are not bundled into the installer.

The alpha.19 police-only synchronization changes are included. Police behavior still needs live two-player gameplay verification.

---

# ViceTogether alpha.19 — experimental

This update narrows shared ambient-pedestrian replication to police only. Civilians stay local and are rejected by the shared-world validator. Police state remains host-authoritative; full guest-targeted police AI and pursuits are still experimental and have not been verified in a live two-game session. It also fixes a native linker error in the shared Come Fly With Me toggle.

- The existing police nearby the host are included in world snapshots; short snapshot gaps retain police replicas for up to two seconds.
- A guest's wanted level continues through the existing shared wanted-level path, so the host's police simulation sees the session's highest wanted level. This does not yet make police select and pursue each remote player independently.
- The Windows native build and installer must pass CI before this update is released. No game windows were launched for this update.
- Alpha.18 changes are included: guest vehicle requests, rejoin-last-lobby, smoothed ping display, and the shared Come Fly With Me on/off state.

Police replication is still a prototype, not perfect 1:1 AI synchronization. Each player must supply their own legally obtained Vice City files; the launcher includes no game assets.

---

## Previous update: alpha.18

This update builds on alpha.17's host-authoritative guest vehicle requests, helicopter/plane replication, and rejoin control. It stabilizes the displayed ping, reduces brief pop-out of shared vehicles and police, and makes Come Fly With Me a shared on/off toggle.

- The ping shown in the HUD uses the median of recent direct game-channel probes instead of the most recent spike; it reports measured route latency and does not reduce the ISP path's physical delay.
- Vehicles and existing police replicas are retained for up to two seconds after a complete world snapshot omits them. This absorbs brief snapshot gaps; it cannot preserve actors after the host engine streams them out.
- Host and guest Come Fly With Me inputs toggle one host-owned flag. All clients see its current on/off state and matching help message. Other cheat effects remain local until individually synchronized.
- Guests can request an allow-listed car, bike, boat, helicopter, or plane; the host creates the shared vehicle near the guest. Helicopter and plane classes are included in world frames.
- A guest who leaves can choose **Rejoin last lobby** while the host's original room remains open. A closed host room still needs a new invitation.
- Vehicle spawning, aircraft visibility and rejoin remain experimental and were not re-run in the native game this turn.

This remains experimental and the game windows were not launched for this update. Passenger pose/audio, rotor and flight control behavior, police AI, general NPC synchronization, and full damage synchronization remain unfinished. The launcher installer contains no Vice City game assets; each player imports their own legally obtained copy.

---

## Previous release: alpha.16

This update makes the weapon-cheat menu available to both players in a multiplayer session.

- Ctrl+I opens a player-facing Cheats menu for both the host and guests. Guests can open the weapon-pack submenu and activate the original game's weapon cheats.
- The host still has the shared-world controls for time, weather, vehicle spawning and cleanup. Those controls stay host-authoritative so guests cannot change only their local copy of the shared world.
- Ctrl+O and its existing weapon and vehicle menus remain available as before.

This is a menu access change; it does not add new cheat effects or make every world change multiplayer-synchronized.

## Build notes

The Windows installer contains the updated native engine and does not include Vice City assets. Each player needs their own legally obtained game files.

---

## Previous release: alpha.15

This update improves guest interaction with host-owned NPCs and reduces empty-world gaps when players are apart.

- The host gives recently hit NPCs priority in the next shared snapshot so their health and reaction state are less likely to disappear when the snapshot reaches its NPC limit.
- The host selects nearby entities around each connected player, with a 350 m capture radius, a maximum of 48 pedestrians and 32 vehicles per world frame.
- Guests keep local Vice City pedestrians and traffic outside the 110 m shared-population overlap instead of deleting ambient actors throughout the host's full capture radius.
- Guest melee requests are validated and applied by the host. Host-validated guest gun hits trigger the NPC's attack reaction and return the resulting state. Guest hits on pedestrians raise the guest's wanted level, which uses the existing shared wanted-level path.
- Lobby reset clears NPC hit history and priority state to avoid stale entity handles after reconnecting.

## Verified on one PC

Two hidden native game instances using the tester's own Vice City installation verified melee damage reaching the guest snapshot (100 to 89.6 health), a guest gun hit reaching the host and guest snapshots (100 to 67.5), and local guest population still enabled when players were 658 m apart. The melee run measured about 143 FPS on both instances at the 144 FPS setting. Unit tests pass.

These checks use two processes on the same PC. They do not verify public internet or cross-NAT connectivity, or demonstrate identical NPC populations at distant locations. A guest far from the host gets its own local ambient population; those distant NPCs are not yet shared as the same entities. Full NPC AI ownership and police pursuit behavior remain unfinished. Fifteen game modes are deferred. This release is an experimental prototype, not a finished 1:1 multiplayer conversion.

The installer and portable build contain the launcher and native engine only. Each player must import their own legally obtained GTA Vice City installation. No original game files are included.
