const SHARED_CHEATS = Object.freeze([1]);
const ALLOWED = new Set(SHARED_CHEATS);

function acceptSharedCheatToggle(peerId, cheatId, { players, cooldowns, now = performance.now(), cooldownMs = 1000 } = {}) {
  if (typeof peerId !== 'string' || !players?.has(peerId) || !ALLOWED.has(cheatId)) return false;
  const previous = cooldowns?.get(peerId) ?? -Infinity;
  if (!Number.isFinite(now) || now - previous < cooldownMs) return false;
  cooldowns?.set(peerId, now);
  return { cheatId };
}

module.exports = { SHARED_CHEATS, acceptSharedCheatToggle };
