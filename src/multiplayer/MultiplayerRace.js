import * as THREE from "three";
import { Car } from "../player/Car.js";
import { CarPhysics } from "../player/CarPhysics.js";
import { RaceProgress, rankRacers } from "../track/Track.js";
import { collisionSystem } from "../physics/Collision.js";
import { getCurrentUserId } from "../supabase/auth.js";
import { supabase, isSupabaseConfigured } from "../supabase/client.js";

// Remote player interpolation
class RemotePlayer {
  constructor(id, username, car, spec) {
    this.id = id;
    this.username = username;
    this.car = car;
    this.spec = spec;
    this.position = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.speed = 0;
    this.progress = new RaceProgress(0.008);
    this.finishedAt = null;
    this.lastUpdate = performance.now();
    this.stateBuffer = [];
    this.maxBufferSize = 10;
    this.smoothing = 0.15;
    this.extrapolationTime = 0;
  }

  // Add state to buffer for interpolation
  addState(state) {
    const now = performance.now();
    this.stateBuffer.push({
      ...state,
      timestamp: now,
      receivedAt: now,
    });

    if (this.stateBuffer.length > this.maxBufferSize) {
      this.stateBuffer.shift();
    }

    // Update target
    this.targetPosition.set(state.x, state.y, state.z);
    this.targetYaw = state.yaw;
    this.speed = state.speed || 0;
    this.velocity.set(state.vx || 0, state.vy || 0, state.vz || 0);
    this.lastUpdate = now;
    this.extrapolationTime = 0;
  }

  update(dt) {
    const now = performance.now();
    const timeSinceUpdate = (now - this.lastUpdate) / 1000;

    // If no update for >1s, extrapolate briefly then freeze
    if (timeSinceUpdate > 1.0) {
      this.extrapolationTime += dt;
      if (this.extrapolationTime < 0.5) {
        // Extrapolate
        this.position.addScaledVector(this.velocity, dt);
      }
      // After 0.5s extrapolation, freeze
    } else {
      // Interpolate towards target
      this.position.lerp(this.targetPosition, this.smoothing);
      
      // Yaw interpolation with wrapping
      let yawDiff = this.targetYaw - this.yaw;
      yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
      this.yaw += yawDiff * this.smoothing;
      
      // Update car mesh
      if (this.car && this.car.group) {
        this.car.group.position.copy(this.position);
        this.car.group.rotation.y = this.yaw;
      }
    }

    // Update progress based on position
    // This will be handled by main race manager
  }

  dispose() {
    if (this.car) {
      this.car.dispose();
    }
  }
}

export class MultiplayerRace {
  constructor(game, lobby, players) {
    this.game = game;
    this.lobby = lobby;
    this.playersData = players; // Array of lobby_players with profiles
    this.remotePlayers = new Map();
    this.localPlayerId = getCurrentUserId();
    this.isHost = lobby.host_id === this.localPlayerId;
    this.raceId = null;
    this.broadcastChannel = null;
    this.lastBroadcast = 0;
    this.broadcastInterval = 50; // 20Hz
    this.raceTime = 0;
    this.finishedPlayers = new Map();
    this.powerUpStates = new Map();
    this.isRaceActive = false;
    this.localProgress = null;
    this.localCar = null;
    this.localPhysics = null;
    this.nameTags = new Map();
    this.collisionCooldown = 0;
    
    console.log("[MultiplayerRace] Init with", players.length, "players, lobby:", lobby.code);
  }

