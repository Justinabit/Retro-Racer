import test from "node:test";
import assert from "node:assert/strict";
import { CARS, TRACKS } from "../src/data.js";
import { Track, RaceProgress, rankRacers } from "../src/track/Track.js";
import { CarPhysics } from "../src/player/CarPhysics.js";
import { AICar } from "../src/ai/AICar.js";
import { Storage } from "../src/core/Storage.js";
import * as THREE from "three";
const dt = 1 / 60;
function pilot(player, track, targetSpeed = 53) {
  const s = track.nearest(player.position).s;
  const ahead = track.at(
    s + (10 + Math.abs(player.speed) * 0.42) / track.length,
  );
  const angle = Math.atan2(
    ahead.p.x - player.position.x,
    ahead.p.z - player.position.z,
  );
  const error = Math.atan2(
    Math.sin(angle - player.yaw),
    Math.cos(angle - player.yaw),
  );
  const bend = Math.acos(
    THREE.MathUtils.clamp(
      track.at(s).dir.dot(track.at(s + 30 / track.length).dir),
      -1,
      1,
    ),
  );
  const target = targetSpeed / (1 + bend * 2);
  return {
    throttle: player.speed < target ? 1 : 0,
    brake: player.speed > target + 4 ? 1 : 0,
    steer: THREE.MathUtils.clamp(error * 3, -1, 1),
    drift: false,
    boost: false,
  };
}
test("all 30 car/track combinations complete three ordered laps with actual physics", () => {
  for (const td of TRACKS) {
    const track = new Track(td);
    for (const car of CARS) {
      const p = new CarPhysics(car, track, 0.008, -3),
        progress = new RaceProgress(0.008);
      let steps = 0;
      while (!progress.finished && steps++ < 18000) {
        const r = p.update(dt, pilot(p, track));
        progress.update(r.nearest.s, r.headingDot);
        assert.ok(Number.isFinite(p.position.y));
      }
      assert.equal(progress.lap, 3, `${td.id}/${car.id}`);
      assert.ok(progress.finished);
      assert.ok(p.nitro >= 0 && p.nitro <= 1);
    }
    track.dispose();
  }
});
test("laps require ordered checkpoints; reversing and finish-line loops cannot farm laps", () => {
  const progress = new RaceProgress(0.98);
  for (let i = 0; i < 100; i++) {
    progress.update(0.01, 1);
    progress.update(0.98, -1);
  }
  assert.equal(progress.lap, 0);
  assert.equal(progress.checkpoint, 1);
  assert.equal(progress.wrongWay, true);
  const good = new RaceProgress(0);
  for (let i = 1; i <= 3000; i++) good.update((i % 1000) / 1000);
  assert.equal(good.lap, 3);
  assert.equal(good.finished, true);
});
test("AI competitors complete every layout and never become permanently stuck", () => {
  for (const td of TRACKS) {
    const track = new Track(td);
    const rivals = CARS.map(
      (spec, index) =>
        new AICar(
          { spec, group: new THREE.Group(), update() {} },
          track,
          index,
          0.88,
        ),
    );
    let steps = 0;
    while (rivals.some((a) => !a.progress.finished) && steps++ < 18000)
      for (const a of rivals) a.update(dt, rivals, null);
    assert.ok(
      rivals.every((a) => a.progress.finished && a.finishedAt > 0),
      td.id,
    );
    track.dispose();
  }
});
test("drifting scores, boost consumes charge, rail impacts stay finite, and reverse works", () => {
  const track = new Track(TRACKS[0]);
  const p = new CarPhysics(CARS[0], track, 0.05);
  p.velocity.set(Math.sin(p.yaw) * 35, 0, Math.cos(p.yaw) * 35);
  for (let i = 0; i < 60; i++)
    p.update(dt, {
      throttle: 1,
      brake: 0,
      steer: 0.8,
      drift: true,
      boost: true,
    });
  assert.ok(p.driftScore > 0);
  assert.ok(p.nitro < 1);
  const loc = track.at(0.05, 14);
  p.position.copy(loc.p);
  const collision = p.update(dt, {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    boost: false,
  });
  assert.ok(Math.abs(track.nearest(p.position).lateral) < 11);
  assert.ok(Number.isFinite(p.speed));
  const reverse = new CarPhysics(CARS[0], track, 0.05);
  for (let i = 0; i < 90; i++)
    reverse.update(dt, {
      throttle: 0,
      brake: 1,
      steer: 0,
      drift: false,
      boost: false,
    });
  assert.ok(reverse.speed < 0);
  track.dispose();
});
test("car attributes affect acceleration and steering", () => {
  const track = new Track(TRACKS[0]);
  const a = new CarPhysics(CARS[0], track, 0.05),
    b = new CarPhysics(CARS[1], track, 0.05);
  for (let i = 0; i < 60; i++) {
    const controls = {
      throttle: 1,
      brake: 0,
      steer: 0,
      drift: false,
      boost: false,
    };
    a.update(dt, controls);
    b.update(dt, controls);
  }
  assert.ok(b.speed > a.speed);
  track.dispose();
});
test("save data round-trips, keeps records, and survives corruption or unavailable storage", () => {
  let raw = null;
  globalThis.localStorage = {
    getItem() {
      return raw;
    },
    setItem(_, v) {
      raw = v;
    },
  };
  const store = new Storage();
  store.data.car = "demon";
  store.record({
    track: "coast",
    car: "gt",
    time: 130,
    score: 1000,
    name: "PLAYER",
    date: "2026-09-19",
  });
  assert.equal(new Storage().data.car, "demon");
  assert.equal(new Storage().best("coast"), 130);
  assert.equal(new Storage().data.finishes, 1);
  raw = "{broken json";
  assert.equal(new Storage().data.car, "gt");
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const blocked = new Storage();
  assert.equal(blocked.save(), false);
  delete globalThis.localStorage;
});

test("finish order is preserved when multiple racers have completed three laps", () => {
  const ranked = rankRacers([
    { id: "player", progress: 3, finishedAt: 180 },
    { id: "winner", progress: 3, finishedAt: 110 },
    { id: "second", progress: 3, finishedAt: 120 },
    { id: "unfinished", progress: 2.99, finishedAt: null },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["winner", "second", "player", "unfinished"],
  );
  const win = rankRacers([
    { id: "player", progress: 3, finishedAt: 110 },
    { id: "rival", progress: 2.8, finishedAt: null },
  ]);
  assert.equal(win[0].id, "player");
});

test("lifetime personal bests survive the recent-record limit and reload", () => {
  let raw = null;
  globalThis.localStorage = {
    getItem: () => raw,
    setItem: (_, value) => {
      raw = value;
    },
  };
  try {
    const store = new Storage();
    store.record({ track: "coast", time: 100, score: 5000 });
    for (let i = 0; i < 110; i++)
      store.record({ track: "coast", time: 200 + i, score: 1000 });
    assert.equal(store.data.records.length, 100);
    const reloaded = new Storage();
    assert.equal(reloaded.best("coast"), 100);
    assert.equal(reloaded.data.highScores.coast, 5000);
    assert.equal(reloaded.best("forest"), Infinity);
    // Existing version-one saves gain lifetime bests from their history.
    raw = JSON.stringify({
      version: 1,
      records: [{ track: "city", time: 120, score: 2500 }],
    });
    const migrated = new Storage();
    assert.equal(migrated.best("city"), 120);
    assert.equal(migrated.data.highScores.city, 2500);
  } finally {
    delete globalThis.localStorage;
  }
});
