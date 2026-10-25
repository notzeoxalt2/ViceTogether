# ViceTogether alpha.16 — experimental

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