  async init() {
    const game = this.game;
    
    // Create local player physics
    const localPlayerData = this.playersData.find(p => p.player_id === this.localPlayerId);
    if (!localPlayerData) {
      throw new Error("Local player not found in lobby");
    }

    // Use selected car/character
    const carSpec = this.getCarSpecForPlayer(localPlayerData);
    
    // Create physics at starting grid position
    const gridIndex = this.playersData.findIndex(p => p.player_id === this.localPlayerId);
    const lane = gridIndex % 2 === 0 ? -3 : 3;
    const s = 0.008 + Math.floor(gridIndex / 2) * 0.006;
    
    this.localPhysics = new CarPhysics(carSpec, game.track, s, lane);
    this.localProgress = new RaceProgress(s);
    this.localCar = game.car; // Reuse existing car mesh
    
    this.localCar.group.position.copy(this.localPhysics.position);
    this.localCar.group.rotation.y = this.localPhysics.yaw;

    // Create remote players
    for (let i = 0; i < this.playersData.length; i++) {
      const pData = this.playersData[i];
      if (pData.player_id === this.localPlayerId) continue; // Skip local

      const spec = this.getCarSpecForPlayer(pData);
      const car = new Car(spec, spec.color, { number: i + 1 }, false);
      game.scene.add(car.group);

      const remoteLane = i % 2 === 0 ? -3 : 3;
      const remoteS = 0.008 + Math.floor(i / 2) * 0.006;
      const start = game.track.at(remoteS, remoteLane);
      
      const remote = new RemotePlayer(pData.player_id, pData.profiles?.username || `Player${i+1}`, car, spec);
      remote.position.copy(start.p);
      remote.yaw = start.yaw;
      remote.targetPosition.copy(start.p);
      remote.targetYaw = start.yaw;
      remote.progress = new RaceProgress(remoteS);
      
      car.group.position.copy(start.p);
      car.group.rotation.y = start.yaw;

      this.remotePlayers.set(pData.player_id, remote);

      // Create name tag
      this.createNameTag(pData.player_id, pData.profiles?.username || `Player${i+1}`, car);
    }

    // Create name tag for local player
    const localProfile = this.playersData.find(p => p.player_id === this.localPlayerId)?.profiles;
    this.createNameTag(this.localPlayerId, localProfile?.username || "You", this.localCar, true);

    // Setup broadcast channel for position sync
    await this.setupBroadcast();

    // Create race session in DB if host
    if (this.isHost && isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from("race_sessions")
          .insert({
            lobby_id: this.lobby.id,
            mode: this.lobby.mode,
            map_id: this.lobby.map_id,
            status: 'racing',
          })
          .select()
          .single();

        if (!error && data) {
          this.raceId = data.id;
          console.log("[MultiplayerRace] Race session created:", this.raceId);
        }
      } catch (e) {
        console.warn("[MultiplayerRace] Failed to create race session:", e);
      }
    }

