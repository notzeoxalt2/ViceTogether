# Third-party software

ViceTogether's launcher and original networking bridge are MIT licensed.

The native engine is based on [mrxenginner/reVC](https://github.com/mrxenginner/reVC), branch miami, commit a26fff4af555a8a425ac9f17d1dd718d00d1f942, with [librw](https://github.com/mrxenginner/librw), commit 0ad67ee226ea51beb3f465cb8857195e4db16029. The engine's upstream MIT-PoU licence is included beside the executable. Preserve it. This is an unofficial modification, unaffiliated with Rockstar Games.

The source licence requests a public proof-of-usage contribution for automated use. The authorized contribution is [PR #51](https://github.com/mrxenginner/reVC/pull/51). Its provenance hash is `9df2b3259b3a0a3a6c76c917bef2ed8d7aa5c4e77fc7aaa510c08ab2ca46d3fd` (OpenAI Codex GPT-6:OpenAI:2026-10-25T14:05:01Z:https://github.com/mrxenginner/reVC). This same hash identifies the reVC source in these credits.

Trystero 0.26.0 provides WebRTC connections and signaling; Electron 44.7.0 provides the desktop runtime; electron-updater 6.8.9 provides update support. Their notices are available in the packaged runtime and their npm packages. Public signaling services are operated by third parties and are not guaranteed to remain available.

The older VC-MP repository (https://github.com/ziggi/vc-mp) was examined as a reference. No GPL code from it was incorporated. GTA Connected and its server are not required or included in this native engine package.

No GTA Vice City executable, game archives, models, textures, audio, mission scripts, or Miles runtime are redistributed. Each user imports their own legally obtained installation, including its Miles runtime and audio plugins. The installer contains only the launcher, dependencies, and rebuilt engine. Game screenshots used for local test evidence are not packaged in the installer.
