import * as THREE from "three";
import { Car } from "../player/Car.js";
import { CarPhysics } from "../player/CarPhysics.js";
import { RaceProgress, rankRacers } from "../track/Track.js";
import { collisionSystem } from "../physics/Collision.js";
import { getCurrentUserId } from "../supabase/auth.js";
import { supabase, isSupabaseConfigured } from "../supabase/client.js";

import { CARS } from "../data.js";
import { CHARACTERS, combineStats } from "../kart/data.js";
import {
  NETWORK,
  SnapshotBuffer,
  validState,
  meaningfulChange,
} from "./NetworkState.js";
import { RaceTransport } from "./RaceTransport.js";
import { serverClock } from "./Clock.js";
import { lobbyManager } from "./Lobby.js";

export class RemotePlayer {
  constructor(id, username, car, spec) {
    Object.assign(this, { id, username, car, spec });
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.progress = new RaceProgress();
    this.finishedAt = null;
    this.buffer = new SnapshotBuffer();
    this.sample = {};
    this.target = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, "YXZ");
    this.connected = true;
  }
  addState(state) {
    if (!this.buffer.push(state, performance.now())) return false;
    // Ranking uses received progress, never a lap inferred from delayed visuals.
    Object.assign(this.progress, {
      lap: state.lap,
      checkpoint: state.checkpoint,
      total: state.progress,
      finished: state.finishTime !== null,
    });
    this.finishedAt ??= state.finishTime;
    if (this.finishedAt !== null) {
      this.progress.finished = true;
      this.progress.total = 3;
    }
    this.connected = true;
    return true;
  }
  update(dt) {
    const s = this.buffer.sample(performance.now(), this.sample);
    if (!s) return;
    this.target.set(s.x, s.y, s.z);
    const snap =
      this.position.distanceToSquared(this.target) > NETWORK.snap ** 2;
    const alpha = snap ? 1 : 1 - Math.exp(-30 * dt);
    this.position.lerp(this.target, alpha);
    this.velocity.set(s.vx, s.vy, s.vz);
    this.quaternion.setFromEuler(this.euler.set(s.pitch, s.yaw, s.roll, "YXZ"));
    this.car.group.quaternion.slerp(this.quaternion, alpha);
    this.yaw = s.yaw;
    this.speed = s.speed;
    // Always apply, including bounded prediction and stale states.
    this.car.group.position.copy(this.position);
    this.car.update(dt, s.speed, s.steer, s.braking);
  }
  dispose() {
    this.buffer.clear();
    this.car.dispose();
  }
}

export class MultiplayerRace {
  constructor(game, lobby, players) {
    this.game = game;
    this.lobby = lobby;
    this.playersData = players; // Array of lobby_players with profiles
    this.remotePlayers = new Map();
    this.departedPlayers = new Map();
    this.createdAt = performance.now();
    this.eventAcks = new Map();
    this.localPlayerId = getCurrentUserId();
    this.isHost = lobby.host_id === this.localPlayerId;
    this.raceId = lobby.race_id || `${lobby.id}:${lobby.race_start_at}`;
    this.lastBroadcast = 0;
    this.lastNetworkSample = 0;
    this.broadcastInterval = 1000 / NETWORK.rate;
    this.sequence = 0;
    this.connectionStatus = "CONNECTING";
    this.invalidPackets = 0;
    this.disposed = false;
    this.lastResultSync = 0;
    this.pendingEvents = [];
    this.seenEvents = new Map();
    this.raceTime = 0;
    this.finishedPlayers = new Map();
    this.isRaceActive = false;
    this.localProgress = null;
    this.localCar = null;
    this.localPhysics = null;
    this.nameTags = new Map();
    this.collisionCooldown = 0;

    console.log(
      "[MultiplayerRace] Init with",
      players.length,
      "players, lobby:",
      lobby.code,
    );
  }

