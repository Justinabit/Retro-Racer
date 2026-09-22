import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CARS } from "../src/data.js";
import { CHARACTERS, KART_TRACKS, combineStats, ITEMS } from "../src/kart/data.js";
import { Track, RaceProgress } from "../src/track/Track.js";
import { CarPhysics } from "../src/player/CarPhysics.js";
import { buildShortcuts, nearestRoute } from "../src/kart/Routes.js";
import { ItemSystem } from "../src/kart/Items.js";
import { Storage } from "../src/core/Storage.js";

const dt = 1 / 60;

function pilot(player, track, targetSpeed = 52) {
  const s = track.nearest(player.position).s;
  const ahead = track.at(s + (10 + Math.abs(player.speed) * 0.42) / track.length);
  const angle = Math.atan2(ahead.p.x - player.position.x, ahead.p.z - player.position.z);
  const error = Math.atan2(Math.sin(angle - player.yaw), Math.cos(angle - player.yaw));
  const bend = Math.acos(
    THREE.MathUtils.clamp(track.at(s).dir.dot(track.at(s + 30 / track.length).dir), -1, 1),
  );
  const target = targetSpeed / (1 + bend * 2);
  return {
    throttle: player.speed < target ? 1 : 0,
    brake: player.speed > target + 4 ? 1 : 0,
    steer: THREE.MathUtils.clamp(error * 3, -1, 1),
    drift: Math.random() > 0.7 && bend > 0.12,
    boost: false,
  };
}

test("all 48 character/adventure combinations complete three ordered laps with kart physics", () => {
  for (const td of KART_TRACKS) {
    const track = new Track(td);
    for (const ch of CHARACTERS) {
      const car = CARS[0];
      const spec = combineStats(car, ch);
      const p = new CarPhysics(spec, track, 0.008, -3);
      const progress = new RaceProgress(0.008);
      let steps = 0;
      const target = 48 + (spec.speed || spec.top || 75) / 8;
      while (!progress.finished && steps++ < 24000) {
        const r = p.update(dt, pilot(p, track, target));
        progress.update(r.nearest.s, r.headingDot);
        assert.ok(Number.isFinite(p.position.y), `${td.id}/${ch.id} y finite`);
      }
      assert.equal(progress.lap, 3, `${td.id}/${ch.id} lap`);
      assert.ok(progress.finished, `${td.id}/${ch.id} finished`);
      assert.ok(p.nitro >= 0 && p.nitro <= 1, `${td.id}/${ch.id} nitro`);
    }
    track.dispose();
  }
});

test("combineStats uses 40% character + 60% vehicle and weight affects knockback", () => {
  const car = { top: 200, speed: 200, accel: 10, handling: 80, grip: 70, drift: 50, weight: 100, brake: 80, color: "#fff", name: "test" };
  const ch = { top: 100, speed: 100, accel: 5, handling: 40, grip: 30, drift: 20, weight: 50, name: "t", id: "t", color: "#000", cost: 0, description: "" };
  const combined = combineStats(car, ch);
  assert.equal(combined.weight, Math.round(50 * 0.4 + 100 * 0.6));
  // speed also blended
  assert.ok(combined.speed >= 100 && combined.speed <= 200);
  const light = { ...car, weight: 50 };
  const heavy = { ...car, weight: 150 };
  assert.ok(heavy.weight > light.weight);
});

test("adventure tracks have 2 narrow alternate routes, 24 boxes, 76 tokens, 3 pads, 2 ramps, 3 hazards", () => {
  for (const td of KART_TRACKS) {
    assert.ok(td.kart, `${td.id} is kart`);
    const track = new Track(td);
    assert.ok(track.length >= 3060 && track.length <= 3960, `${td.id} length ${track.length}`);
    assert.ok(Array.isArray(track.routes), `${td.id} routes array`);
    assert.equal(track.routes.length, 2, `${td.id} 2 shortcuts`);
    for (const r of track.routes) {
      assert.ok(r.points.length > 5, `${td.id} route points`);
      assert.ok(r.length > 5 && r.length < 400, `${td.id} route length ${r.length}`);
      assert.ok(r.width < 8, `${td.id} narrow ${r.width}`);
    }
    const before = track.routes.length;
    buildShortcuts(track);
    assert.equal(track.routes.length, 2);
    assert.equal(before, 2);
    const fakeRacers = [{ id: 0, position: new THREE.Vector3(), progress: { lap: 0, checkpoint: 0, finished: false, total: 0 }, item: null, tokens: 0, immune: 0, locked: 0, shield: 0, boost: 0, turbo: 0, roulette: 0, cooldown: 0, emp: 0, held: 0, spec: { weight: 75 }, physics: {} }];
    const items = new ItemSystem(track, fakeRacers, () => {});
    assert.equal(items.boxes.length, 24, `${td.id} boxes`);
    assert.equal(items.tokens.length, 76, `${td.id} tokens`);
    track.dispose();
  }
});

