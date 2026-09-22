import * as THREE from "three";

// Improved collision system with broad-phase and narrow-phase
// Fixes no-clip bugs, tunneling, and vehicle overlap

export class CollisionSystem {
  constructor() {
    this.colliders = [];
    this.vehicleColliders = [];
    this.staticColliders = [];
    this.broadPhaseCache = new Map();
    this.lastUpdate = 0;
  }

  // Register a static collider (wall, building, ramp, etc)
  addStaticCollider(collider) {
    // collider: { position: Vector3, radius: number, type: 'box'|'sphere'|'capsule', size: Vector3, etc }
    this.staticColliders.push(collider);
    this.colliders.push(collider);
  }

  // Register vehicle collider
  addVehicleCollider(vehicle) {
    this.vehicleColliders.push(vehicle);
    this.colliders.push(vehicle);
  }

  removeCollider(collider) {
    const idx = this.colliders.indexOf(collider);
    if (idx >= 0) this.colliders.splice(idx, 1);
    
    const vIdx = this.vehicleColliders.indexOf(collider);
    if (vIdx >= 0) this.vehicleColliders.splice(vIdx, 1);
    
    const sIdx = this.staticColliders.indexOf(collider);
    if (sIdx >= 0) this.staticColliders.splice(sIdx, 1);
  }

  clear() {
    this.colliders = [];
    this.vehicleColliders = [];
    this.staticColliders = [];
    this.broadPhaseCache.clear();
  }

  // Broad-phase: quick distance check
  broadPhase(a, b, maxDist = 15) {
    const key = `${a.id}-${b.id}`;
    const cached = this.broadPhaseCache.get(key);
    const now = performance.now();
    
    // Cache for 100ms
    if (cached && now - cached.time < 100) {
      return cached.result;
    }

    const dist = a.position.distanceTo(b.position);
    const result = dist < maxDist;
    
    this.broadPhaseCache.set(key, { result, time: now, dist });
    return result;
  }

  // Narrow-phase vehicle vs vehicle with robust separation
  checkVehicleCollision(vehicleA, vehicleB) {
    const posA = vehicleA.position;
    const posB = vehicleB.position;
    
    const diff = posA.clone().sub(posB);
    const dist = diff.length();
    const minSeparation = 2.2; // Minimum distance between vehicles
    
    if (dist >= minSeparation) {
      return { colliding: false, distance: dist };
    }

    // Prevent division by zero
    if (dist < 0.001) {
      diff.set(1, 0, 0);
    } else {
      diff.normalize();
    }

    // Calculate penetration
    const penetration = minSeparation - dist;
    
    return {
      colliding: true,
      distance: dist,
      penetration,
      normal: diff.clone(), // From B to A
      normalB: diff.clone().negate(), // From A to B
    };
  }

  // Resolve vehicle collision with positional and velocity correction
  resolveVehicleCollision(vehicleA, vehicleB, collision) {
    if (!collision.colliding) return false;

    const { penetration, normal } = collision;
    
    // Positional correction - separate vehicles
    // Use mass ratio if available, otherwise 50/50
    const massA = vehicleA.spec?.weight || 75;
    const massB = vehicleB.spec?.weight || 75;
    const totalMass = massA + massB;
    const ratioA = massB / totalMass; // Lighter gets pushed more
    const ratioB = massA / totalMass;
    
    // Add small buffer to prevent sticking
    const separationBuffer = 0.05;
    const correctionA = penetration * ratioA + separationBuffer;
    const correctionB = penetration * ratioB + separationBuffer;
    
    vehicleA.position.addScaledVector(normal, correctionA);
    vehicleB.position.addScaledVector(normal, -correctionB);

    // Velocity correction
    if (vehicleA.velocity && vehicleB.velocity) {
      const velA = vehicleA.velocity;
      const velB = vehicleB.velocity;
      
      // Relative velocity along normal
      const relVel = velA.clone().sub(velB);
      const velAlongNormal = relVel.dot(normal);
      
      // Don't resolve if velocities are separating
      if (velAlongNormal > 0) {
        return true; // Still colliding but moving apart
      }
      
      // Restitution (bounciness) - low for cars
      const restitution = 0.2;
      
      // Impulse scalar
      const impulse = -(1 + restitution) * velAlongNormal;
      const impulseScalar = impulse / 2; // Split between two vehicles
      
      // Apply impulse with mass consideration
      const impulseA = normal.clone().multiplyScalar(impulseScalar * (massB / totalMass) * 2);
      const impulseB = normal.clone().multiplyScalar(-impulseScalar * (massA / totalMass) * 2);
      
      velA.add(impulseA);
      velB.add(impulseB);
      
      // Damping to prevent jitter
      velA.multiplyScalar(0.92);
      velB.multiplyScalar(0.92);
      
      // Prevent excessive velocity
      const maxVel = 80;
      if (velA.length() > maxVel) {
        velA.normalize().multiplyScalar(maxVel);
      }
      if (velB.length() > maxVel) {
        velB.normalize().multiplyScalar(maxVel);
      }
    } else if (vehicleA.velocity) {
      // Only A has velocity (e.g., AI)
      const impact = vehicleA.velocity.dot(normal);
      if (impact < 0) {
        vehicleA.velocity.addScaledVector(normal, -impact * 1.5);
        vehicleA.velocity.multiplyScalar(0.82);
      }
    } else if (vehicleB.velocity) {
      const impact = vehicleB.velocity.dot(normal.clone().negate());
      if (impact < 0) {
        vehicleB.velocity.addScaledVector(normal, impact * 1.5);
        vehicleB.velocity.multiplyScalar(0.82);
      }
    }

    return true;
  }