  async init() {
    const game = this.game;

    // Create local player physics
    const localPlayerData = this.playersData.find(
      (p) => p.player_id === this.localPlayerId,
    );
    if (!localPlayerData) {
      throw new Error("Local player not found in lobby");
    }

    // Use selected car/character
    const carSpec = this.getCarSpecForPlayer(localPlayerData);

    // Create physics at starting grid position
    const gridIndex = this.playersData.findIndex(
      (p) => p.player_id === this.localPlayerId,
    );
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

      const remote = new RemotePlayer(
        pData.player_id,
        pData.profiles?.username || `Player${i + 1}`,
        car,
        spec,
      );
      remote.position.copy(start.p);
      remote.yaw = start.yaw;
      remote.progress = new RaceProgress(remoteS);

      car.group.position.copy(start.p);
      car.group.rotation.y = start.yaw;

      this.remotePlayers.set(pData.player_id, remote);

      // Create name tag
      this.createNameTag(
        pData.player_id,
        pData.profiles?.username || `Player${i + 1}`,
        car,
      );
    }

    // Create name tag for local player
    const localProfile = this.playersData.find(
      (p) => p.player_id === this.localPlayerId,
    )?.profiles;
    this.createNameTag(
      this.localPlayerId,
      localProfile?.username || "You",
      this.localCar,
      true,
    );

    // Setup broadcast channel for position sync
    await this.setupBroadcast();

