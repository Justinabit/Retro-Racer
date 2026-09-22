import * as THREE from "three";

export class CarPhysics {
  constructor(spec, track, s, lane = 0) {
    this.spec = spec;
    this.track = track;
    const start = track.at(s, lane);
    this.position = start.p.clone();
    this.yaw = start.yaw;
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.steer = 0;
    this.nitro = 1;
    this.drifting = false;
    this.driftScore = 0;
    this.collision = 0;
    this.airVelocity = 0;
    this.groundY = this.position.y;
    this.lastS = s;
    this.offroad = false;
    this.airborne = false;
    this.boosting = false;
    
    // Performance: reuse vectors
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._temp = new THREE.Vector3();
    
    // Stuck detection
    this._stuckTime = 0;
    this._lowSpeedTime = 0;
    this._lastPos = this.position.clone();
    this._invalidGeomTime = 0;
    
    // Fall recovery
    this._fallTime = 0;
  }

  update(dt, input) {
    const c = this.spec;
    const fx = this.kartEffects || { speed: 1, accel: 1, grip: 1 };
    
    if (fx.locked) {
      this.velocity.set(0, 0, 0);
      this.speed = 0;
      return {
        nearest: this.track.nearest(this.position),
        collision: false,
        headingDot: 1,
      };
    }
    
    this.collision = Math.max(0, this.collision - dt * 3);
    this.steer = THREE.MathUtils.damp(
      this.steer,
      input.steer,
      c.kart ? 6 + c.handling * 0.05 : 9,
      dt,
    );
    
    // Reuse forward vector
    const forward = this._forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const speed = this.velocity.dot(forward);
    this.speed = speed;
    
    const max = (47 + c.speed * 0.38) * fx.speed;
    this.boosting =
      input.boost && input.throttle > 0 && this.nitro > 0.015 && speed > 5;
    this.nitro = THREE.MathUtils.clamp(
      this.nitro + dt * (this.boosting ? -0.24 : this.drifting ? 0.09 : 0.025),
      0,
      1,
    );
    this.itemBoosting = fx.speed > 1 && fx.accel > 1;
    
    const acceleration =
      (16 + c.accel * 0.22) * (this.boosting ? 1.7 : 1) * fx.accel;
    const maxSpeed = max * (this.boosting ? 1.25 : 1);
    let drive =
      input.throttle * acceleration * (1 - Math.max(0, speed) / maxSpeed);
    if (input.brake) {
      drive -= speed > 1 ? 22 + c.braking * 0.45 : 10;
    }
    if (speed < -12) drive = Math.max(drive, 6);
    drive -= speed * (this.offroad ? 1.0 : 0.1);
    
    this.velocity.addScaledVector(forward, drive * dt);
    
    const turnRate =
      ((0.58 + c.handling * 0.007) * Math.min(Math.abs(speed) / 13, 1)) /
      (1 + Math.abs(speed) / 95);
    this.drifting =
      input.drift &&
      Math.abs(speed) > (c.kart ? 18 - c.drift * 0.07 : 13) &&
      Math.abs(this.steer) > 0.15;
    this.yaw +=
      this.steer *
      turnRate *
      dt *
      (speed < 0 ? -1 : 1) *
      (this.drifting ? 1.36 : 1);
    
    forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = this._right.set(forward.z, 0, -forward.x);
    const lateral = this.velocity.dot(right);
    const grip =
      (this.drifting ? 1.3 + (100 - c.drift) * 0.015 : 7 + c.handling * 0.06) *
      fx.grip;
    this.velocity.addScaledVector(right, -lateral * Math.min(1, grip * dt));
    if (input.drift) this.velocity.multiplyScalar(1 - 0.1 * dt);
    if (!input.throttle && !input.brake)
      this.velocity.multiplyScalar(1 - 0.12 * dt);
    if (fx.slip)
      this.yaw += Math.sin(this.driftScore + this.position.x) * dt * 0.35;
    
    // Save previous position for CCD
    const prevPos = this._temp.copy(this.position);
    
    this.position.addScaledVector(this.velocity, dt);
    
    // Continuous collision detection for track boundaries to prevent tunneling
    // Check intermediate positions if moving fast
    const moveDist = prevPos.distanceTo(this.position);
    if (moveDist > 2) {
      const steps = Math.ceil(moveDist / 2);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interp = prevPos.clone().lerp(this.position, t);
        const testNearest = this.track.nearest(interp);
        const testLateral = Math.abs(testNearest.lateral);
        const testLimit = testNearest.width ? testNearest.width + 1.4 : 10.65;
        const testOpen = this.track.openEdge(testNearest.s) && testLateral > (testNearest.width || 8.5) + 2;
        
        if (!testOpen && testLateral > testLimit) {
          // Hit wall during movement
          this.position.copy(interp);
          // Correct position
          const side = Math.sign(testNearest.lateral) || 1;
          this.position.addScaledVector(testNearest.n, -(testLateral - testLimit) * side + 0.1);
          this.velocity.addScaledVector(testNearest.n, -this.velocity.dot(testNearest.n) * 1.5);
          this.velocity.multiplyScalar(0.7);
          this.collision = 1;
          break;
        }
      }
    }
    
