// Independent interpolation logic. Interpolate wrapped headings along the shortest arc.
export function validState(value) {
  return Array.isArray(value) && [10,20,34].includes(value.length) && value.every(Number.isFinite)
    && (value.length === 10 || (value.length===34?[10,15,20,25]:[10,15]).every(i => value[i] >= 0 && value[i] <= 1000 && value[i+1] >= 0 && value[i+1] <= 1000 && value[i+2] >= 0 && value[i+2] <= 1000 && value[i+3] >= 0 && value[i+3] <= 10 && value[i+4] >= 0 && value[i+4] <= 1.01))
    && (value.length!==34 || ([0,1].includes(value[30]) && Math.abs(value[31])<100 && Math.abs(value[32])<4 && [0,1].includes(value[33])))
    && Math.abs(value[0]) < 10000 && Math.abs(value[1]) < 10000 && Math.abs(value[2]) < 3000
    && value[7] >= 0 && value[7] <= 5 && value[8] >= 0 && value[8] <= 1000 && (value[9] === 0 || value[9] === 1);
}
export class SnapshotBuffer {
  constructor() { this.frames = []; }
  push(state, time) {
    if (!validState(state) || !Number.isFinite(time) || time <= (this.frames.at(-1)?.time ?? -Infinity)) return false;
    this.frames.push({ state: [...state], time });
    if (this.frames.length > 40) this.frames.shift();
    return true;
  }
  sample(time) {
    if (!this.frames.length) return null;
    while (this.frames.length > 2 && this.frames[1].time <= time) this.frames.shift();
    const [a, b] = this.frames;
    if (!b || time <= a.time) return [...a.state];
    const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    const result = [...b.state];
    const distance = Math.hypot(b.state[0] - a.state[0], b.state[1] - a.state[1], b.state[2] - a.state[2]);
    if (distance > 25) return [...b.state]; // Teleports/respawns are never smeared across the map.
    for (let i = 0; i < 3; i++) result[i] = a.state[i] + (b.state[i] - a.state[i]) * t;
    const delta = Math.atan2(Math.sin(b.state[3] - a.state[3]), Math.cos(b.state[3] - a.state[3]));
    result[3] = a.state[3] + delta * t;
    return result;
  }
}
