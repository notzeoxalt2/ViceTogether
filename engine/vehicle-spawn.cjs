const VEHICLE_MODELS = Object.freeze([130, 135, 141, 145, 155, 159, 166, 176, 182, 190, 191, 192, 193, 203, 217]);
// Native class after handling flags are considered. Hunter (155) is a heli and
// Skimmer (190) is a plane even though default.ide labels their base models car/boat.
const VEHICLE_CLASSES = Object.freeze({
  130: 'car', 135: 'car', 141: 'car', 145: 'car', 155: 'helicopter', 159: 'car',
  166: 'bike', 176: 'boat', 182: 'boat', 190: 'plane', 191: 'bike', 192: 'bike',
  193: 'bike', 203: 'boat', 217: 'helicopter',
});
const ALLOWED = new Set(VEHICLE_MODELS);
const SPAWN_CLEARANCE = Object.freeze({
  155: 18,
  176: 10,
  182: 10,
  190: 10,
  203: 10,
  217: 24,
});

function vehicleSpawnClearance(model) {
  return SPAWN_CLEARANCE[model] ?? 8;
}

function acceptVehicleSpawn(peerId, model, { players, states, cooldowns, now = performance.now(), cooldownMs = 5000 } = {}) {
  if (typeof peerId !== 'string' || !players?.has(peerId) || !ALLOWED.has(model)) return null;
  const sample = states?.get(peerId);
  if (!sample || !Array.isArray(sample.state) || sample.state.length < 10 || !Number.isFinite(sample.time) || now - sample.time > 1500) return null;
  const state = sample.state;
  if (state.some(value => !Number.isFinite(value)) || state[8] <= 0 || state[9] !== 0 || Math.abs(state[3]) > Math.PI * 2) return null;
  if (Math.abs(state[0]) >= 10000 || Math.abs(state[1]) >= 10000 || Math.abs(state[2]) >= 3000) return null;
  const previous = cooldowns?.get(peerId) ?? -Infinity;
  if (now - previous < cooldownMs) return null;
  cooldowns?.set(peerId, now);
  const clearance = vehicleSpawnClearance(model);
  return { model, position: [state[0] - Math.sin(state[3]) * clearance, state[1] + Math.cos(state[3]) * clearance, state[2]], heading: state[3], requester: peerId };
}

module.exports = { VEHICLE_MODELS, VEHICLE_CLASSES, vehicleSpawnClearance, acceptVehicleSpawn };
