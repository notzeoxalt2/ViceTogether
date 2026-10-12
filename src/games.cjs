const path = require('node:path');
const { NativeEngine } = require('./native-engine.cjs');
const { AssetStore, detectGames } = require('./assets.cjs');

// Only integrations shipped and reviewed with the launcher can run code.
// Downloaded catalogue entries and invitation fields never become executable paths.
const viceCity = Object.freeze({
  metadata: Object.freeze({
    id: 'vice-city', title: 'Grand Theft Auto: Vice City', mod: 'ViceTogether',
    status: 'Experimental', description: 'Private sessions in 1986 Vice City.',
    minimumPlayers: 2, maximumPlayers: 8, singleplayer: true,
    multiplayer: 'prototype', assetSetup: 'Import your original PC game once',
    transport: 'WebRTC',
  }),
  executable({ packaged, resourcesPath, sourceRoot }) {
    return packaged ? path.join(resourcesPath, 'native/reVC.exe') : path.join(sourceRoot, 'engine/native/reVC.exe');
  },
  createEngine(executable) { return new NativeEngine(executable); },
  createAssetStore(root, progress) { return new AssetStore(root, progress); },
  detectInstallations: detectGames,
});
const integrations = new Map([[viceCity.metadata.id, viceCity]]);
function getGameIntegration(id) {
  const game = integrations.get(id);
  if (!game) throw new Error('This game does not have a supported multiplayer integration yet.');
  return game;
}
function listGames() { return [...integrations.values()].map(game => ({ ...game.metadata })); }
module.exports = { getGameIntegration, listGames };