  // Check track boundary collision with improved logic
  checkTrackBoundary(position, track, options = {}) {
    const nearest = track.nearest(position);
    const lateral = Math.abs(nearest.lateral);
    const width = nearest.width || 8.5;
    const isOpenEdge = track.openEdge && track.openEdge(nearest.s);
    
    // If open edge (e.g., Sky Island), allow falling but detect it
    if (isOpenEdge && lateral > width + 2) {
      return {
        colliding: false,
        falling: true,
        nearest,
        lateral,
        distance: nearest.distance,
      };
    }
    
    const limit = options.hardLimit || (width + 1.4);
    const softLimit = options.softLimit || width;
    
    if (lateral > limit) {
      const side = Math.sign(nearest.lateral) || 1;
      const penetration = lateral - limit;
      
      return {
        colliding: true,
        penetration,
        side,
        nearest,
        lateral,
        normal: nearest.n.clone().multiplyScalar(-side),
        isHardBoundary: true,
      };
    } else if (lateral > softLimit) {
      // Soft boundary - offroad but not colliding
      return {
        colliding: false,
        offroad: true,
        nearest,
        lateral,
        softPenetration: lateral - softLimit,
      };
    }
    
    return {
      colliding: false,
      nearest,
      lateral,
      offroad: false,
    };
  }

  // Resolve track boundary with positional correction and velocity damping
  resolveTrackBoundary(vehicle, boundary) {
    if (!boundary.colliding) return false;

    const { penetration, side, normal, nearest } = boundary;
    
    // Positional correction
    vehicle.position.addScaledVector(normal, penetration + 0.1);
    
    // Velocity correction - remove velocity into wall
    if (vehicle.velocity) {
      const velIntoWall = vehicle.velocity.dot(normal) * -1;
      if (velIntoWall < 0) { // Moving into wall
        vehicle.velocity.addScaledVector(normal, velIntoWall * 1.5);
        vehicle.velocity.multiplyScalar(0.82);
        
        // Add collision flag
        vehicle.collision = 1;
      }
    }

    return true;
  }

  // Continuous collision detection for fast-moving vehicles (prevent tunneling)
  checkContinuousCollision(prevPos, currPos, track, steps = 3) {
    const collisions = [];
    
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const interpPos = prevPos.clone().lerp(currPos, t);
      const boundary = this.checkTrackBoundary(interpPos, track);
      
      if (boundary.colliding) {
        collisions.push({
          t,
          position: interpPos.clone(),
          boundary,
        });
        break; // First collision
      }
    }
    
