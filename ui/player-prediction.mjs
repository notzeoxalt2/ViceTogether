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
  const positionVelocity = [dx / intervalMs * 1000, dy / intervalMs * 1000];
  // reVC exposes ped velocity in its 50 Hz timestep units. Blend that
  // instantaneous engine velocity with the sender-timed position slope: the
  // former responds cleanly to turns/acceleration, while the latter damps
  // frame-to-frame physics noise.
  const engineVelocity = [state[4] * 50, state[5] * 50];
  const engineSpeed = Math.hypot(...engineVelocity);
  const positionSpeed = Math.hypot(...positionVelocity);
  const useEngineVelocity = Number.isFinite(engineSpeed) && engineSpeed >= 0.15
    && engineSpeed <= maxSpeedMetresPerSecond;
  const velocity = useEngineVelocity
    ? positionVelocity.map((component, index) => (component + engineVelocity[index]) * 0.5)
    : positionVelocity;
  const speed = Math.hypot(...velocity);
  // Do not extrapolate stationary noise or a discontinuity/teleport.
  if (!Number.isFinite(positionSpeed) || positionSpeed < 0.15
    || !Number.isFinite(speed) || speed < 0.15 || speed > maxSpeedMetresPerSecond) return copy;

  const horizonMs = Math.max(0, Math.min(maxHorizonMs, ageMs + Math.max(0, routeLeadMs)));
  copy[0] += velocity[0] * horizonMs / 1000;
  copy[1] += velocity[1] * horizonMs / 1000;
  return copy;
}
