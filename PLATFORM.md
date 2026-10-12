# Multi-game launcher direction

ViceTogether will host our own multiplayer integrations, beginning with Vice City. It is not a universal multiplayer patch. Each added game needs an engine integration that handles its players, physics, vehicles, combat and world state.

Implemented foundation: the reviewed integration registry in `src/games.cjs` owns engine creation, executable resolution, asset-store creation, installation detection and catalogue metadata. The launcher uses the Vice City integration and presents it in a searchable Library page. Only Vice City is supported, and its multiplayer status remains experimental. Existing asset caches, saves and invitation links retain their current paths and format.

The initial registry is bundled with the application. There is no downloaded plug-in execution, remotely editable support catalogue, or installed second game. These require further design and testing. The current room protocol and gameplay network are still Vice City specific.

Next platform work: isolate per-game saves/assets/preferences; include game identity and compatible integration version in invitations and lobby handshakes; separate common room membership from game-specific packets; add a second genuinely working integration; then distribute tested Windows builds through GitHub Releases. Sessions remain per game. Games with different engines cannot play in the same world just because they use one launcher.

GitHub will hold launcher/mod source, issue tracking, release notes and downloadable launcher builds. Game assets stay out of the public repository and public release packages. A release workflow must account for upstream engine licensing before publication. No repository, update feed or new release has been published by this change. Public update delivery requires a chosen repository and configured, verified release metadata.

Planned interface additions: game-specific lobby and mode selection, friends and recent sessions, downloads and repair progress, update history, and host controls. Only implemented and tested capabilities should appear as available actions. The 15 Vice City modes remain planned until their rules, spawning, combat and win conditions work.
