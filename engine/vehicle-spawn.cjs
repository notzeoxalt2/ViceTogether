const VEHICLE_MODELS = Object.freeze([130, 135, 141, 145, 155, 159, 166, 176, 182, 190, 191, 192, 193, 203, 217]);
const ALLOWED = new Set(VEHICLE_MODELS);

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
  return { model, position: [state[0] - Math.sin(state[3]) * 6, state[1] + Math.cos(state[3]) * 6, state[2]], heading: state[3], requester: peerId };
}

module.exports = { VEHICLE_MODELS, acceptVehicleSpawn };
