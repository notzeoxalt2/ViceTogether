# ViceTogether multiplayer execution plan

## Target

Build a private free-roam session for 2–8 players. Each player runs the native game locally with their own legally obtained Vice City files. The multiplayer layer should preserve the game’s controls, camera, animation, sound, physics, and world behavior wherever the original engine allows it. This is a staged target, not a claim that the current alpha is complete or perfectly synchronized.

## Work sequence

### 1. Join, leave, and recovery

- Show a lobby as connected only after the peer handshake completes.
- Bound retries, explain a failed route, and let either player leave and rejoin without a stale player, seat, or world snapshot.
- Keep invitation handling and room discovery separate from game connection status.
- Verify same-PC sessions first, then different networks. Direct WebRTC is preferred; restrictive NATs can still require a relay, so connectivity is not guaranteed.

**Acceptance:** two clean game processes can join, disconnect, and rejoin the same invite repeatedly without a five-minute ambiguous spinner, duplicate avatars, or stale claims.

### 2. Player movement and presentation

- Keep one owner for each player transform and animation state.
- Interpolate ordinary motion; use bounded correction for genuine large corrections rather than repeatedly snapping positions.
- Preserve jump, fall, aim, weapon, death, and respawn transitions in the state stream.
- Keep names and health bars attached to the remote player’s rendered position.

**Acceptance:** record position error and frame-time under a two-process test, including walking, running, turning, jumping, and reconnecting. A feature is not accepted just because packets arrive.

### 3. Vehicle seat lifecycle

- Use the stock Vice City enter and exit tasks so players walk to doors, play the entry/exit animations, and attach through the engine’s normal seat callbacks.
- Reserve a seat once, retain it while the entry task is active, and release it on every exit, death, disconnect, and failed entry.
- Test cars, bikes, boats, helicopters, aircraft, driver and passenger positions, a moving-car exit, and an occupied seat. A remote passenger must remain attached to the correct vehicle and use the correct pose.

**Current change:** multiplayer seat grants no longer call `WarpPedIntoCar` or edit passenger arrays after the grant. Host and guest seat reservations now release when the local player exits. The automated test guards this regression; a rebuilt native two-game test is still required before calling the visual behavior verified.

### 4. Vehicle ownership and effects

- Define an explicit driver owner for each moving vehicle. Only that peer sends motion; the other peer interpolates the received snapshots and never writes competing physics.
- Add bounded handoff when the driver exits, changes seat, crashes, or disconnects.
- Verify steering, suspension, wheels, doors, damage, fire, explosion, engine state, sirens, rotor/propeller motion, and spatial audio independently. Passenger audio must not create a second radio stream; start with vehicle radio off and add an explicit in-game toggle.
- Keep vehicle replicas briefly when a complete unreliable world snapshot omits them; this hides short packet/interest-set gaps, but cannot recreate an actor the host game has streamed out.

**Acceptance:** both game processes see the same vehicle, occupied seat, and damage state while parked, driving, colliding, stopping, and changing drivers. Visual and audio effects must be checked in the game, not inferred from packet tests.

### 5. NPC, police, and traffic authority

- Do NPC simulation in the native game process. A cloud service cannot create or render Vice City models, run its animation graph, or call its local physics and AI routines.
- Keep the current work scoped to existing police replicas; do not increase ambient NPC counts. Police copied from a host snapshot have no guest-side AI, so shared wanted level does not yet guarantee a shared chase or identical police behavior.
- Give each nearby world region a single simulation owner. That owner sends stable entity IDs, transforms, animation, health, vehicle/seat state, and discrete events such as damage, death, police response, pickup, and vehicle destruction.
- Each player needs a populated local area. For players far apart, peers can own their own nearby regions and replicate those entities to the other peer. Region handoff must avoid duplicate NPCs and conflicting updates.
- Synchronize important events, not every private AI implementation detail. Police must attribute a shared chase to either player who caused it and follow the same suspect/vehicle; unrelated distant wanted levels must stay local. Story missions and arbitrary script state are not automatically co-op just because free-roam actors are synchronized.