    const n = this.track.nearest(this.position);
    this.lastS = n.s;
    this.offroad = Math.abs(n.lateral) > (n.width || 8.5);
    
    // Improved falling detection
    const falling =
      this.track.openEdge(n.s) && Math.abs(n.lateral) > (n.width || 8.5) + 2;
    const limit = n.width ? n.width + 1.4 : 10.65;
    let collision = false;
    
    if (!falling && Math.abs(n.lateral) > limit) {
      const side = Math.sign(n.lateral);
      // More robust correction with buffer
      this.position.addScaledVector(n.n, -(Math.abs(n.lateral) - limit) * side - 0.15);
      const impact = this.velocity.dot(n.n) * side;
      if (impact > 0) {
        this.velocity.addScaledVector(n.n, -impact * side * 1.5);
        this.velocity.multiplyScalar(0.75); // More damping to prevent jitter
        this.collision = 1;
        collision = true;
      }
    }
    
    // Ramp collision - check if near ramp and handle height
    let ground = falling ? -1000 : n.route ? n.p.y : this.track.at(n.s).p.y;
    
    // Check for ramp collision (improved)
    if (this.track.data.kart && !falling) {
      // Ramps are at 0.3 and 0.77 - check if close and add ramp height
      const rampPositions = [0.3, 0.77];
      for (const rampS of rampPositions) {
        const distToRamp = Math.abs(n.s - rampS);
        const wrappedDist = Math.min(distToRamp, 1 - distToRamp);
        if (wrappedDist < 0.02) {
          // Near ramp - interpolate ramp height
          const rampLoc = this.track.at(rampS, -3);
          const rampDist = this.position.distanceTo(rampLoc.p);
          if (rampDist < 6) {
            // On ramp - add ramp height (0.55 + slope)
            const slope = (n.s - rampS) * this.track.length;
            if (slope > -4 && slope < 4) {
              const rampHeight = 0.55 + Math.max(0, -slope * 0.14);
              ground = Math.max(ground, rampLoc.p.y + rampHeight);
            }
          }
        }
      }
    }
    
    if (falling) {
      this.airborne = true;
      this.airVelocity = Math.min(this.airVelocity, 0);
      this._fallTime += dt;
    } else {
      this._fallTime = 0;
    }
    
    const rise = (ground - this.groundY) / dt;
    this.groundY = ground;
    if (!falling && this.position.y <= ground + 0.1) {
      if (this.airVelocity - rise > 4 && Math.abs(speed) > 40)
        this.airborne = true;
      else {
        this.position.y = ground;
        this.airVelocity = rise;
        this.airborne = false;
      }
    }
    this.airVelocity -= dt * (22 + Math.abs(speed) * 0.18);
    this.position.y += this.airVelocity * dt;
    if (this.position.y < ground) {
      this.position.y = ground;
      this.airVelocity = 0;
      this.airborne = false;
    }
    
    // Stuck detection (improved)
    const posDelta = this.position.distanceTo(this._lastPos);
    const isTrying = input.throttle > 0.5 || Math.abs(input.steer) > 0.2;
    
    if (Math.abs(speed) < 1.5 && isTrying) {
      this._lowSpeedTime += dt;
      this._stuckTime += dt;
    } else if (Math.abs(speed) > 3 || posDelta > 0.3) {
      this._lowSpeedTime = Math.max(0, this._lowSpeedTime - dt * 2);
      this._stuckTime = Math.max(0, this._stuckTime - dt);
    }
    
    if (n.distance > 25) {
      this._invalidGeomTime += dt;
    } else {
      this._invalidGeomTime = Math.max(0, this._invalidGeomTime - dt);
    }
    
    this._lastPos.copy(this.position);
    
    if (this.drifting)
      this.driftScore +=
        dt * Math.abs(speed) * (c.drift / 65) * (1 + Math.abs(lateral) * 0.06);
    this.speed = this.velocity.dot(forward);
    
    return {
      nearest: n,
      collision,
      headingDot: (this.velocity.lengthSq() > 1
        ? this.velocity.clone().normalize()
        : forward
      ).dot(n.t),
      stuck: {
        isStuck: this._stuckTime > 3,
        shouldRecover: this._stuckTime > 4 || this._invalidGeomTime > 3,
        stuckTime: this._stuckTime,
      },
      falling: {
        isFalling: falling || this._fallTime > 1 || n.distance > 65 || !Number.isFinite(this.position.y),
        openEdge: falling,
      }
    };
  }
  
  // Recovery method
  recover(progress) {
    if (!progress || !this.track) return false;
    
    const checkpoint = Math.max(1, progress.checkpoint - 1);
    const s = (checkpoint - 1) / 12 + 0.003;
    const loc = this.track.at(s);
    
    this.position.copy(loc.p);
    this.position.y += 0.5;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.yaw = loc.yaw;
    this.airVelocity = 0;
    this.groundY = loc.p.y;
    this.airborne = false;
    this.lastS = s;
    
    this._stuckTime = 0;
    this._lowSpeedTime = 0;
    this._invalidGeomTime = 0;
    this._fallTime = 0;
    
    return true;
  }
}
