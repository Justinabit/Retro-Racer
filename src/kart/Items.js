import * as THREE from "three";
import { ITEMS, rollItem } from "./data.js";
const distance = (a, b) => a.position.distanceTo(b.position);
export function racerState(id, physics, car, progress, spec) {
  return {
    id,
    physics,
    car,
    progress,
    spec,
    get position() {
      return physics.position || car.group.position;
    },
    item: null,
    roulette: 0,
    cooldown: 0,
    held: 0,
    tokens: 0,
    shield: 0,
    boost: 0,
    turbo: 0,
    magnet: 0,
    slow: 0,
    slip: 0,
    emp: 0,
    immune: 0,
    recovery: 0,
    locked: 0,
    driftCharge: 0,
    personality: ["aggressive", "defensive", "speed", "drift"][id % 4],
    hits: 0,
    uses: 0,
    pickups: 0,
  };
}
// Simulation owns item rules. Meshes are only a view of these finite pools.
export class ItemSystem {
  constructor(track, racers, notify = () => {}, random = Math.random) {
    this.track = track;
    this.racers = racers;
    this.notify = notify;
    this.random = random;
    this.time = 0;
    this.boxes = [];
    this.tokens = [];
    for (const s of [0.08, 0.22, 0.35, 0.48, 0.58, 0.71, 0.84, 0.94])
      for (const lane of [-5, 0, 5])
        this.boxes.push({
          position: track.at(s, lane).p.add(new THREE.Vector3(0, 1, 0)),
          cooldown: 0,
        });
    for (let i = 0; i < 64; i++)
      this.tokens.push({
        position: track
          .at(0.06 + i * 0.014, i % 2 ? -3 : 3)
          .p.add(new THREE.Vector3(0, 1, 0)),
        cooldown: 0,
      });
    for (const r of track.routes || [])
      for (let i = 1; i < 7; i++)
        this.tokens.push({
          position: r.points[0]
            .clone()
            .lerp(r.points.at(-1), i / 7)
            .add(new THREE.Vector3(0, 1, 0)),
          cooldown: 0,
        });
    this.projectiles = Array.from({ length: 24 }, () => ({
      life: 0,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      owner: 0,
      target: 0,
    }));
    this.oils = Array.from({ length: 24 }, () => ({
      life: 0,
      position: new THREE.Vector3(),
      age: 0,
    }));
    this.waves = Array.from({ length: 12 }, () => ({
      life: 0,
      position: new THREE.Vector3(),
      radius: 0,
      color: 0xffffff,
    }));
  }
  rank(r) {
    return (
      1 +
      this.racers.filter(
        (o) =>
          o !== r &&
          ((o.progress.finished && !r.progress.finished) ||
            o.progress.total > r.progress.total),
      ).length
    );
  }
  hit(r, kind, owner) {
    if (r.remote) return false; // Only the victim client may change its own physics.
    if (r.progress.finished || r.immune > 0 || r.locked > 0) return false;
    if (r.shield > 0) {
      r.shield = 0;
      r.immune = 0.9;
      this.notify("blocked", r);
      return false;
    }
    r.slow = kind === "emp" ? 1.2 : 1.0;
    r.slip = kind === "oil" ? 1.5 : 0;
    r.emp = kind === "emp" ? 1.5 : 0;
    r.immune = 1.8;
    r.recovery = r.spec.character === "bolt" ? 2.6 : 0;
    r.hits++;
    const resistance = THREE.MathUtils.clamp(
      (r.spec.weight || 75) / 100,
      0.35,
      1,
    );
    if (r.physics.velocity) {
      r.physics.velocity.multiplyScalar(0.43 + resistance * 0.25);
      r.physics.velocity.addScaledVector(
        new THREE.Vector3(Math.cos(r.physics.yaw), 0, -Math.sin(r.physics.yaw)),
        (kind === "oil" ? 2 : 5) / resistance,
      );
      r.physics.collision = 1;
    } else {
      r.physics.speed *= 0.43 + resistance * 0.25;
      r.physics.lane = THREE.MathUtils.clamp(
        r.physics.lane + 2 / resistance,
        -4,
        4,
      );
    }
    this.burst(r.position, kind === "oil" ? 0x9a7ebc : 0xffb16b, 5);
    this.notify("hit", r);
    return true;
  }
  burst(position, color, radius) {
    const wave = this.waves.find((w) => w.life <= 0);
    if (wave) {
      wave.life = 0.5;
      wave.position.copy(position);
      wave.radius = radius;
      wave.color = color;
    }
  }
  activate(r, targetId) {
    if (
      !r ||
      !r.item ||
      r.roulette > 0 ||
      r.cooldown > 0 ||
      r.emp > 0 ||
      r.locked > 0 ||
      r.progress.finished
    )
      return false;
    const id = r.item;
    let target;
    if (id === "bolt") {
      target = this.racers
        .filter(
          (o) =>
            o !== r &&
            !o.progress.finished &&
            o.progress.total > r.progress.total &&
            distance(r, o) < 160,
        )
        .sort((a, b) => a.progress.total - b.progress.total)[0];
      if (r.remote && targetId !== undefined) target = this.racers.find(o => o.id === targetId);
      if (!target) {
        this.notify("no-target", r);
        return false;
      }
      const p = this.projectiles.find((p) => p.life <= 0);
      if (!p) return false;
      p.life = 4;
      p.owner = r.id;
      p.target = target.id;
      r.lastTarget = target.networkId || this.localPlayerId;
      p.position.copy(r.position).add(new THREE.Vector3(0, 1, 0));
      p.velocity
        .copy(target.position)
        .sub(r.position)
        .normalize()
        .multiplyScalar(100);
    }
    if (id === "oil") {
      const oil = this.oils.find((o) => o.life <= 0);
      if (!oil) return false;
      oil.life = 14;
      oil.age = 0;
      const yaw = r.physics.yaw ?? r.car.group.rotation.y;
      oil.position
        .copy(r.position)
        .add(new THREE.Vector3(-Math.sin(yaw) * 6, 0.06, -Math.cos(yaw) * 6));
    }
    if (["boost", "turbo", "shield", "magnet"].includes(id))
      r[id] = ITEMS[id].duration;
    if (id === "wave" || id === "emp") {
      const radius = id === "wave" ? 15 : 22;
      for (const other of this.racers)
        if (other !== r && distance(r, other) < radius) this.hit(other, id, r);
      this.burst(r.position, ITEMS[id].color, radius);
    }
    r.item = null;
    r.held = 0;
    r.cooldown = 1.4;
    r.uses++;
    this.notify(id, r);
    return true;
  }
  before(dt) {
    this.time += dt;
    for (const r of this.racers) {
      for (const key of [
        "roulette",
        "cooldown",
        "shield",
        "boost",
        "turbo",
        "magnet",
        "slow",
        "slip",
        "emp",
        "immune",
        "recovery",
        "locked",
      ])
        r[key] = Math.max(0, r[key] - dt);
      const boost = r.turbo > 0 ? 1.5 : r.boost > 0 ? 1.25 : 1;
      r.physics.kartEffects = {
        speed: boost * (r.slow > 0 ? 0.65 : 1),
        accel:
          (r.turbo > 0 ? 2.7 : r.boost > 0 ? 1.65 : 1) *
          (r.recovery > 0 ? 1.2 : 1),
        grip: r.slip > 0 ? 0.22 : 1,
        locked: r.locked > 0,
        slip: r.slip > 0,
      };
      if (r.item) r.held += dt;
      if (
        !r.remote && r.id > 0 &&
        r.held >
          (r.personality === "aggressive"
            ? 0.7
            : r.personality === "defensive"
              ? 2.2
              : 1.2) +
            r.id * 0.08
      ) {
        const nearby = this.racers.some(
          (o) => o !== r && distance(r, o) < (r.item === "emp" ? 22 : 15),
        );
        const defensive =
          r.item === "shield" &&
          (this.projectiles.some((p) => p.life > 0 && p.target === r.id) ||
            nearby ||
            r.held > (r.personality === "defensive" ? 7 : 3));
        const mayAttack = r.personality !== "defensive" || nearby || r.held > 6;
        if (
          ["boost", "turbo", "magnet", "oil"].includes(r.item) ||
          defensive ||
          (["wave", "emp"].includes(r.item) && nearby) ||
          (r.item === "bolt" && mayAttack)
        )
          this.activate(r);
        // No permanent inventory deadlock for a leader with a bolt and no target.
        if (r.held > 16) {
          r.item = null;
          r.held = 0;
        }
      }
    }
  }
  after(dt) {
    for (const box of this.boxes) {
      box.cooldown = Math.max(0, box.cooldown - dt);
      if (box.cooldown > 0) continue;
      for (const r of this.racers) {
        if (r.remote || r.item || r.progress.finished || r.locked > 0) continue;
        if (r.position.distanceTo(box.position) < (r.magnet > 0 ? 12 : 3.8)) {
          r.item = rollItem(this.rank(r), this.random);
          r.roulette = 0.5;
          r.held = 0;
          r.pickups++;
          box.cooldown = 5;
          this.burst(box.position, 0xe2c7ff, 3);
          this.notify("pickup", r, this.boxes.indexOf(box));
          break;
        }
      }
    }
    for (const token of this.tokens) {
      token.cooldown = Math.max(0, token.cooldown - dt);
      if (token.cooldown > 0) continue;
      for (const r of this.racers)
        if (
          !r.remote && !r.progress.finished &&
          r.locked <= 0 &&
          r.position.distanceTo(token.position) < (r.magnet > 0 ? 12 : 2.8)
        ) {
          token.cooldown = 12;
          r.tokens++;
          if (r.physics.nitro !== undefined)
            r.physics.nitro = Math.min(1, r.physics.nitro + 0.04);
          this.notify("token", r);
          break;
        }
    }
    for (const p of this.projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const target = this.racers[p.target];
      if (!target || target.progress.finished) {
        p.life = 0;
        continue;
      }
      const desired = target.position
        .clone()
        .add(new THREE.Vector3(0, 1, 0))
        .sub(p.position)
        .normalize()
        .multiplyScalar(100);
      p.velocity.lerp(desired, Math.min(1, dt * 4));
      p.position.addScaledVector(p.velocity, dt);
      if (
        p.position.distanceTo(
          target.position.clone().add(new THREE.Vector3(0, 1, 0)),
        ) < 2.6
      ) {
        this.hit(target, "bolt", this.racers[p.owner]);
        p.life = 0;
      }
    }
    for (const oil of this.oils) {
      if (oil.life <= 0) continue;
      oil.life -= dt;
      oil.age += dt;
      if (oil.age < 0.5) continue;
      for (const r of this.racers)
        if (r.position.distanceTo(oil.position) < 3.3) this.hit(r, "oil");
    }
    for (const wave of this.waves) wave.life = Math.max(0, wave.life - dt);
  }
}
