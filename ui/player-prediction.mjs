// Bounded display-only extrapolation for on-foot peers. The authoritative
// state stored by the lobby remains untouched for hit and seat validation.
export function projectPlayerState(sample, now, routeLeadMs, {
  maxHorizonMs = 220,
  maxAgeMs = 250,
  maxSpeedMetresPerSecond = 12,
} = {}) {
  const state = sample?.state;
  const copy = Array.isArray(state) ? [...state] : state;
  if (!Array.isArray(state) || !Number.isFinite(now) || !Number.isFinite(routeLeadMs)
    || state.length < 10 || !state.every(Number.isFinite)
    || state[9] !== 0 || state[7] <= 0
    || !Number.isFinite(sample.time)) return copy;

  const ageMs = now - sample.time;
  if (ageMs < 0 || ageMs > maxAgeMs) return copy;
  const previous = sample.previousState;
  const sourceIntervalMs = sample.sourceTime - sample.previousSourceTime;
  const receiveIntervalMs = sample.time - sample.previousTime;
  const intervalMs = Number.isFinite(sourceIntervalMs) && sourceIntervalMs >= 8 && sourceIntervalMs <= 250
    ? sourceIntervalMs : receiveIntervalMs;
  if (!Array.isArray(previous) || previous.length < 10 || !previous.every(Number.isFinite)
    || previous[9] !== 0 || previous[7] <= 0
    || !Number.isFinite(intervalMs) || intervalMs < 8 || intervalMs > 250) return copy;

  const dx = state[0] - previous[0];
  const dy = state[1] - previous[1];
  const speed = Math.hypot(dx, dy) / intervalMs * 1000;
  // Do not extrapolate stationary noise or a discontinuity/teleport.
  if (!Number.isFinite(speed) || speed < 0.15 || speed > maxSpeedMetresPerSecond) return copy;

  const horizonMs = Math.max(0, Math.min(maxHorizonMs, ageMs + Math.max(0, routeLeadMs)));
  copy[0] += dx / intervalMs * horizonMs;
  copy[1] += dy / intervalMs * horizonMs;
  return copy;
}