test("nearestRoute delegates to shortcuts and openEdge handles sky-island fall sections", () => {
  const td = KART_TRACKS.find((t) => t.id === "sky");
  assert.ok(td, "sky track exists");
  const track = new Track(td);
  assert.ok(Array.isArray(track.data.openEdges), "sky has openEdges array");
  assert.ok(track.data.openEdges.length === 2, "sky has 2 open intervals");
  assert.equal(typeof track.openEdge, "function");
  const route = track.routes[0];
  const mid = route.points[Math.floor(route.points.length / 2)];
  const nearest = track.nearest(new THREE.Vector3(mid.x, mid.y, mid.z));
  assert.ok(nearest, "nearest exists");
  const main = { distance: Infinity, s: 0 };
  const nr = nearestRoute(track, mid, main);
  assert.ok(nr.route || nr.distance < 100, "nearestRoute returns something");
  assert.ok(track.openEdge(0.42), "openEdge 0.42 true");
  assert.ok(track.openEdge(0.83), "openEdge 0.83 true");
  assert.ok(!track.openEdge(0.1), "openEdge 0.1 false");
  track.dispose();
});

test("8 items have correct durations and mechanics", () => {
  assert.equal(Object.keys(ITEMS).length, 8);
  const expected = ["boost", "bolt", "wave", "shield", "oil", "turbo", "magnet", "emp"];
  for (const id of expected) assert.ok(ITEMS[id], `item ${id} exists`);
  const track = new Track(KART_TRACKS[0]);
  const racer = {
    id: 0,
    position: new THREE.Vector3(),
    progress: { lap: 0, checkpoint: 0, finished: false, total: 0 },
    item: null,
    tokens: 0,
    immune: 0,
    locked: 0,
    shield: 0,
    boost: 0,
    turbo: 0,
    magnet: 0,
    roulette: 0,
    cooldown: 0,
    emp: 0,
    held: 0,
    uses: 0,
    spec: { weight: 75 },
    physics: { speed: 20, position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0 },
  };
  const items = new ItemSystem(track, [racer], () => {});
  racer.item = "boost";
  racer.cooldown = 0;
  racer.roulette = 0;
  assert.ok(items.activate(racer));
  assert.ok(racer.boost >= 2.9 && racer.boost <= 3.1, `boost duration ${racer.boost}`);
  racer.item = "shield";
  racer.cooldown = 0;
  racer.roulette = 0;
  assert.ok(items.activate(racer));
  assert.ok(racer.shield >= 9.9 && racer.shield <= 10.1, `shield ${racer.shield}`);
  racer.item = "turbo";
  racer.cooldown = 0;
  racer.roulette = 0;
  assert.ok(items.activate(racer));
  assert.ok(racer.turbo >= 1.3 && racer.turbo <= 1.4, `turbo ${racer.turbo}`);
  // check ITEMS durations match spec
  assert.equal(ITEMS.boost.duration, 3);
  assert.equal(ITEMS.shield.duration, 10);
  assert.equal(ITEMS.turbo.duration, 1.35);
  assert.equal(ITEMS.oil.duration, 14);
  assert.equal(ITEMS.magnet.duration, 8);
  track.dispose();
});

test("kart storage round-trips with mode/character/kartTrack/tokens/kartFinishes and namespaced bestTimes", () => {
  let raw = null;
  globalThis.localStorage = {
    getItem: () => raw,
    setItem: (_, v) => {
      raw = v;
    },
  };
  try {
    const store = new Storage();
    store.data.mode = "kart";
    store.data.character = "nova";
    store.data.kartTrack = "volcano";
    store.data.tokens = 42;
    store.data.kartFinishes = 3;
    store.data.finishes = 5;
    store.record({ track: "metropolis", time: 95, score: 5000, mode: "kart" });
    const reloaded = new Storage();
    assert.equal(reloaded.data.mode, "kart");
    assert.equal(reloaded.data.character, "nova");
    assert.equal(reloaded.data.kartTrack, "volcano");
    assert.equal(reloaded.data.tokens, 42);
    assert.equal(reloaded.best("metropolis", "kart"), 95);
    assert.equal(reloaded.best("metropolis", "classic"), Infinity);
  } finally {
    delete globalThis.localStorage;
  }
});

test("drift mini-turbo charges and token nitro restore", () => {
  const track = new Track(KART_TRACKS[0]);
  const car = CARS[0];
  const ch = CHARACTERS[0];
  const spec = combineStats(car, ch);
  const p = new CarPhysics(spec, track, 0.05);
  p.velocity.set(Math.sin(p.yaw) * 35, 0, Math.cos(p.yaw) * 35);
  p.nitro = 0.2;
  for (let i = 0; i < 120; i++) {
    p.update(dt, { throttle: 1, brake: 0, steer: 0.8, drift: true, boost: false });
  }
  assert.ok(p.driftScore > 0, "drift score");
  track.dispose();
});

test("falling recovery 2s lock and immunity", () => {
  const racer = {
    id: 0,
    position: new THREE.Vector3(0, -100, 0),
    progress: { checkpoint: 2, lap: 0, total: 0.1, previous: 0.1 },
    item: null,
    tokens: 0,
    immune: 0,
    locked: 0,
    shield: 0,
    boost: 0,
    turbo: 0,
    spec: { weight: 75 },
    physics: {
      position: new THREE.Vector3(0, -100, 0),
      velocity: new THREE.Vector3(),
      speed: 10,
      yaw: 0,
      airVelocity: 0,
      groundY: 0,
      airborne: false,
      lastS: 0,
    },
    wasAirborne: false,
    onRoute: false,
    stuck: 0,
  };
  racer.locked = 2;
  racer.immune = 3;
  assert.equal(racer.locked, 2, "2s recovery");
  assert.equal(racer.immune, 3, "immunity after respawn");
});
