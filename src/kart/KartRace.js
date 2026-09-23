import * as THREE from "three";
import { ItemSystem, racerState } from "./Items.js";
import { label } from "./World.js";
export class KartRace {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.racers = [
      racerState(0, game.player, game.car, game.progress, game.player.spec),
      ...Array.from(game.multiplayerRace?.remotePlayers.values() || []).map((r, i) => ({
        ...racerState(i + 1, r, r.car, r.progress, r.spec), remote: true, networkId: r.id,
      })),
      ...game.ai.map((a, i) =>
        racerState(i + 1, a, a.car, a.progress, a.car.spec),
      ),
    ];
    let itemSeed = game.track.data.seed + (game.store.data.finishes + 1) * 31;
    const random = () => {
      itemSeed = (Math.imul(itemSeed, 1664525) + 1013904223) >>> 0;
      return itemSeed / 4294967296;
    };
    this.items = new ItemSystem(game.track, this.racers, (event, r, detail) =>
      this.feedback(event, r, detail),
    );
    this.items.localPlayerId = game.multiplayerRace?.localPlayerId;
    this.time = 0;
    this.message = "ITEM BOXES AHEAD";
    this.messageUntil = 4;
    this.stats = { pads: 0, jumps: 0, landings: 0, shortcuts: 0, respawns: 0 };
    this.pads = [0.13, 0.4, 0.74].map((s) => ({
      s,
      position: game.track.at(s, 3).p,
      cooldowns: new Map(),
    }));
    this.ramps = [0.3, 0.77].map((s) => ({
      s,
      position: game.track.at(s, -3).p,
      cooldowns: new Map(),
    }));
    this.hazards = game.track.data.kart
      ? [0.27, 0.54, 0.89].map((s, i) => ({
          s,
          index: i,
          position: game.track.at(s).p,
          cooldowns: new Map(),
          active: false,
        }))
      : [];
    this.makeView();
    game.scene.add(this.group);
  }
  feedback(event, r, detail) {
    if (r.id !== 0) return;
    if (this.g.multiplayerRace) {
      if (event === 'pickup') this.g.multiplayerRace.queueEvent({ type: 'pickup', box: detail, item: r.item });
      if (['boost','turbo','shield','magnet','oil','wave','emp','bolt'].includes(event) && this.activating)
        this.g.multiplayerRace.queueEvent({ type: 'use', item: event, target: r.lastTarget });
    }
    const texts = {
      pickup: "ITEM ACQUIRED!",
      token: "+1 RACE TOKEN",
      hit: "HIT · RECOVERING",
      blocked: "SHIELD ABSORBED THE HIT",
      "no-target": "NO TARGET AHEAD · KEEP THE BOLT",
      boost: "SPEED BOOST",
      turbo: "TURBO!",
      shield: "SHIELD ACTIVE",
      oil: "OIL DEPLOYED",
      wave: "SHOCKWAVE",
      emp: "EMP PULSE",
      magnet: "MAGNET ACTIVE",
      bolt: "BOLT LAUNCHED",
      pad: "BOOST PAD",
      jump: "AIRBORNE",
      landing: "LANDED",
      respawn: "CHECKPOINT RECOVERY · 2 SECOND STOP",
      shortcut: "SHORTCUT · NARROW LINE",
    };
    if (event !== "token" || this.time > this.messageUntil) {
      this.message = texts[event] || event.toUpperCase();
      this.messageUntil = this.time + (event === "respawn" ? 2.5 : 1.5);
    }
    this.g.audio.tone(
      event === "hit"
        ? 85
        : event === "token"
          ? 1050
          : event === "jump"
            ? 420
            : 720,
      event === "hit" ? 0.18 : 0.08,
      event === "token" ? 0.018 : 0.07,
      event === "hit" ? "sawtooth" : "triangle",
    );
    if (
      this.g.store.data.settings.particles &&
      this.g.particles &&
      event !== "token"
    )
      this.g.particles.emit(
        r.position,
        event === "hit" ? 0xffaa55 : 0x9edfe7,
        6,
      );
  }
  mesh(geo, color, glow = 0, opacity = 1) {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: glow,
        transparent: opacity < 1,
        opacity,
        roughness: 0.4,
        side: THREE.DoubleSide,
        depthWrite: opacity === 1,
      }),
    );
    this.group.add(m);
    return m;
  }
  makeView() {
    const cube = new THREE.BoxGeometry(1.8, 1.8, 1.8),
      sphere = new THREE.IcosahedronGeometry(0.5, 0),
      disc = new THREE.CylinderGeometry(3.2, 3.2, 0.035, 20),
      ring = new THREE.TorusGeometry(1, 0.055, 4, 24);
    this.boxMeshes = this.items.boxes.map((b) => {
      const m = this.mesh(cube, 0xb58be8, 0.55);
      m.position.copy(b.position);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.38),
        new THREE.MeshBasicMaterial({ color: 0xf1e4c6, wireframe: true }),
      );
      m.add(core);
      return m;
    });
    this.tokenMeshes = this.items.tokens.map((t) => {
      const m = this.mesh(
        new THREE.TorusGeometry(0.55, 0.16, 5, 10),
        0xf6c85b,
        0.45,
      );
      m.position.copy(t.position);
      return m;
    });
    this.boltMeshes = this.items.projectiles.map(() =>
      this.mesh(sphere, 0xba91ff, 1),
    );
    this.oilMeshes = this.items.oils.map(() =>
      this.mesh(disc, 0x30233e, 0.2, 0.9),
    );
    this.waveMeshes = this.items.waves.map(() => {
      const m = this.mesh(ring, 0x9eddef, 1, 0.7);
      m.rotation.x = Math.PI / 2;
      return m;
    });
    this.shields = this.racers.map(() =>
      this.mesh(new THREE.SphereGeometry(2.2, 12, 8), 0x91d6f5, 0.5, 0.24),
    );
    for (const pad of this.pads) {
      const loc = this.g.track.at(pad.s, 3),
        m = this.mesh(new THREE.BoxGeometry(5, 0.1, 8), 0x53c8b4, 0.8);
      m.position.copy(loc.p);
      m.rotation.y = loc.yaw;
      for (let i = -2; i <= 2; i += 2) {
        const arrow = label("» » »", "#eafbf0", "#238c81");
        arrow.scale.set(0.4, 0.55, 1);
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(0, 0.09, i);
        m.add(arrow);
      }
    }
    for (const ramp of this.ramps) {
      const loc = this.g.track.at(ramp.s, -3),
        m = this.mesh(new THREE.BoxGeometry(5, 0.35, 8), 0xf1b966, 0.25);
      m.position.copy(loc.p);
      m.position.y += 0.55;
      m.rotation.set(-0.14, loc.yaw, 0);
    }
    this.hazardMeshes = this.hazards.map((h) => {
      const d = this.g.track.data,
        type = d.hazard;
      const m = this.mesh(
        type === "rockfall"
          ? new THREE.DodecahedronGeometry(2.6)
          : new THREE.BoxGeometry(
              type === "train" ? 20 : 4,
              type === "gate" ? 5 : 2.5,
              3,
            ),
        type === "rockfall" ? 0x7b5556 : type === "train" ? 0xb68d58 : 0xdf9864,
        0.12,
      );
      const detail = (geo, color, x, y, z) => {
        const child = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
        );
        child.position.set(x, y, z);
        m.add(child);
        return child;
      };
      if (["train", "traffic", "snowplow"].includes(type)) {
        const length = type === "train" ? 20 : 4;
        detail(
          new THREE.BoxGeometry(type === "train" ? 5 : 2, 1.8, 2.4),
          0x455c6e,
          type === "train" ? -5 : 0,
          1.7,
          0,
        );
        for (const x of type === "train" ? [-8, -3, 3, 8] : [-1.2, 1.2])
          for (const z of [-1.5, 1.5]) {
            const wheel = detail(
              new THREE.CylinderGeometry(0.6, 0.6, 0.35, 10),
              0x293138,
              x,
              -0.9,
              z,
            );
            wheel.rotation.x = Math.PI / 2;
          }
        if (type === "train")
          detail(
            new THREE.CylinderGeometry(0.5, 0.7, 2, 8),
            0x4b4c50,
            -8,
            2.4,
            0,
          );
        if (type === "snowplow")
          detail(
            new THREE.BoxGeometry(0.4, 2, 4.5),
            0xe9b44e,
            length / 2 + 0.3,
            -0.2,
            0,
          ).rotation.z = -0.25;
        for (const z of [-0.9, 0.9])
          detail(
            new THREE.BoxGeometry(0.08, 0.5, 0.4),
            0xffebae,
            length / 2 + 0.05,
            0.2,
            z,
          );
      } else if (type === "pendulum") {
        detail(new THREE.CylinderGeometry(0.08, 0.08, 8, 6), 0xb3b5a0, 0, 5, 0);
        detail(new THREE.OctahedronGeometry(2.1), 0x889879, 0, -0.5, 0);
      } else if (type === "gate") {
        detail(new THREE.BoxGeometry(0.15, 1.2, 3.2), 0xf5d37d, 2.05, 0.5, 0);
      }
      const warning = label(
        type.toUpperCase() + " · WATCH THE LIGHT",
        "#ffcf76",
      );
      const loc = this.g.track.at(h.s - 0.007);
      warning.position.copy(loc.p);
      warning.position.y += 6;
      warning.rotation.y = loc.yaw + Math.PI;
      this.group.add(warning);
      const lamp = this.mesh(new THREE.SphereGeometry(0.5, 8, 6), 0xffba46, 1);
      lamp.position.copy(warning.position);
      lamp.position.y += 2;
      h.lamp = lamp;
      return m;
    });
    this.surfaces = [];
    if (["winter", "jungle", "canyon"].includes(this.g.track.data.id))
      for (const s of [0.18, 0.52, 0.86]) {
        const loc = this.g.track.at(s),
          m = this.mesh(
            new THREE.BoxGeometry(16, 0.05, 25),
            this.g.track.data.id === "winter" ? 0x9ad8ef : 0x867150,
            0.15,
            0.8,
          );
        m.position.copy(loc.p);
        m.position.y += 0.1;
        m.rotation.y = loc.yaw;
        this.surfaces.push({ s, position: loc.p });
      }
  }
  activate() {
    this.activating = true;
    const activated = this.g.state === 'RACING' && this.items.activate(this.racers[0]);
    this.activating = false;
    return activated;
  }
  remoteActivate(playerId, item, targetId) {
    if (!['boost','turbo','shield','magnet','oil','wave','emp','bolt'].includes(item)) return;
    const r = this.racers.find(r => r.networkId === playerId);
    if (!r) return;
    r.item = item; r.roulette = 0; r.cooldown = 0;
    const target = targetId === this.g.multiplayerRace.localPlayerId ? this.racers[0] : this.racers.find(r => r.networkId === targetId);
    this.items.activate(r, target?.id);
  }
  removeRemote(playerId) {
    const index = this.racers.findIndex(r => r.networkId === playerId);
    if (index < 1) return;
    // Item indices are local implementation details, never wire identities.
    // Remap finite projectile pools before releasing the departed car reference.
    for (const p of this.items.projectiles) {
      if (p.owner === index || p.target === index) p.life = 0;
      if (p.owner > index) p.owner--;
      if (p.target > index) p.target--;
    }
    this.racers.splice(index, 1);
    this.racers.forEach((r, i) => { r.id = i; });
    const shield = this.shields.splice(index, 1)[0];
    if (shield) { shield.removeFromParent(); shield.geometry.dispose(); shield.material.dispose(); }
  }

  before(dt) {
    this.time += dt;
    this.items.before(dt);
    for (const r of this.racers) {
      if (r.remote) continue;
      const physics = r.physics;
      if (this.surfaces.some((s) => r.position.distanceTo(s.position) < 15)) {
        physics.kartEffects.grip *=
          this.g.track.data.id === "winter" ? 0.4 : 0.65;
        physics.kartEffects.speed *= 0.85;
      }
      if (r.id === 0) {
        if (physics.drifting)
          r.driftCharge = Math.min(
            3,
            r.driftCharge + dt * (0.6 + r.spec.drift / 100),
          );
        else if (r.driftCharge > 0) {
          if (r.driftCharge > 1) {
            r.boost = Math.max(r.boost, 0.45 + r.driftCharge * 0.3);
            this.feedback("turbo", r);
          }
          r.driftCharge = 0;
        }
      }
    }
    this.hazards.forEach((h) => {
      const phase = (this.time + h.index * 3) % 12,
        type = this.g.track.data.hazard;
      h.active = phase > 3 && phase < 8;
      const lane = h.active ? ((phase - 3) / 5) * 28 - 14 : -18;
      const loc = this.g.track.at(h.s, lane);
      h.position.copy(loc.p);
      h.position.y +=
        type === "rockfall"
          ? h.active
            ? Math.max(1.2, 8 - (phase - 3) * 7)
            : 8
          : 1.2;
      h.lamp.material.color.set(phase > 1.5 && phase < 8 ? 0xff864a : 0x86be97);
      h.lamp.material.emissive.copy(h.lamp.material.color);
      if (
        phase > 1.5 &&
        phase < 3 &&
        this.racers[0].position.distanceTo(h.position) < 100 &&
        this.time > (h.warned || 0) + 10
      ) {
        h.warned = this.time;
        this.message = "WARNING · " + type.toUpperCase() + " AHEAD";
        this.messageUntil = this.time + 1.5;
        this.g.audio.tone(280, 0.14, 0.07);
      }
    });
  }
  after(dt) {
    const track = this.g.track;
    for (const r of this.racers) {
      if (r.remote || r.progress.finished) continue;
      for (const pad of this.pads)
        if (
          r.position.distanceTo(pad.position) < 5 &&
          this.time > (pad.cooldowns.get(r.id) || 0)
        ) {
          pad.cooldowns.set(r.id, this.time + 3);
          r.boost = Math.max(r.boost, 1.7);
          this.feedback("pad", r);
          if (r.id === 0) this.stats.pads++;
        }
      for (const ramp of this.ramps)
        if (
          r.position.distanceTo(ramp.position) < 5 &&
          Math.abs(r.physics.speed) > 18 &&
          this.time > (ramp.cooldowns.get(r.id) || 0)
        ) {
          ramp.cooldowns.set(r.id, this.time + 3);
          if (r.id === 0) {
            r.physics.position.y += 0.2;
            r.physics.airVelocity = 17;
            r.physics.airborne = true;
            this.stats.jumps++;
          } else {
            r.physics.jumpVelocity = 17;
            r.physics.jumpHeight = 0.2;
          }
          this.feedback("jump", r);
        }
      for (const h of this.hazards)
        if (
          h.active &&
          r.position.distanceTo(h.position) <
            (track.data.hazard === "train" ? 9 : 4.5)
        )
          this.items.hit(r, "hazard");
      if (r.id === 0) {
        const p = r.physics,
          n = track.nearest(p.position);
        if (n.route && !r.onRoute) {
          this.stats.shortcuts++;
          this.feedback("shortcut", r);
        }
        r.onRoute = !!n.route;
        if (r.wasAirborne && !p.airborne) {
          this.stats.landings++;
          this.feedback("landing", r);
        }
        r.wasAirborne = p.airborne;
        if (
          p.position.y < n.p.y - 16 ||
          n.distance > 65 ||
          !Number.isFinite(p.position.y)
        )
          this.respawn(r);
        r.stuck =
          Math.abs(p.speed) < 1 && this.g.input.controls.throttle
            ? (r.stuck || 0) + dt
            : 0;
        if (r.stuck > 4 && r.locked <= 0) this.respawn(r);
      }
    }
    this.items.after(dt);
    this.updateView();
  }
  respawn(r = this.racers[0]) {
    const s = (r.progress.checkpoint - 1) / 12 + 0.003,
      loc = this.g.track.at(s);
    r.physics.position.copy(loc.p);
    r.physics.velocity.set(0, 0, 0);
    r.physics.speed = 0;
    r.physics.yaw = loc.yaw;
    r.physics.airVelocity = 0;
    r.physics.groundY = loc.p.y;
    r.physics.airborne = false;
    r.physics.lastS = s;
    r.progress.previous = s;
    r.progress.total = r.progress.lap + s;
    r.locked = 2;
    r.immune = 3;
    r.stuck = 0;
    r.item = null;
    r.boost = 0;
    r.turbo = 0;
    this.stats.respawns++;
    this.feedback("respawn", r);
  }
  updateView() {
    const t = this.time;
    this.boxMeshes.forEach((m, i) => {
      const b = this.items.boxes[i];
      m.visible = b.cooldown <= 0;
      m.rotation.set(t * 0.5, t, Math.sin(t + i) * 0.12);
      m.position.y = b.position.y + 0.25 * Math.sin(t * 2 + i);
    });
    this.tokenMeshes.forEach((m, i) => {
      m.visible = this.items.tokens[i].cooldown <= 0;
      m.rotation.y = t * 2;
    });
    const update = (meshes, pool) =>
      meshes.forEach((m, i) => {
        m.visible = pool[i].life > 0;
        if (m.visible) m.position.copy(pool[i].position);
      });
    update(this.boltMeshes, this.items.projectiles);
    update(this.oilMeshes, this.items.oils);
    update(this.waveMeshes, this.items.waves);
    this.waveMeshes.forEach((m, i) => {
      const w = this.items.waves[i];
      m.scale.setScalar(Math.max(0.1, (1 - w.life / 0.5) * w.radius));
      m.material.color.set(w.color);
    });
    this.shields.forEach((m, i) => {
      const r = this.racers[i];
      m.visible = r.shield > 0;
      m.position.copy(r.position);
      m.position.y += 1;
      m.rotation.y = t;
    });
    this.hazardMeshes.forEach((m, i) => {
      m.position.copy(this.hazards[i].position);
      m.rotation.y = this.g.track.at(this.hazards[i].s).yaw;
      if (this.g.track.data.hazard === "rockfall") m.rotation.x = t;
    });
  }
  dispose() {
    this.g.scene.remove(this.group);
    const geometries = new Set(),
      materials = new Set();
    this.group.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
  }
}