    return collisions.length > 0 ? collisions[0] : null;
  }

  // Stuck detection
  checkStuck(vehicle, input, dt) {
    const speed = Math.abs(vehicle.speed || vehicle.velocity?.length() || 0);
    const isTryingToMove = input && (input.throttle > 0.5 || Math.abs(input.steer) > 0.3);
    
    if (!vehicle._stuckData) {
      vehicle._stuckData = {
        stuckTime: 0,
        lastPosition: vehicle.position.clone(),
        lowSpeedTime: 0,
        invalidGeometryTime: 0,
      };
    }
    
    const data = vehicle._stuckData;
    const posDelta = vehicle.position.distanceTo(data.lastPosition);
    
    // Check if barely moving while trying to move
    if (speed < 1.0 && isTryingToMove) {
      data.lowSpeedTime += dt;
      data.stuckTime += dt;
    } else if (speed > 3.0 || posDelta > 0.5) {
      // Moving - reset
      data.lowSpeedTime = 0;
      data.stuckTime = Math.max(0, data.stuckTime - dt * 2);
    }
    
    // Check if in invalid geometry (far from track)
    const nearest = vehicle.track?.nearest ? vehicle.track.nearest(vehicle.position) : null;
    if (nearest && nearest.distance > 20) {
      data.invalidGeometryTime += dt;
    } else {
      data.invalidGeometryTime = 0;
    }
    
    data.lastPosition.copy(vehicle.position);
    
    return {
      isStuck: data.stuckTime > 3.0 || data.invalidGeometryTime > 2.0,
      stuckTime: data.stuckTime,
      lowSpeedTime: data.lowSpeedTime,
      invalidGeometryTime: data.invalidGeometryTime,
      shouldRecover: data.stuckTime > 4.0 || data.invalidGeometryTime > 3.0,
    };
  }

  // Fall detection
  checkFall(vehicle, track) {
    if (!track) return { isFalling: false };
    
    const nearest = track.nearest(vehicle.position);
    const y = vehicle.position.y;
    const groundY = nearest.p.y;
    
    // Check if below track
    const belowThreshold = groundY - 16;
    const isBelow = y < belowThreshold || !Number.isFinite(y);
    const isFar = nearest.distance > 65;
    
    // Check open edge falling
    const isOpenEdge = track.openEdge && track.openEdge(nearest.s);
    const isOffOpenEdge = isOpenEdge && Math.abs(nearest.lateral) > (nearest.width || 8.5) + 2;
    
    return {
      isFalling: isBelow || isFar || isOffOpenEdge,
      isBelow,
      isFar,
      isOffOpenEdge,
      nearest,
      groundY,
      y,
    };
  }

  // Recovery - move to last valid checkpoint
  recoverToCheckpoint(vehicle, progress, track) {
    if (!progress || !track) return false;

    const checkpoint = Math.max(1, progress.checkpoint - 1);
    const s = (checkpoint - 1) / 12 + 0.003;
    const loc = track.at(s);
    
    vehicle.position.copy(loc.p);
    vehicle.position.y += 0.5; // Slightly above ground
    
    if (vehicle.velocity) {
      vehicle.velocity.set(0, 0, 0);
    }
    
    vehicle.speed = 0;
    vehicle.yaw = loc.yaw;
    
    if (vehicle.airVelocity !== undefined) {
      vehicle.airVelocity = 0;
      vehicle.groundY = loc.p.y;
      vehicle.airborne = false;
    }
    
    // Reset stuck data
    if (vehicle._stuckData) {
      vehicle._stuckData.stuckTime = 0;
      vehicle._stuckData.lowSpeedTime = 0;
      vehicle._stuckData.invalidGeometryTime = 0;
    }
    
    // Set recovery lock
    vehicle._recoveryLock = 2.0; // 2 seconds
    vehicle._immune = 3.0;
    
    console.log(`[Collision] Recovered to checkpoint ${checkpoint} at s=${s.toFixed(3)}`);
    
    return true;
  }

  // Update all collisions (broad-phase then narrow-phase)
  update(dt, vehicles, track) {
    const now = performance.now();
    
    // Clear broad-phase cache periodically
    if (now - this.lastUpdate > 5000) {
      this.broadPhaseCache.clear();
      this.lastUpdate = now;
    }
    
    const collisions = [];
    
    // Vehicle vs vehicle
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const a = vehicles[i];
        const b = vehicles[j];
        
        if (!this.broadPhase(a, b, 10)) continue;
        
        const collision = this.checkVehicleCollision(a, b);
        if (collision.colliding) {
          collisions.push({ type: 'vehicle', a, b, collision });
          this.resolveVehicleCollision(a, b, collision);
        }
      }
    }
    
    // Vehicle vs track boundary
    if (track) {
      for (const vehicle of vehicles) {
        const boundary = this.checkTrackBoundary(vehicle.position, track);
        if (boundary.colliding) {
          collisions.push({ type: 'boundary', vehicle, boundary });
          this.resolveTrackBoundary(vehicle, boundary);
        }
      }
    }
    
    return collisions;
  }

  // Performance: clear cache
  clearCache() {
    this.broadPhaseCache.clear();
  }
}

// Singleton instance
export const collisionSystem = new CollisionSystem();

// Helper function for quick vehicle separation (used in Game.js)
export function separateVehicles(vehicles, minSeparation = 2.2) {
  let separated = 0;
  
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      
      const posA = a.position || a.car?.group?.position || a.physics?.position;
      const posB = b.position || b.car?.group?.position || b.physics?.position;
      
      if (!posA || !posB) continue;
      
      const diff = posA.clone().sub(posB);
      const dist = diff.length();
      
      if (dist < minSeparation && dist > 0.001) {
        diff.normalize();
        const penetration = minSeparation - dist;
        
        // 50/50 separation
        posA.addScaledVector(diff, penetration * 0.5 + 0.05);
        posB.addScaledVector(diff, -penetration * 0.5 - 0.05);
        
        // Velocity damping
        if (a.velocity) a.velocity.multiplyScalar(0.9);
        if (b.velocity) b.velocity.multiplyScalar(0.9);
        if (a.physics?.velocity) a.physics.velocity.multiplyScalar(0.9);
        if (b.physics?.velocity) b.physics.velocity.multiplyScalar(0.9);
        
        separated++;
      } else if (dist < 0.001) {
        // Complete overlap - force separation
        posA.x += 1.5;
        posB.x -= 1.5;
        separated++;
      }
    }
  }
  
  return separated;
}
