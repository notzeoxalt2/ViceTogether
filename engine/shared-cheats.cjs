const SHARED_CHEATS = Object.freeze([1, 2]);
const ALLOWED = new Set(SHARED_CHEATS);

function acceptSharedCheatToggle(peerId, cheatId, { players, states, cooldowns, now = performance.now(), cooldownMs = 1000 } = {}) {
  if (typeof peerId !== 'string' || !players?.has(peerId) || !ALLOWED.has(cheatId)) return false;
  const previous = cooldowns?.get(peerId) ?? -Infinity;
  if (!Number.isFinite(now) || now - previous < cooldownMs) return false;
  let position;
  if (cheatId === 2) {
    const sample=states?.get(peerId),state=sample?.state;
    if(!Array.isArray(state)||state.length<10||!Number.isFinite(sample.time)||now-sample.time>1500||state.some(value=>!Number.isFinite(value))||state[8]<=0||Math.abs(state[0])>=10000||Math.abs(state[1])>=10000||Math.abs(state[2])>=3000)return false;
    position=state.slice(0,3);
  }
  cooldowns?.set(peerId, now);
  return { cheatId, ...(position?{position}:{}) };
}

module.exports = { SHARED_CHEATS, acceptSharedCheatToggle };
