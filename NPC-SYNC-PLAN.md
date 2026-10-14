# Shared-peer NPC simulation plan

This replaces the earlier host-owned NPC plan. NPC simulation is distributed between players. The session host does not run every NPC. Each NPC or linked group has exactly one simulation owner at a time, which can be either player; other peers reproduce that owner's confirmed state. Independent AI for the same NPC on two machines would produce different targets, collisions and deaths.

The current implementation still uses host-owned nearby replicas. This document is a proposed architecture, not a claim that distributed simulation is already implemented or perfectly synchronized.

## 1. Prove a small distributed session

Start with two players, one street and a small civilian group. Assign simulation by region, based on nearby players, with hysteresis so ownership does not oscillate as players cross a boundary. Overlapping areas share NPC identities. Separate areas are simulated by the nearby player, rather than by a distant host.

Keep a session coordinator for membership and ownership leases; coordination does not mean running everyone's NPC AI. Each lease includes session epoch, entity/group ID, owner, ownership term and expiry. Receivers accept state only from the current owner. During a partition or expired lease, freeze unconfirmed remote actors rather than letting both sides invent outcomes. Automatic coordinator migration is separate work and must be tested before claiming host departure is seamless.

NPC occupants and their vehicle should share one simulation owner. Mission-linked actors may require grouping. Ownership is authority over simulation, not a gameplay advantage: either player can attack, approach or be chased by any NPC.

Acceptance: each player's PC simulates its assigned group; both views show the same actors; the same NPC never has two active owners.

## 2. Transfer ownership without losing the actor

Use stable session-scoped identities and spawn generations instead of local memory addresses. Transfer position, velocity, health, inventory, vehicle seats, task/AI state, target identity, animation phase, injury state and relevant timers. Resolve entity references through network IDs.

The old owner sends a checkpoint; the new owner loads required models/collision, acknowledges readiness and starts after the coordinator confirms a new term. The old owner then becomes a replica. Preserve the last confirmed checkpoint through disconnects. Initially pin an active fight/chase to its owner to avoid unsafe handoffs; add full task serialization incrementally. Do not pretend copying coordinates transfers the stock AI state.

Acceptance: walk between regions, transfer an NPC during a chase, reconnect and force an owner timeout. Verify no duplicate actor, health reset, corpse revival or double-applied damage.

## 3. Make AI recognize both players safely

Vice City's native player configuration is single-player. Police code repeatedly uses FindPlayerPed and its wanted state, while multiplayer proxies currently use CPed. Relabeling those proxies as CPlayerPed would make existing casts unsafe.

Create a multiplayer target registry on every simulation owner: actor reference, player ID, position, vehicle, alive state, weapon/noise and confirmed threat/wanted state. Hook civilian, gang and police target selection to consider all eligible multiplayer players. Keep local camera and controls attached to the actual local player; do not globally replace FindPlayerPed.

Both players send interaction intents to the NPC's current owner. That owner validates range, weapon, timing and recent positions, applies the original engine response and broadcasts the outcome. Reactions include noticing, fleeing, cowering, punching back, shooting and police pursuit. Crimes must be attributed to the correct player, not automatically to the lobby host.

Acceptance: repeat approaching, threatening, punching, shooting and vehicle collisions from both players. NPCs retaliate against the actual attacker and can damage either player. Police pursue the correct offender, including in a guest-owned region.

## 4. Fix fist fights and visible damage reactions

Current combat can update shared health without reproducing the corresponding victim reaction. A confirmed hit must include attack ID, attacker, victim, hit time, weapon/fight move, impact direction/body part, damage, health revision and reaction outcome.

For player victims, apply the confirmed reaction to the victim's actual local player and replicate its resulting pose. For NPC victims, run the reaction on the NPC owner. Preserve stock stagger, hit, knockdown, recovery and death behaviors. Avoid fake camera shakes or animated labels as substitutes. Deduplicate effects so the same hit cannot damage twice or restart a fall repeatedly. Injury/death revisions override older walk/run snapshots.

Acceptance: host punches guest, guest punches host, both punch NPCs and simultaneous attacks occur. Both screens show the corresponding hit/fall/recovery, health changes once, and movement controls recover correctly. Test melee accuracy separately at low latency, 150 ms and with packet loss.

## 5. Make deaths and drops shared world objects

The NPC owner commits one death event with a unique ID. It records the corpse pose, death position, injury flags and chosen drops once. Assign every money/weapon pickup a stable ID, item/ammunition value, position, lifetime and claim state. Other peers create replicas of that same drop; they must not roll different loot independently.

Claim requests go to the current item/group owner. The first valid claim commits consumption and inventory changes; all peers remove the pickup. Ownership transfer and late-join snapshots include corpses and unclaimed pickups. Retain tombstones so delayed packets cannot recreate consumed items or revive NPCs. Bounded retention prevents unlimited corpse accumulation.

Acceptance: either player kills an NPC, both see its death animation/corpse/drop, either can collect it, simultaneous pickup attempts grant it once, and rejoining restores the remaining objects correctly.

## 6. Keep population alive around each player

Use the union of active player areas, not just the host's surroundings or the midpoint. Each owner runs stock population and traffic in assigned loaded regions. Reserve ped/vehicle slots, stream required models/collision and bound population per area; the existing engine has a 140-ped pool. Do not multiply the current 48-NPC allowance by eight players without checking pool capacity and CPU.

Nearby actors get frequent movement/pose updates; distant actors get lower-rate state and reliable lifecycle changes. Start by measuring roughly 10-20 Hz nearby snapshots and tune interpolation from actual results. Overlapping regions reuse actors, and region handoffs preserve identities. Changes to streaming/population generation are required; downloading models alone does not create a living distant neighborhood.

Guest menu spawning sends a rate-limited request to the region's simulation owner, which creates a shared vehicle and confirms it. Everyone can use permitted gameplay categories. Global administrative powers require separate permissions.

Acceptance: separate across the map, interact with local NPCs, then meet and see the same actors without duplicates or mass despawns. Measure frame times, pool usage and bandwidth for two players before scaling to four and eight.

## 7. Reliable lobby and rejoin baseline

Instrument discovery, WebRTC handshake, authenticated membership, engine readiness and world baseline separately. Investigate the reported five-minute wait using these timings and relay diagnostics; show progress and bounded retry rather than silent waiting. Signaling and NAT problems are separate from NPC synchronization. No TURN fallback is currently configured.

On joining/rejoining, request checkpoints from active owners plus the ownership directory, corpses and pickups at a defined revision. Buffer newer events until the baseline is applied. Clear old native sequence gates, interpolation histories and references. Start gameplay when the relevant area is ready, using one local engine. Prevent an old peer/session from applying snapshots after a newer join.

Acceptance: late join, rejoin the same session, join another session with lower sequence numbers, owner disconnect and reconnect while seated. Run actual engine tests and two-network tests, not only launcher stubs.

## Execution order and release gates

1. Connection-stage diagnostics and native rejoin reset.
2. Two-peer ownership directory, leases and one small NPC group.
3. Correct player/NPC fist-fight reactions and deduplicated damage.
4. NPC injury/death animations, shared corpses and pickup claims.
5. Ownership handoff, AI targeting and police attribution.
6. Multi-region population/streaming and guest tools.
7. Loss/latency tests, late joins and four/eight-player stress tests.

Each checkpoint ships only after its acceptance tests pass. Preserve gameplay outcomes and actor identity; exact simultaneous rendering cannot be guaranteed across a delayed network. A 1:1 experience is the target, not a promise of identical particle randomness, zero delay or perfectly deterministic stock physics.