# Hydra reference and Rust migration

Reference: https://github.com/hydralauncher/hydra, inspected 10 October 2026.

Hydra's current README describes Electron/React/TypeScript for its launcher and Rust native components, including a libtorrent wrapper. Its package manifest lists Electron and React; it is not a fully Rust-rendered launcher. Its repository licence is MIT, copyright 2024 Los Broxas. No Hydra code or artwork has been copied into this implementation. Preserve its applicable licence and attribution if code is reused later.

Useful product patterns: a unified library, a rich game catalogue, game-specific detail pages, management of installed games, and a consistent navigation shell. ViceTogether's scope remains our own multiplayer mods, initially Vice City. Displaying a game does not add multiplayer support to its engine.

Rust preview: `src-tauri` uses Tauri 2 with the system WebView2 on Windows and shares the existing lightweight HTML/CSS/JavaScript interface. Native Rust commands handle settings, game-file import and checksums, repair, short invitation codes and singleplayer launch. The existing Electron implementation remains the working native multiplayer prototype until its UDP bridge, process lifecycle, deep links and update flow have been migrated and tested.

The Rust preview disables multiplayer game launch and labels that limitation. It is not a replacement release yet. A WebView2 dependency remains; the installer configuration checks for it and can download its bootstrapper. Offline installation requires a separate tested runtime packaging strategy. A smaller Rust executable does not establish lower total RAM: measure the launcher plus every WebView2 child process in equivalent idle and lobby sessions.

Primary sources:
- https://github.com/hydralauncher/hydra
- https://raw.githubusercontent.com/hydralauncher/hydra/main/package.json
- https://raw.githubusercontent.com/hydralauncher/hydra/main/LICENSE
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/windows-installer/

Development build: `cargo build --manifest-path src-tauri/Cargo.toml`. End users will receive packaged builds and will not need Cargo, Node or a terminal. The developer-only `VT_RUST_LIBRARY` environment variable can point verification at an existing authorised cache; it is not a user setup requirement.