    this.isRaceActive = true;
    console.log("[MultiplayerRace] Initialized with", this.remotePlayers.size, "remote players");
  }

  getCarSpecForPlayer(playerData) {
    const { CARS } = this.game; // Should be imported, but we have access via game
    // For now, use stored car id to find spec
    // This will be enhanced to use actual CARS data
    const carId = playerData.selected_car || 'gt';
    const charId = playerData.selected_character;
    
    // Import dynamically to avoid circular
    // We'll use a simple mapping for now
    const baseCar = { 
      id: carId, 
      speed: 75, 
      accel: 75, 
      handling: 75, 
      braking: 70, 
      drift: 72, 
      weight: 75,
      color: '#ec593b',
    };

    if (this.lobby.mode === 'kart' && charId) {
      // Combine with character - simplified
      return {
        ...baseCar,
        kart: true,
        character: charId,
        // Character adjustments would go here
      };
    }

    return baseCar;
  }

  createNameTag(playerId, username, car, isLocal = false) {
    // Create canvas-based name tag that faces camera
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    
    // Draw background
    ctx.fillStyle = isLocal ? 'rgba(238, 102, 60, 0.9)' : 'rgba(40, 54, 62, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(username.toUpperCase(), canvas.width / 2, 38);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);
    sprite.position.set(0, 2.5, 0);
    
    car.group.add(sprite);
    
    this.nameTags.set(playerId, { sprite, canvas, texture, username, car });
    
    return sprite;
  }

  updateNameTags() {
    // Make name tags face camera and handle distance culling
    const camera = this.game.camera;
    
    for (const [playerId, tag] of this.nameTags) {
      const carPos = tag.car.group.position;
      const dist = carPos.distanceTo(camera.position);
      
      // Hide if too far
      if (dist > 80) {
        tag.sprite.visible = false;
        continue;
      }
      
      tag.sprite.visible = true;
      
      // Scale with distance
      const scale = Math.max(0.5, Math.min(2, dist * 0.05));
      tag.sprite.scale.set(4 * scale, 1 * scale, 1);
      
      // Face camera is automatic for Sprite
    }
  }

  async setupBroadcast() {
    const { lobbyManager } = await import("./Lobby.js");
    this.broadcastChannel = lobbyManager.getBroadcastChannel();
    
    if (!this.broadcastChannel) {
      console.warn("[MultiplayerRace] No broadcast channel");
      return;
    }

    // Listen for remote player updates
    this.broadcastChannel.on('broadcast', { event: 'player_state' }, (payload) => {
      const { player_id, x, y, z, yaw, speed, vx, vy, vz, timestamp } = payload.payload;
      
      if (player_id === this.localPlayerId) return; // Ignore own
      
      const remote = this.remotePlayers.get(player_id);
      if (remote) {
        remote.addState({ x, y, z, yaw, speed, vx, vy, vz, timestamp });
      }
    });

    // Listen for power-up events
    this.broadcastChannel.on('broadcast', { event: 'powerup_collected' }, (payload) => {
      const { player_id, box_index, item } = payload.payload;
      if (player_id !== this.localPlayerId) {
        this.handleRemotePowerUpCollected(player_id, box_index, item);
      }
    });

    this.broadcastChannel.on('broadcast', { event: 'powerup_used' }, (payload) => {
      const { player_id, item, target } = payload.payload;
      if (player_id !== this.localPlayerId) {
        this.handleRemotePowerUpUsed(player_id, item, target);
      }
    });

    // Listen for finish
    this.broadcastChannel.on('broadcast', { event: 'player_finished' }, (payload) => {
      const { player_id, position, time } = payload.payload;
      if (player_id !== this.localPlayerId) {
        this.handleRemoteFinished(player_id, position, time);
      }
    });

    // Only subscribe now that every listener above is registered —
    // Supabase requires .on() calls to happen before .subscribe(),
    // otherwise they're silently ignored.
    lobbyManager.subscribeBroadcastChannel();

    console.log("[MultiplayerRace] Broadcast channel setup");
  }

  broadcastLocalState() {
    const now = performance.now();
    if (now - this.lastBroadcast < this.broadcastInterval) return;
    
    if (!this.broadcastChannel || !this.localPhysics) return;
    
    const pos = this.localPhysics.position;
    const vel = this.localPhysics.velocity;
    
    this.broadcastChannel.send({
      type: 'broadcast',
      event: 'player_state',
      payload: {
        player_id: this.localPlayerId,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: this.localPhysics.yaw,
        speed: this.localPhysics.speed,
        vx: vel.x,
        vy: vel.y,
        vz: vel.z,
        timestamp: now,
      },
    });

    this.lastBroadcast = now;
  }

  handleRemotePowerUpCollected(playerId, boxIndex, item) {
    console.log(`[MultiplayerRace] Remote ${playerId} collected box ${boxIndex}: ${item}`);
    // Update local power-up state to prevent double collection
    if (this.game.kart) {
      const box = this.game.kart.items.boxes[boxIndex];
      if (box) {
        box.cooldown = 5; // Mark as collected
      }
    }
    this.powerUpStates.set(`box-${boxIndex}`, { collectedBy: playerId, item, time: performance.now() });
  }

  handleRemotePowerUpUsed(playerId, item, target) {
    console.log(`[MultiplayerRace] Remote ${playerId} used ${item}`);
    // Visual effect for remote power-up
    const remote = this.remotePlayers.get(playerId);
    if (remote && this.game.particles) {
      this.game.particles.emit(remote.position, 0x9edfe7, 6);
    }
  }

  handleRemoteFinished(playerId, position, time) {
    console.log(`[MultiplayerRace] Remote ${playerId} finished at ${position} in ${time}`);
    this.finishedPlayers.set(playerId, { position, time });
    
    const remote = this.remotePlayers.get(playerId);
    if (remote) {
      remote.finishedAt = time;
    }
  }

  // Called before physics update
  before(dt) {
    if (!this.isRaceActive) return;

    this.raceTime += dt;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    // Update remote players interpolation
    for (const remote of this.remotePlayers.values()) {
      remote.update(dt);
    }

    // Update name tags
    this.updateNameTags();

    // Check collisions between all human players
    this.checkMultiplayerCollisions(dt);

    // Handle kart logic if applicable
    this.game.kart?.before(dt);
  }

  checkMultiplayerCollisions(dt) {
    const local = {
      position: this.localPhysics.position,
      velocity: this.localPhysics.velocity,
      spec: this.localPhysics.spec,
      id: this.localPlayerId,
    };

    // Local-vs-remote: use the same mass/restitution-aware resolver the
    // rest of the game uses (collisionSystem), instead of a fixed magic
    // push velocity. We only ever move/impulse OUR OWN car here — each
    // remote player's position is authoritative on its own client and
    // will simply overwrite anything we touch on its next network update
    // (~50ms), so mutating it is a short-lived cosmetic nudge, not a
    // source of desync.
    if (this.collisionCooldown <= 0) {
      for (const remote of this.remotePlayers.values()) {
        const other = { position: remote.position, velocity: remote.velocity, spec: remote.spec, id: remote.id };
        const collision = collisionSystem.checkVehicleCollision(local, other);
        if (!collision.colliding) continue;

        const normal = collision.normal.clone();
        normal.y = 0;
        if (normal.lengthSq() < 0.001) normal.set(1, 0, 0);
        normal.normalize();

        const massLocal = local.spec?.weight || 75;
        const massOther = other.spec?.weight || 75;
        const totalMass = massLocal + massOther;

        // Positional correction, proportional to the other car's mass
        local.position.addScaledVector(normal, collision.penetration * (massOther / totalMass) + 0.05);

        // Velocity impulse along the collision normal, scaled by relative
        // closing speed so a glancing touch is soft and a head-on hit is
        // punishing - instead of always applying the same fixed bump.
        const relVel = local.velocity.clone().sub(other.velocity || new THREE.Vector3());
        const velAlongNormal = relVel.dot(normal);
        if (velAlongNormal < 0) {
          const restitution = 0.25;
          const impulse = -(1 + restitution) * velAlongNormal * (massOther / totalMass);
          local.velocity.addScaledVector(normal, impulse);
          local.velocity.multiplyScalar(0.88);
          // Give the other car's visual a matching kick for the instant
          // before its own update overwrites it, so the hit reads as a
          // two-sided bump rather than local bouncing off a static wall.
          if (other.velocity) {
            other.velocity.addScaledVector(normal, -impulse * (massLocal / massOther));
          }
        }

        this.localPhysics.collision = 1;
        this.game.audio.tone(65, 0.12, 0.18, "sawtooth");
        this.collisionCooldown = 0.35;
        break; // resolve one hit per tick; the cooldown covers the rest
      }
    }

    // Remote-vs-remote: purely cosmetic declutter so two other players'
    // cars don't visibly clip through each other on THIS client's screen.
    // Position-only, no velocity/audio - each remote's own client stays
    // authoritative over its real position and will correct this on its
    // next broadcast anyway.
    const remoteList = Array.from(this.remotePlayers.values());
    for (let i = 0; i < remoteList.length; i++) {
      for (let j = i + 1; j < remoteList.length; j++) {
        const a = remoteList[i], b = remoteList[j];
        const dist = a.position.distanceTo(b.position);
        if (dist < 2.2 && dist > 0.001) {
          const normal = a.position.clone().sub(b.position);
          normal.y = 0;
          normal.normalize();
          const push = (2.2 - dist) * 0.5;
          a.position.addScaledVector(normal, push);
          b.position.addScaledVector(normal, -push);
        }
      }
    }

    // Track boundary for local player
    const boundary = collisionSystem.checkTrackBoundary(this.localPhysics.position, this.game.track);
    if (boundary.colliding) {
      collisionSystem.resolveTrackBoundary(this.localPhysics, boundary);
    }
  }

  // Called after physics
  after(dt) {
    if (!this.isRaceActive) return;

    // Broadcast local state
    this.broadcastLocalState();

    // Update kart after logic (pads, ramps, hazards, etc)
    // Need to handle for all players, not just local
    this.game.kart?.after(dt);

    // Check for finish
    if (this.localProgress.finished && !this.finishedPlayers.has(this.localPlayerId)) {
      const position = this.calculatePosition();
      const time = this.raceTime;
      
      this.finishedPlayers.set(this.localPlayerId, { position, time });
      
      // Broadcast finish
      if (this.broadcastChannel) {
        this.broadcastChannel.send({
          type: 'broadcast',
          event: 'player_finished',
          payload: {
            player_id: this.localPlayerId,
            position,
            time,
          },
        });
      }

      // Save result if host
      if (this.raceId && isSupabaseConfigured()) {
        supabase.from("race_results").insert({
          race_id: this.raceId,
          player_id: this.localPlayerId,
          finishing_position: position,
          finish_time: time,
        }).then(({ error }) => {
          if (error) console.warn("[MultiplayerRace] Failed to save result:", error);
        });
      }

      // If all finished, end race
      if (this.finishedPlayers.size === this.playersData.length) {
        this.finishRace();
      }
    }

    // Check if all remote finished
    if (this.finishedPlayers.size === this.playersData.length && this.isRaceActive) {
      this.finishRace();
    }
  }

  calculatePosition() {
    const allRacers = [
      {
        id: this.localPlayerId,
        progress: this.localProgress.total,
        finishedAt: this.finishedPlayers.get(this.localPlayerId)?.time || null,
        player: true,
      },
      ...Array.from(this.remotePlayers.values()).map(r => ({
        id: r.id,
        progress: r.progress.total,
        finishedAt: r.finishedAt,
        player: false,
      }))
    ];

    const ranked = rankRacers(allRacers);
    return ranked.findIndex(r => r.id === this.localPlayerId) + 1;
  }

  getPositions() {
    const allRacers = [
      {
        id: this.localPlayerId,
        username: this.playersData.find(p => p.player_id === this.localPlayerId)?.profiles?.username || "You",
        progress: this.localProgress.total,
        finishedAt: this.finishedPlayers.get(this.localPlayerId)?.time || null,
        isLocal: true,
      },
      ...Array.from(this.remotePlayers.values()).map(r => ({
        id: r.id,
        username: r.username,
        progress: r.progress.total,
        finishedAt: r.finishedAt,
        isLocal: false,
      }))
    ];

    return rankRacers(allRacers);
  }

  finishRace() {
    if (!this.isRaceActive) return;
    
    this.isRaceActive = false;
    console.log("[MultiplayerRace] Race finished");

    const positions = this.getPositions();
    const localPos = positions.findIndex(p => p.id === this.localPlayerId) + 1;

    // Build result
    this.game.result = {
      position: localPos,
      time: this.raceTime,
      bestLap: this.game.bestLap,
      score: Math.round((9 - localPos) * 1800 + Math.max(0, 60000 - this.raceTime * 100)),
      drift: Math.floor(this.localPhysics.driftScore),
      overtakes: this.game.overtakes,
      unlocks: [],
      tokens: this.game.kart?.racers[0]?.tokens || 0,
      kartStats: this.game.kart ? { ...this.game.kart.stats, items: this.game.kart.racers[0].uses } : null,
      multiplayer: true,
      positions: positions.map((p, idx) => ({
        position: idx + 1,
        username: p.username,
        time: p.finishedAt,
        isLocal: p.isLocal,
      })),
    };

    this.game.audio.finish();
    this.game.setState("RESULTS");

    // Update lobby status to finished if host
    if (this.isHost && isSupabaseConfigured()) {
      supabase.from("lobbies").update({ status: 'finished' }).eq("id", this.lobby.id).then();
      if (this.raceId) {
        supabase.from("race_sessions").update({ 
          status: 'finished', 
          finished_at: new Date().toISOString() 
        }).eq("id", this.raceId).then();
      }
    } else if (this.isHost) {
      // Mock mode
      const { lobbyManager } = require("./Lobby.js");
      // Would update mock lobby
    }
  }

  dispose() {
    this.isRaceActive = false;
    
    for (const remote of this.remotePlayers.values()) {
      this.game.scene.remove(remote.car.group);
      remote.dispose();
    }
    this.remotePlayers.clear();

    for (const tag of this.nameTags.values()) {
      if (tag.sprite) {
        tag.car.group.remove(tag.sprite);
        tag.texture.dispose();
      }
    }
    this.nameTags.clear();

    if (this.broadcastChannel) {
      // Don't remove channel entirely, just unsubscribe from events
      // Channel is managed by LobbyManager
      this.broadcastChannel = null;
    }

    console.log("[MultiplayerRace] Disposed");
  }

  // Handle player disconnect during race
  handlePlayerDisconnect(playerId) {
    console.log(`[MultiplayerRace] Player ${playerId} disconnected`);
    
    const remote = this.remotePlayers.get(playerId);
    if (remote) {
      // Freeze or remove vehicle
      remote.velocity.set(0, 0, 0);
      // Optionally hide or mark as disconnected
      // For now, keep visible but frozen
    }

    // If host disconnects during race, race continues (no host migration during race)
    // Host migration only happens in lobby
  }

  // Handle reconnection
  handlePlayerReconnect(playerId, newState) {
    console.log(`[MultiplayerRace] Player ${playerId} reconnected`);
    const remote = this.remotePlayers.get(playerId);
    if (remote && newState) {
      remote.addState(newState);
    }
  }
}