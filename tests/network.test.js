import test from "node:test";
import assert from "node:assert/strict";
import {
  NETWORK,
  SnapshotBuffer,
  validState,
  meaningfulChange,
  angleLerp,
} from "../src/multiplayer/NetworkState.js";
import { selectionStats, statRows } from "../src/multiplayer/SelectionStats.js";
import { CARS } from "../src/data.js";
import { CHARACTERS, combineStats } from "../src/kart/data.js";
const state = (sequence, timestamp = sequence * 50, extra = {}) => ({
  type: "player_state",
  playerId: "alice",
  raceId: "race",
  sequence,
  timestamp,
  x: timestamp * 0.04,
  y: 0,
  z: 0,
  vx: 40,
  vy: 0,
  vz: 0,
  speed: 40,
  yaw: 0,
  pitch: 0,
  roll: 0,
  steer: 0,
  accelerating: true,
  braking: false,
  drifting: false,
  boosting: false,
  lap: 0,
  checkpoint: 1,
  progress: 0,
  finishTime: null,
  ...extra,
});
test("reject malformed, nonfinite, wrong sender/race and invalid progress packets", () => {
  const good = state(1);
  assert.ok(validState(good, "alice", "race"));
  for (const v of [null, undefined, NaN, Infinity, "2", 1e6])
    assert.equal(validState({ ...good, x: v }, "alice", "race"), false);
  for (const patch of [
    { playerId: "bob" },
    { raceId: "other" },
    { sequence: -1 },
    { sequence: 1.2 },
    { lap: 8 },
    { checkpoint: 0 },
    { finishTime: -1 },
    { drifting: "yes" },
    { vx: 1001 },
  ])
    assert.equal(validState({ ...good, ...patch }, "alice", "race"), false);
});
test("104 followed by 103/102/101 cannot roll back position or progress", () => {
  const b = new SnapshotBuffer();
  assert.ok(b.push({ ...state(104), unexpected: { retained: false } }, 10000));
  assert.equal(b.states[0].unexpected, undefined);
  for (const seq of [103, 102, 101, 104])
    assert.equal(b.push(state(seq), 10050), false);
  assert.equal(b.sequence, 104);
  assert.equal(b.dropped, 4);
  assert.equal(
    b.push(state(105, 100), 10100),
    false,
    "reject timestamp rollback too",
  );
});
test("uses sender time intervals despite arrival jitter, handles clock skew and angle wrapping", () => {
  const b = new SnapshotBuffer();
  b.push(state(0, 10000, { yaw: Math.PI - 0.1 }), 300);
  b.push(state(1, 10050, { yaw: -Math.PI + 0.1 }), 390);
  const p = b.sample(425); // sender time approximately 10025
  assert.ok(Math.abs(p.x - 401) < 0.01);
  assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 0.002);
  assert.ok(Math.abs(angleLerp(3.1, -3.1, 0.5) - Math.PI) < 1e-9);
});
test("prediction is immediate on gaps, bounded at 150ms, and recovers after a disconnect", () => {
  const b = new SnapshotBuffer();
  b.push(state(0), 0);
  b.push(state(1), 50);
  assert.equal(b.sample(200).x, 4);
  const stopped = b.sample(10000).x;
  assert.equal(stopped, 2 + (40 * NETWORK.prediction) / 1000);
  assert.equal(b.sample(15000).x, stopped);
  b.push(state(300), 15000);
  b.push(state(301), 15050);
  assert.ok(b.sample(15150).x > 500);
  assert.ok(b.states.length <= NETWORK.maxBuffer);
});
test("stat views share the real car and combined physics definitions, with no invented stats", () => {
  for (const car of CARS)
    for (const character of CHARACTERS) {
      const s = selectionStats(car.id, character.id, "kart");
      assert.equal(s.car, car);
      assert.deepEqual(s.effective, combineStats(car, character));
      assert.deepEqual(
        statRows(car).map((r) => r.key),
        ["speed", "accel", "handling", "braking", "drift"],
      );
    }
  assert.equal(statRows(CARS[1], CARS[0])[0].difference, 20);
});
test("idle state suppression still notices steering, braking, lap and finish changes", () => {
  const a = state(1);
  assert.equal(meaningfulChange(a, { ...a, sequence: 2 }), false);
  for (const patch of [
    { steer: 0.5 },
    { braking: true },
    { checkpoint: 2 },
    { finishTime: 120 },
  ])
    assert.ok(meaningfulChange(a, { ...a, ...patch }));
});
for (const profile of [
  { name: "excellent", latency: 10, jitter: 2, loss: 0 },
  { name: "moderate", latency: 75, jitter: 25, loss: 0.03 },
  { name: "high", latency: 200, jitter: 50, loss: 0.08 },
  { name: "outage", latency: 100, jitter: 60, loss: 0.05, outage: true },
])
  test(`2–8 racers: deterministic ${profile.name} latency/loss/reordering simulation`, () => {
    let seed = 17;
    const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let count = 2; count <= 8; count++) {
      const peers = Array.from(
        { length: count - 1 },
        () => new SnapshotBuffer(),
      );
      const queue = [];
      for (let time = 0; time < 10000; time += 50)
        for (let id = 0; id < peers.length; id++) {
          if (
            random() < profile.loss ||
            (profile.outage && time >= 4000 && time < 6000)
          )
            continue;
          queue.push({
            id,
            arrival:
              time + profile.latency + (random() - 0.5) * 2 * profile.jitter,
            state: state(time / 50, time),
          });
        }
      queue.sort((a, b) => a.arrival - b.arrival);
      let index = 0;
      const previous = peers.map(() => 0);
      for (let now = 0; now <= 10300; now += 1000 / 60) {
        while (queue[index]?.arrival <= now) {
          const q = queue[index++];
          peers[q.id].push(q.state, q.arrival);
        }
        peers.forEach((b, id) => {
          const s = b.sample(now);
          if (!s) return;
          assert.ok(Number.isFinite(s.x));
          assert.ok(
            s.x >= previous[id] - 0.02,
            "no stale rollback on a straight",
          );
          assert.ok(b.states.length <= NETWORK.maxBuffer);
          previous[id] = s.x;
        });
      }
      peers.forEach((b) =>
        assert.ok(b.sample(10300).x > 380, "all peers recover and keep moving"),
      );
    }
  });