Cloudflare Durable Objects can coordinate real-time room state or WebSocket clients, but they would add a cloud path and do not run the local game simulation. Cloudflare TURN is a packet relay for difficult NAT routes; it does not lower the physical route latency and is not enabled because this project requires no possible metered overage. Current peer connectivity can therefore fail on restrictive networks.

**Acceptance:** place the two players in different map regions; each sees local NPCs/traffic, and a tested NPC interaction or police event has one authority and the same result at both clients. Measure the supported radius and actor count rather than describing the whole map as synchronized.

### 6. Combat and world interactions

- Validate guest attacks against recent host-approved transforms and weapon limits.
- Synchronize only explicitly whitelisted toggle cheats through the host. Come Fly With Me is the first global toggle; weapon, health, and other built-in cheats remain local until each effect has its own safe, tested replication rule.
- Synchronize target health, reactions, death animation, drops, and hit effects exactly once.
- Verify punches, each firearm class, bikes, vehicles, glass, explosions, police response, and reconnect after death separately. Preserve normal local health, police/car collision damage, fall and bike rider-ejection rules; do not make players immortal or use a kill cheat to escape a broken seat.

### 7. Release gate

- Rebuild the native engine and launcher in Windows CI.
- Run unit tests and hidden two-engine gameplay tests for the affected feature.
- Exercise the installed update path and a clean Windows first run without showing game windows or taking over the user’s mouse.
- Keep alpha status and unfinished systems visible. Release only the tested change; do not describe the whole multiplayer game as finished while a required scenario still fails.

## Architecture decisions from code research

- Keep the native reVC engine as the game runtime. This project already patches the game loop and entity creation/rendering, which is where native animation, collision, vehicle occupancy, audio, and local AI can be integrated. A browser/WASM wrapper would add another runtime boundary without solving synchronization.
- Keep Trystero/WebRTC for small private peer sessions and invitation signaling. Lobby discovery, session identity, and gameplay transport are separate concerns. Use direct peer paths first; don't add a relay path that can incur charges while the product requirement forbids any possible overage.
- Use a host-authoritative protocol for shared outcomes, not as a single global simulation of every player's city block. Each peer's native game owns its local ambient region. A region lease assigns one peer to publish stable IDs and state for actors inside the shared overlap; crossing the boundary transfers ownership once, with a short handoff epoch to reject old packets. The host arbitrates scarce/shared outcomes such as player damage, a contested vehicle seat, police heat for a shared chase, and pickup claims.
- Treat movement snapshots as replaceable state (sequence, owner epoch, timestamp, transform, velocity, movement/weapon/vehicle mode); use unreliable ordered delivery and interpolation. Treat events (seat grant/release, hit, death, pickup, glass break, explosion, vehicle wreck, wanted-level change) as validated, sequenced, idempotent events with periodic recovery snapshots. Never repeatedly replay an event just because a state snapshot was retransmitted.
- Let each player enter cheat codes and change their own weapons/health locally. Shared-state admin tools are explicit host actions. Player count is always driver plus actual `m_nNumMaxPassengers`; the transmitted vehicle metadata is checked again when the grant reaches the engine.
- Keep UI/install/signaling work separate from game simulation. Cloudflare Durable Objects could coordinate a WebSocket room or directory if we later choose to operate that infrastructure; they cannot run the players' native Vice City AI or render NPCs. TURN is only a route fallback, not a latency optimizer, and remains out under the no-overage decision.

### Public project findings

