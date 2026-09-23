// Pure, testable snapshot pipeline. No engine objects or wall clocks on the wire.
export const NETWORK = Object.freeze({
  rate: 20,
  delay: 100,
  prediction: 150,
  heartbeat: 500,
  snap: 35,
  maxBuffer: 32,
});
const finite = (x, max) =>
  typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= max;
export function validState(s, playerId, raceId) {
  return (
    !!s &&
    s.type === "player_state" &&
    s.playerId === playerId &&
    s.raceId === raceId &&
    Number.isSafeInteger(s.sequence) &&
    s.sequence >= 0 &&
    finite(s.timestamp, 1e15) &&
    s.timestamp >= 0 &&
    ["x", "y", "z"].every((k) => finite(s[k], 100000)) &&
    ["vx", "vy", "vz", "speed"].every((k) => finite(s[k], 1000)) &&
    ["yaw", "pitch", "roll"].every((k) => finite(s[k], 1e7)) &&
    finite(s.steer, 1) &&
    ["braking", "accelerating", "drifting", "boosting"].every(
      (k) => typeof s[k] === "boolean",
    ) &&
    (s.kart == null ||
      (typeof s.kart === "object" &&
        ["shield", "boost", "turbo", "magnet"].every(
          (k) => finite(s.kart[k], 60) && s.kart[k] >= 0,
        ))) &&
    Number.isInteger(s.lap) &&
    s.lap >= 0 &&
    s.lap <= 3 &&
    Number.isInteger(s.checkpoint) &&
    s.checkpoint >= 1 &&
    s.checkpoint <= 12 &&
    finite(s.progress, 3.1) &&
    s.progress >= 0 &&
    (s.finishTime === null ||
      (finite(s.finishTime, 86400) && s.finishTime >= 0))
  );
}
export const angleLerp = (a, b, t) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const SNAPSHOT_FIELDS = [
  "sequence",
  "timestamp",
  "x",
  "y",
  "z",
  "vx",
  "vy",
  "vz",
  "speed",
  "yaw",
  "pitch",
  "roll",
  "steer",
  "braking",
  "accelerating",
  "drifting",
  "boosting",
  "lap",
  "checkpoint",
  "progress",
  "finishTime",
];
export class SnapshotBuffer {
  constructor(config = NETWORK) {
    this.config = config;
    this.states = [];
    this.sequence = -1;
    this.timestamp = -1;
    this.offset = null;
    this.lastReceived = -Infinity;
    this.dropped = 0;
    this.mode = "waiting";
  }
  push(state, receivedAt) {
    if (state.sequence <= this.sequence || state.timestamp < this.timestamp) {
      this.dropped++;
      return false;
    }
    // Map the sender's monotonic clock onto ours. Minimum transit estimate
    // avoids turning a delayed packet into the new "present". Slowly adapt.
    const offset = receivedAt - state.timestamp;
    this.offset =
      this.offset === null ? offset : Math.min(offset, this.offset + 0.1);
    this.sequence = state.sequence;
    this.timestamp = state.timestamp;
    this.lastReceived = receivedAt;
    // Do not retain arbitrary payload properties/event journals in 32 snapshots
    // per peer, or pass untrusted __proto__ properties through Object.assign.
    const snapshot = {};
    for (const key of SNAPSHOT_FIELDS) snapshot[key] = state[key];
    this.states.push(snapshot);
    if (this.states.length > this.config.maxBuffer) this.states.shift();
    return true;
  }
  sample(now, out = {}) {
    if (!this.states.length) return null;
    const time = now - this.offset - this.config.delay;
    while (this.states.length > 2 && this.states[1].timestamp <= time)
      this.states.shift();
    const a = this.states[0],
      b = this.states[1];
    if (b && time < b.timestamp) {
      const t = Math.max(
        0,
        Math.min(
          1,
          (time - a.timestamp) / Math.max(1, b.timestamp - a.timestamp),
        ),
      );
      Object.assign(out, t < 0.5 ? a : b);
      for (const k of ["x", "y", "z", "vx", "vy", "vz", "speed", "steer"])
        out[k] = a[k] + (b[k] - a[k]) * t;
      for (const k of ["yaw", "pitch", "roll"])
        out[k] = angleLerp(a[k], b[k], t);
      this.mode = "interpolating";
    } else {
      const last = this.states.at(-1);
      Object.assign(out, last);
      const elapsed = Math.max(0, time - last.timestamp);
      const dt = Math.min(this.config.prediction, elapsed) / 1000;
      out.x += last.vx * dt;
      out.y += last.vy * dt;
      out.z += last.vz * dt;
      this.mode = elapsed > this.config.prediction ? "stale" : "predicting";
    }
    return out;
  }
  clear() {
    this.states.length = 0;
  }
}
export function meaningfulChange(a, b) {
  if (!a) return true;
  return (
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.025 ||
    Math.abs(angleLerp(a.yaw, b.yaw, 1) - a.yaw) > 0.003 ||
    ["pitch", "roll"].some((k) => Math.abs(a[k] - b[k]) > 0.003) ||
    ["vx", "vy", "vz"].some((k) => Math.abs(a[k] - b[k]) > 0.05) ||
    Math.abs(a.steer - b.steer) > 0.01 ||
    [
      "braking",
      "accelerating",
      "drifting",
      "boosting",
      "lap",
      "checkpoint",
      "finishTime",
    ].some((k) => a[k] !== b[k])
  );
}
