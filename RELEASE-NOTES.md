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