- [reVC](https://github.com/mrxenginner/reVC) is the engine this project currently builds and patches. Continuing that native integration has the shortest path to matching the existing animation, vehicle, collision, and audio code.
- [VC:CO-OP](https://github.com/gtco-op/vc-coop) is a useful native Vice City multiplayer reference. Its archived README identifies Plugin-SDK and credits librg, but the repository is archived and has no root license declaration; use it as a design reference only unless its authors clarify reuse rights.
- [librg](https://github.com/zpl-c/librg) is BSD-3-Clause and provides generic entity ownership, area-of-interest filtering, and replication over a caller-provided transport. It does not implement a network transport or Vice City behavior. Revisit it if the current custom world replication becomes hard to maintain; adding it now would duplicate a small prototype's existing rules and expand the test surface.
- [VC:MP 0.1c source](https://github.com/ziggi/vc-mp) is old GPL-era client/server code built around legacy RakNet and very old Visual C++ instructions. Its separate player, vehicle, and passenger sync packet types are useful historical protocol examples, but it is not a drop-in reVC or WebRTC engine.
- [GTA Connected](https://gtaconnected.com/) and its [client manual](https://wiki.gtaconnected.com/ClientManual) are useful references for the user-facing client/server flow and stream-distance concepts. Its [GitHub organization](https://github.com/gtaconnected) publishes SDK/default server repositories, not a complete replacement game client that can be integrated here.

## Concrete work backlog and exit criteria

| Stage | Implement | Required test before moving on |
| --- | --- | --- |
| A. Session lifecycle | Fast, bounded connect/retry; remove peers and claims on leave; complete snapshots on rejoin; clear error states | Same-PC two process host/join/leave/rejoin loop, plus one real different-network join when a second tester is available |
| B. On-foot | Owner snapshots; smoothing/prediction with correction limits; actual run/jump/fall/aim/weapon/death animation; name/health tag and minimap icon | Walk, turn, sprint, jump, stop, fight, die and respawn in both windows; report p50/p95 positional error and frame time |
| C. Seats and vehicles | Stock enter/exit tasks; reserve/release; capacity; explicit driver ownership; car/bike/boat/helicopter motion; passenger pose; vehicle audio and discrete damage effects | One/two/three players against one/two/four-seat vehicles; passenger joins and exits a moving car; bikes, boats and aircraft; no stale claim, duplicate occupant or forced re-entry |
| D. Local world population | Per-region native population ownership; stable actor IDs; distance/visibility filters; owner handoff; bounded snapshots and event recovery | Host and guest separated by map regions: each sees local NPCs and traffic; entering overlap causes no duplicate/spawn burst or model squashing |
| E. NPC reactions | Route player-caused AI stimuli to the region owner; replicate reactions, task/animation state, health, death and drops; deduplicate by actor ID and event sequence | Guest punches/shoots NPC, NPC reacts and dies once on both sides, police react to either player, pickup stays consumed after reconnect |
| F. Combat and shared police | Validate remote weapon, origin, time, range and plausible ray/target; apply shared health/reaction once; share wanted/chase association without granting police to a distant unrelated player | Fistfight, each firearm class, moving target, bike shot, NPC/police damage, death, drop, wreck/explosion and disconnect during hit |
| G. Release | Versioned protocol compatibility, installer/portable, auto-update feed, asset import/repair, compact invite/deep link, diagnostics export | Fresh Windows account receives invite, installs, imports owned game assets once, joins, starts a tested scenario, updates without losing cache/saves |

Stages can be parallelized only after their protocol ownership is agreed. A feature is done when the native engine behavior and second client's result are both checked; packet receipt alone is not sufficient. The current repository is at the early part of Stage C: authority-level capacity checks and a stock engine entry task are in place, while the rebuilt-engine visual entry/exit test is still a release blocker.

### Newly reported acceptance checks

- Guest menu vehicle requests go through host validation and create one shared entity near the requesting guest. The native world stream must include helicopter and aircraft vehicle classes; passing a packet test alone is not enough to prove either model renders or flies correctly.
- A guest who leaves can rejoin the same still-open host lobby from the existing Retry/Rejoin control. A host who closes their room must create a new invite.
- Car passenger position/pose and audio must remain attached to the moving car. The driver should be the only player hearing radio by default; passengers should have a simple opt-in radio control.
- Test local player damage separately from shared NPC damage: police, vehicle impacts, bullets, and bike crashes must apply the stock rules once, while local cheat effects remain local.
- The current rebuilt guest-driving run proved that the guest driver could enter and drive, but it failed the host-passenger check. The harness was exposing a stale condition: guest-owned car motion does not set a local native `pDriver` pointer on the host. The test now checks the delegated driver lease instead. This is a harness correction, not a verified passenger fix.

