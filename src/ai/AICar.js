import { routeAt } from "../kart/Routes.js";
import * as THREE from "three";
import { RaceProgress, mod } from "../track/Track.js";

export class AICar {
  constructor(car, track, index, difficulty) {
    this.car = car;
    this.track = track;
    this.index = index;
    this.isAI = true; // Mark as AI - NEVER use in multiplayer
    this.personality = ["aggressive", "defensive", "speed", "drift"][
      (index + 1) % 4
    ];
    this.s = 0.019 + Math.floor(index / 2) * 0.006;
    this.lane = index % 2 ? -3 : 3;
    this.targetLane = this.lane;
    this.speed = 0;
    this.difficulty = difficulty;
    this.progress = new RaceProgress(this.s);
    this.aggression = 0.92 + index * 0.022;
    this.time = 0;
    this.finishedAt = null;
    this.stuckTime = 0;
    this.lastS = this.s;
    this._lastPos = new THREE.Vector3();
    this.update(0, [], null);
  }

  update(dt, others, player) {
    if (this.progress.finished) return;
    this.time += dt;
    const fx = this.kartEffects || { speed: 1, accel: 1, grip: 1 };
    if (fx.locked) {
      this.speed = 0;
      return;
    }

    // Stuck detection for AI
    const pos = this.car.group.position;
    const delta = pos.distanceTo(this._lastPos);
    if (this.speed < 1 && delta < 0.1) {
      this.stuckTime += dt;
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - dt);
    }
    this._lastPos.copy(pos);

    // If stuck for >3s, try to recover
    if (this.stuckTime > 3) {
      this.targetLane = -this.lane; // Try opposite lane
      this.speed = Math.max(this.speed, 10);
      if (this.stuckTime > 5) {
        // Teleport slightly forward
        this.s = mod(this.s + 0.01, 1);
        this.stuckTime = 0;
      }
    }

    if (this.car.spec.kart && this.track.routes) {
      if (this.route && this.s > this.route.end) this.route = null;
      if (
        !this.route &&
        this.personality !== "defensive" &&
        this.personality !== "speed"
      )
        this.route = this.track.routes.find(
          (r) => this.s >= r.start && this.s < r.start + 0.005,
        );
    }

    const now = this.track.at(this.s, this.lane),
      ahead = this.track.at(this.s + 20 / this.track.length);
    const curvature = Math.acos(
      THREE.MathUtils.clamp(now.dir.dot(ahead.dir), -1, 1),
    );
    let target =
      ((43 + this.car.spec.speed * 0.32) * this.difficulty * this.aggression) /
      (1 + curvature * 2.6);
    target *= fx.speed * (fx.grip < 1 ? 0.87 : 1) * (this.route ? 0.8 : 1);
    
    this.targetLane = this.index % 2 ? -2.8 : 2.8;
    if (this.car.spec.kart) {
      if ([0.13, 0.4, 0.74].some((s) => s - this.s > 0 && s - this.s < 0.02))
        this.targetLane = 3;
      if ([0.3, 0.77].some((s) => s - this.s > 0 && s - this.s < 0.012))
        this.targetLane = -3;
    }

    // Improved collision avoidance with broad-phase
    for (const other of others) {
      if (other === this) continue;
      const gap = mod(other.s - this.s, 1) * this.track.length;
      const lateralDiff = Math.abs(other.lane - this.lane);
      
      // Broad-phase: only check if close
      if (gap < 20 && lateralDiff < 3) {
        if (gap < 13 && lateralDiff < 2.1) {
          this.targetLane = this.lane > 0 ? -3.3 : 3.3;
          if (gap < 5) target = Math.min(target, other.speed * 0.85); // More braking
        }
        // Prevent AI from clustering
        if (gap < 8 && lateralDiff < 1.5) {
          this.targetLane += (this.lane > 0 ? -0.5 : 0.5);
        }
      }
    }

    if (player) {
      const gap = mod(player.lastS - this.s, 1) * this.track.length;
      if (
        gap < 17 &&
        Math.abs(this.lane - this.track.nearest(player.position).lateral) < 2.4
      ) {
        this.targetLane = this.lane > 0 ? -3.8 : 3.8;
        if (gap < 6) {
          target = Math.min(target, Math.abs(player.speed) * 0.9);
        }
      }
    }

    // Ensure target lane stays within track bounds
    this.targetLane = THREE.MathUtils.clamp(this.targetLane, -4.5, 4.5);

    const accel =
      (target < this.speed
        ? 20 + this.car.spec.braking * 0.32
        : 11 + this.car.spec.accel * 0.14) * fx.accel;
    this.speed = THREE.MathUtils.clamp(
      this.speed + Math.sign(target - this.speed) * accel * dt,
      0,
      Math.max(target, this.speed),
    );
    if (Math.abs(target - this.speed) < accel * dt) this.speed = target;
    
    this.lane = THREE.MathUtils.damp(
      this.lane,
      this.route ? this.targetLane * 0.4 : this.targetLane,
      this.car.spec.kart ? 0.6 + this.car.spec.handling * 0.01 : 1.2,
      dt,
    );
    
    // Clamp lane to prevent going through walls
    this.lane = THREE.MathUtils.clamp(this.lane, -5, 5);
    
    const prevS = this.s;
    this.s = mod(
      this.s +
        (this.speed * dt) /
          (this.route
            ? this.route.length / (this.route.end - this.route.start)
            : this.track.length),
      1,
    );
    
    // Prevent tunneling through checkpoints - ensure s doesn't jump too far
    let deltaS = this.s - prevS;
    if (deltaS > 0.5) deltaS -= 1;
    if (deltaS < -0.5) deltaS += 1;
    if (Math.abs(deltaS) > 0.1) {
      // Too large jump, clamp
      this.s = mod(prevS + Math.sign(deltaS) * 0.1, 1);
    }
    
    const loc =
      this.route && this.s < this.route.end
        ? routeAt(this.route, this.s, this.lane)
        : this.track.at(this.s, this.lane);
    
    if (this.jumpHeight > 0 || this.jumpVelocity > 0) {
      this.jumpVelocity -= dt * 30;
      this.jumpHeight = Math.max(
        0,
        (this.jumpHeight || 0) + this.jumpVelocity * dt,
      );
      if (this.jumpHeight === 0) this.jumpVelocity = 0;
      loc.p.y += this.jumpHeight;
    }
    
    this.car.group.position.copy(loc.p);
    this.car.group.rotation.y =
      loc.yaw + Math.sin(this.time * 1.6 + this.index) * curvature * 0.16;
    this.car.update(
      dt,
      this.speed,
      curvature > 0.12 ? 0.4 : 0,
      target < this.speed - 2,
      this.track.data.night || ["city", "circuit"].includes(this.track.data.id),
    );
    this.progress.update(this.s);
    if (this.progress.finished) this.finishedAt = this.time;
    this.lastS = this.s;
  }
}