    this.offPlayers = lobbyManager.on("playersUpdated", (players) => {
      const ids = new Set(players.map((p) => p.player_id));
      for (const id of this.remotePlayers.keys())
        if (!ids.has(id)) this.removeRemote(id);
    });
    if (this.disposed) return;
    this.isRaceActive = true;
    console.log(
      "[MultiplayerRace] Initialized with",
      this.remotePlayers.size,
      "remote players",
    );
  }

  getCarSpecForPlayer(playerData) {
    const car = CARS.find((c) => c.id === playerData.selected_car) || CARS[0];
    if (this.lobby.mode !== "kart") return car;
    const character =
      CHARACTERS.find((c) => c.id === playerData.selected_character) ||
      CHARACTERS[0];
    return combineStats(car, character);
  }

  createNameTag(playerId, username, car, isLocal = false) {
    // Create canvas-based name tag that faces camera
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;

    // Draw background
    ctx.fillStyle = isLocal
      ? "rgba(238, 102, 60, 0.9)"
      : "rgba(40, 54, 62, 0.85)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw text
    ctx.fillStyle = "#fff";
    ctx.font = 'bold 24px "Barlow Condensed", sans-serif';
    ctx.textAlign = "center";
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
    if (this.transport || this.disposed) return;
    this.transport = new RaceTransport({
      raceId: this.raceId,
      playerId: this.localPlayerId,
      client: supabase,
      online: isSupabaseConfigured(),
      verbose:
        import.meta.env.DEV && import.meta.env.VITE_NETWORK_LOG === "true",
      members: this.playersData.map((p) => p.player_id),
      receive: (id, state) => {
        const remote = this.remotePlayers.get(id);
        if (!remote || !validState(state, id, this.raceId)) {
          this.invalidPackets++;
          return;
        }
        if (!remote.addState(state)) return;
        if (state.finishTime !== null)
          this.handleRemoteFinished(id, 0, state.finishTime);
        this.receiveEvents(id, state.events);
        const kart = this.game.kart?.racers.find((r) => r.networkId === id);
        if (kart && state.kart) {
          for (const key of ["shield", "boost", "turbo", "magnet"])
            kart[key] = state.kart[key];
        }
        const ack = state.eventAcks?.[this.localPlayerId];
        if (
          Number.isSafeInteger(ack) &&
          ack >= 0 &&
          ack <= (this.eventSequence || 0)
        )
          this.eventAcks.set(id, ack);
      },
      presence: (id, connected) => {
        const remote = this.remotePlayers.get(id);
        if (remote) remote.connected = connected;
      },
      status: (status) => {
        this.connectionStatus = status;
        this.lastBroadcast = 0;
      },
    });
    this.transport.start();
    this.indicator = document.createElement("div");
    this.indicator.className = "race-connection";
    this.indicator.setAttribute("role", "status");
    document.body.append(this.indicator);
    if (import.meta.env.DEV && import.meta.env.VITE_NETWORK_DEBUG === "true") {
      this.debugPanel = document.createElement("pre");
      this.debugPanel.className = "network-debug";
      document.body.append(this.debugPanel);
    }
  }

  broadcastLocalState() {
    const now = performance.now();
    if (
      now - this.lastNetworkSample < this.broadcastInterval ||
      !this.localPhysics ||
      this.disposed
    )
      return;
    this.lastNetworkSample = now;
    if (this.transport?.busy) return;
    const p = this.localPhysics,
      pos = p.position,
      vel = p.velocity;
    const input = this.game.input.controls;
    this.pendingEvents = this.pendingEvents.filter(
      (e) =>
        now - e.timestamp < 5000 &&
        ![...this.remotePlayers.keys()].every(
          (id) => (this.eventAcks.get(id) || 0) >= e.id,
        ),
    );
    const state = {
      type: "player_state",
      playerId: this.localPlayerId,
      raceId: this.raceId,
      sequence: this.sequence,
      timestamp: now,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: p.yaw,
      pitch: 0,
      roll: 0,
      vx: vel.x,
      vy: p.airborne ? p.airVelocity : 0,
      vz: vel.z,
      speed: p.speed,
      steer: p.steer,
      accelerating: input.throttle > 0,
      braking: !!input.brake,
      drifting: !!p.drifting,
      boosting: !!(p.boosting || p.itemBoosting),
      lap: this.localProgress.lap,
      checkpoint: this.localProgress.checkpoint,
      progress: this.localProgress.total,
      finishTime: this.finishedPlayers.get(this.localPlayerId)?.time ?? null,
      kart: this.game.kart
        ? Object.fromEntries(
            ["shield", "boost", "turbo", "magnet"].map((key) => [
              key,
              this.game.kart.racers[0][key],
            ]),
          )
        : null,
      events: this.pendingEvents,
      eventAcks: Object.fromEntries(this.seenEvents),
    };
    if (!validState(state, this.localPlayerId, this.raceId)) return;
    if (
      now - this.lastBroadcast < NETWORK.heartbeat &&
      !state.events.length &&
      !meaningfulChange(this.lastSent, state)
    )
      return;
    if (this.transport?.send(state)) {
      this.sequence++;
      this.lastBroadcast = now;
      this.lastSent = state;
    }
  }

  // Important transient events are repeated in a bounded five-second journal,
  // deduplicated on receipt. Durable finishes have a separate DB retry path.
  queueEvent(event) {
    this.pendingEvents.push({
      ...event,
      id: (this.eventSequence = (this.eventSequence || 0) + 1),
      timestamp: performance.now(),
    });
    if (this.pendingEvents.length > 16) this.pendingEvents.shift();
  }
  receiveEvents(id, events) {
    if (!Array.isArray(events) || events.length > 16) return;
    for (const e of events) {
      if (
        !e ||
        !Number.isSafeInteger(e.id) ||
        e.id <= (this.seenEvents.get(id) || 0)
      )
        continue;
      this.seenEvents.set(id, e.id);
      if (
        e.type === "pickup" &&
        Number.isInteger(e.box) &&
        e.box >= 0 &&
        e.box < 24
      )
        this.handleRemotePowerUpCollected(id, e.box, e.item);
      if (e.type === "use")
        this.game.kart?.remoteActivate(id, e.item, e.target);
    }
  }

  networkFrame(dt) {
    if (this.disposed) return;
    for (const remote of this.remotePlayers.values()) remote.update(dt);
    this.updateNameTags();
    this.broadcastLocalState();
    const now = performance.now();
    // Presence leaves may be transient. Keep the vehicle through a 30s grace,
    // then remove scene/buffer resources and retain a DNF entry in standings.
    for (const [id, remote] of this.remotePlayers) {
      if (this.connectionStatus !== "CONNECTED") continue;
      if (now - Math.max(remote.buffer.lastReceived, this.createdAt) > 30000)
        this.removeRemote(id);
    }
    if (now - this.lastResultSync > 3000) {
      this.lastResultSync = now;
      void this.syncResults();
    }
    if (now - (this.lastDebug || 0) < 500) return;
    const span = (now - (this.lastDebug || now - 500)) / 1000;
    this.lastDebug = now;
    if (this.indicator)
      this.indicator.textContent = `● ${this.connectionStatus}`;
    if (this.debugPanel) {
      const t = this.transport;
      const lines = [
        "NETWORK",
        `Status: ${this.connectionStatus}`,
        `Server RTT: ${serverClock.rtt?.toFixed(0) ?? "—"} ms`,
        `Send: ${((t.sent - (this.prevSent || 0)) / span).toFixed(0)}/s  Receive: ${((t.received - (this.prevReceived || 0)) / span).toFixed(0)}/s`,
        `Players: ${this.remotePlayers.size + 1} Topics: ${t.channels.size || 1} Invalid: ${this.invalidPackets} Send failures: ${t.failed}`,
      ];
      for (const r of this.remotePlayers.values())
        lines.push(
          `${r.username}: ${Math.round(now - r.buffer.lastReceived)}ms seq ${r.buffer.sequence} ${r.buffer.mode} rejected ${r.buffer.dropped}\n  ${r.position
            .toArray()
            .map((n) => n.toFixed(1))
            .join(" / ")}`,
        );
      this.debugPanel.textContent = lines.join("\n");
      this.prevSent = t.sent;
      this.prevReceived = t.received;
    }
  }

  async syncResults() {
    if (!isSupabaseConfigured() || this.resultsBusy || this.disposed) return;
    this.resultsBusy = true;
    try {
      if (
        !this.markedStarted &&
        serverClock.now() >= Date.parse(this.lobby.race_start_at)
      ) {
        const { error } = await supabase.rpc("mark_race_started", {
          rid: this.raceId,
        });
        if (!error) this.markedStarted = true;
      }
      const finish = this.finishedPlayers.get(this.localPlayerId);
      if (finish && !this.savedFinish) {
        const { error } = await supabase.rpc("submit_race_finish", {
          rid: this.raceId,
          seconds: finish.time,
        });
        if (!error) this.savedFinish = true;
      }
      const { data } = await supabase
        .from("race_results")
        .select("player_id,finish_time")
        .eq("race_id", this.raceId);
      if (this.disposed) return;
      for (const r of data || [])
        if (
          this.remotePlayers.has(r.player_id) &&
          Number.isFinite(r.finish_time)
        )
          this.handleRemoteFinished(r.player_id, 0, r.finish_time);
    } catch (error) {
      this.transport?.log("Result recovery deferred", error);
    } finally {
      this.resultsBusy = false;
    }
  }

  handleRemotePowerUpCollected(playerId, boxIndex, item) {
    // Update local power-up state to prevent double collection
    if (this.game.kart) {
      const box = this.game.kart.items.boxes[boxIndex];
      if (box) {
        box.cooldown = 5; // Mark as collected
      }
    }
  }

  handleRemoteFinished(playerId, position, time) {
    if (this.finishedPlayers.has(playerId)) return;
    this.finishedPlayers.set(playerId, { position, time });

    const remote = this.remotePlayers.get(playerId);
    if (remote) {
      remote.finishedAt = time;
      remote.progress.finished = true;
      remote.progress.total = 3;
    }
  }

  // Called before physics update
  before(dt) {
    if (!this.isRaceActive) return;

    this.raceTime = Math.max(
      0,
      (serverClock.now() - Date.parse(this.lobby.race_start_at)) / 1000,
    );
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

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
    // (~50ms). We never apply cosmetic impulses to remote snapshots.
    if (this.collisionCooldown <= 0) {
      for (const remote of this.remotePlayers.values()) {
        if (
          !remote.connected ||
          performance.now() - remote.buffer.lastReceived > 500
        )
          continue;
        const other = {
          position: remote.position,
          velocity: remote.velocity,
          spec: remote.spec,
          id: remote.id,
        };
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
        local.position.addScaledVector(
          normal,
          Math.min(0.6, collision.penetration * (massOther / totalMass)),
        );

        // Velocity impulse along the collision normal, scaled by relative
        // closing speed so a glancing touch is soft and a head-on hit is
        // punishing - instead of always applying the same fixed bump.
        const relVel = local.velocity
          .clone()
          .sub(other.velocity || new THREE.Vector3());
        const velAlongNormal = relVel.dot(normal);
        if (velAlongNormal < 0) {
          const restitution = 0.25;
          const impulse = Math.min(
            18,
            -(1 + restitution) * velAlongNormal * (massOther / totalMass),
          );
          local.velocity.addScaledVector(normal, impulse);
          local.velocity.multiplyScalar(0.88);
        }

        this.localPhysics.collision = 1;
        this.game.audio.tone(65, 0.12, 0.18, "sawtooth");
        this.collisionCooldown = 0.35;
        break; // resolve one hit per tick; the cooldown covers the rest
      }
    }

    // Never mutate received remote states to cosmetically resolve collisions.
    // Track boundaries are already resolved by CarPhysics (once per step).
  }

  // Called after physics
  after(dt) {
    if (!this.isRaceActive) return;

    // Update kart after logic (pads, ramps, hazards, etc)
    // Need to handle for all players, not just local
    this.game.kart?.after(dt);

    // Check for finish
    if (
      this.localProgress.finished &&
      !this.finishedPlayers.has(this.localPlayerId)
    ) {
      const position = this.calculatePosition();
      const time = this.raceTime;

      this.finishedPlayers.set(this.localPlayerId, { position, time });

      void this.syncResults();
      // If all finished, end race
      if (
        this.finishedPlayers.has(this.localPlayerId) &&
        [...this.remotePlayers.keys()].every((id) =>
          this.finishedPlayers.has(id),
        )
      ) {
        this.finishRace();
      }
    }

    // Check if all remote finished
    if (
      this.finishedPlayers.has(this.localPlayerId) &&
      [...this.remotePlayers.keys()].every((id) =>
        this.finishedPlayers.has(id),
      ) &&
      this.isRaceActive
    ) {
      this.finishRace();
    }
  }

  calculatePosition() {
    return (
      this.getPositions().findIndex((r) => r.id === this.localPlayerId) + 1
    );
  }

  getPositions() {
    const allRacers = [
      {
        id: this.localPlayerId,
        username:
          this.playersData.find((p) => p.player_id === this.localPlayerId)
            ?.profiles?.username || "You",
        progress: this.localProgress.total,
        finishedAt: this.finishedPlayers.get(this.localPlayerId)?.time ?? null,
        isLocal: true,
      },
      ...this.departedPlayers.values(),
      ...Array.from(this.remotePlayers.values()).map((r) => ({
        id: r.id,
        username: r.username,
        progress: r.progress.total,
        finishedAt: r.finishedAt,
        isLocal: false,
      })),
    ];

    return rankRacers(allRacers);
  }

  finishRace() {
    if (!this.isRaceActive) return;

    this.isRaceActive = false;
    console.log("[MultiplayerRace] Race finished");

    const positions = this.getPositions();
    const localPos =
      positions.findIndex((p) => p.id === this.localPlayerId) + 1;

    // Build result
    this.game.result = {
      position: localPos,
      time: this.finishedPlayers.get(this.localPlayerId)?.time ?? this.raceTime,
      bestLap: this.game.bestLap,
      score: Math.round(
        (9 - localPos) * 1800 + Math.max(0, 60000 - this.raceTime * 100),
      ),
      drift: Math.floor(this.localPhysics.driftScore),
      overtakes: this.game.overtakes,
      unlocks: [],
      tokens: this.game.kart?.racers[0]?.tokens || 0,
      kartStats: this.game.kart
        ? { ...this.game.kart.stats, items: this.game.kart.racers[0].uses }
        : null,
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
      supabase
        .from("lobbies")
        .update({ status: "finished" })
        .eq("id", this.lobby.id)
        .then();
      if (this.raceId) {
        supabase
          .from("race_sessions")
          .update({
            status: "finished",
            finished_at: new Date().toISOString(),
          })
          .eq("id", this.raceId)
          .then();
      }
    }
  }

  removeRemote(playerId) {
    const remote = this.remotePlayers.get(playerId);
    if (!remote) return;
    this.departedPlayers.set(playerId, {
      id: playerId,
      username: remote.username,
      progress: remote.progress.total,
      finishedAt: remote.finishedAt,
      isLocal: false,
    });
    this.transport?.removeMember(playerId);
    this.removeNameTag(playerId);
    this.game.scene.remove(remote.car.group);
    remote.dispose();
    this.remotePlayers.delete(playerId);
    this.game.kart?.removeRemote(playerId);
    this.seenEvents.delete(playerId);
  }
  removeNameTag(id) {
    const tag = this.nameTags.get(id);
    if (!tag) return;
    tag.sprite.removeFromParent();
    tag.texture.dispose();
    tag.sprite.material.dispose();
    this.nameTags.delete(id);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.isRaceActive = false;
    this.transport?.dispose();
    this.offPlayers?.();
    for (const id of [...this.remotePlayers.keys()]) this.removeRemote(id);
    for (const id of [...this.nameTags.keys()]) this.removeNameTag(id);
    this.pendingEvents.length = 0;
    this.seenEvents.clear();
    this.eventAcks.clear();
    this.departedPlayers.clear();
    this.indicator?.remove();
    this.debugPanel?.remove();
  }
}
