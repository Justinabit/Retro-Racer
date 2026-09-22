import {
  ALL_TRACKS as TRACKS,
  CHARACTERS,
  combineStats,
} from "../kart/data.js";
import { KartRace } from "../kart/KartRace.js";
import * as THREE from "three";
import { CARS, DIFFICULTIES, timeString } from "../data.js";
import { Storage } from "./Storage.js";
import { Input } from "./Input.js";
import { AudioSystem } from "./Audio.js";
import { Car } from "../player/Car.js";
import { CarPhysics } from "../player/CarPhysics.js";
import { Track, RaceProgress, rankRacers } from "../track/Track.js";
import { createEnvironment } from "../world/Environment.js";
import { AICar } from "../ai/AICar.js";
import { Particles } from "../effects/Particles.js";
import { UI } from "../ui/UI.js";
import { collisionSystem, separateVehicles } from "../physics/Collision.js";
import { initAuth, getCurrentUserId, getProfile, ensureProfile } from "../supabase/auth.js";
import { isSupabaseConfigured } from "../supabase/client.js";
import { lobbyManager } from "../multiplayer/Lobby.js";
import { hasStoredUsername, getStoredUsername } from "../multiplayer/Username.js";
import { MultiplayerRace } from "../multiplayer/MultiplayerRace.js";

export class Game {
  get trackId() {
    return this.store.data.mode === "kart"
      ? this.store.data.kartTrack
      : this.store.data.track;
  }
  set trackId(id) {
    this.store.data[this.store.data.mode === "kart" ? "kartTrack" : "track"] =
      id;
  }
  get raceTracks() {
    return this.store.data.mode === "kart"
      ? TRACKS
      : TRACKS.filter((t) => !t.kart);
  }
  get character() {
    return (
      (this.state === "CHARACTER_SELECT" && this.previewCharacter) ||
      CHARACTERS.find((c) => c.id === this.store.data.character) ||
      CHARACTERS[0]
    );
  }
  carSpec(car, character = this.character) {
    return this.store.data.mode === "kart" ? combineStats(car, character) : car;
  }
  openCharacters() {
    this.previewCharacter =
      CHARACTERS.find((c) => c.id === this.store.data.character) ||
      CHARACTERS[0];
    this.openGarage();
    this.setState("CHARACTER_SELECT");
    this.rebuildCar();
  }
  chooseCharacter(id) {
    this.previewCharacter =
      CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
    this.rebuildCar();
    this.ui.render();
    this.audio.tone(600, 0.1, 0.07);
  }
  setMode(mode) {
    this.store.data.mode = mode;
    this.store.save();
    this.menu();
  }

  // Multiplayer getters
  get isMultiplayer() {
    return this.multiplayerActive;
  }

  constructor() {
    this.store = new Storage();
    this.state = "LOADING";
    this.setup = false;
    this.ai = [];
    this.remotePlayers = []; // For multiplayer remote cars
    this.multiplayerRace = null;
    this.multiplayerActive = false;
    this.lobby = null;
    this.lobbyPlayers = [];
    this.isHost = false;
    this.playerIntroIndex = 0;
    this.mapIntroTime = 0;
    
    this.previewCar = CARS.find((c) => c.id === this.store.data.car) || CARS[0];
    this.previewTrack = TRACKS.find((t) => t.id === this.trackId) || TRACKS[0];
    if (this.previewCar.cost > this.store.data.finishes)
      this.previewCar = CARS[0];
    if (this.previewTrack.cost > this.store.data.finishes)
      this.previewTrack = TRACKS[0];
    this.store.data.car = this.previewCar.id;
    this.trackId = this.previewTrack.id;
    if (!DIFFICULTIES[this.store.data.difficulty])
      this.store.data.difficulty = "normal";
    if (this.character.cost > this.store.data.finishes)
      this.store.data.character = "vex";
    
    this.audio = new AudioSystem(this.store.data.settings);
    this.input = new Input((a) => {
      if (a === "item") {
        if (this.multiplayerActive && this.multiplayerRace) {
          // In multiplayer, handle item via multiplayer system
          this.multiplayerRace.localPlayerData = this.lobbyPlayers.find(p => p.player_id === getCurrentUserId());
        }
        this.kart?.activate();
      }
      if (a === "pause") this.pause();
      if (a === "restart") {
        if (this.multiplayerActive) {
          this.leaveMultiplayer();
        } else {
          this.startRace();
        }
      }
      if (a === "blur" && ["RACING", "COUNTDOWN"].includes(this.state))
        this.pause();
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      42,
      innerWidth / innerHeight,
      0.15,
      2200,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById("world"),
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Performance: shadow map optimization
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    
    this.ambient = new THREE.HemisphereLight(0xffedd1, 0x64795b, 2.4);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffe2b6, 3.1);
    this.sun.position.set(-65, 95, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -65;
    this.sun.shadow.camera.right = 65;
    this.sun.shadow.camera.top = 65;
    this.sun.shadow.camera.bottom = -65;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 280;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);
    
    this.ui = new UI(this);
    
    // Performance: cache vectors to avoid creation in loop
    this._cameraTarget = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tempVec = new THREE.Vector3();
    this._tempVec2 = new THREE.Vector3();
    
    // HUD caching for performance
    this._hudCache = {
      lap: null,
      position: null,
      timer: null,
      bestLap: null,
      speed: null,
      gear: null,
      drift: null,
      checkpoint: null,
      nitro: null,
      rpm: null,
    };
    
    this.last = performance.now();
    this.time = 0;
    this.raceTime = 0;
    this.hudClock = 0;
    this.garageAngle = 0.65;
    this.garageZoom = 13;
    this.previewLights = false;
    this.previewBrakes = false;
    this.loadToken = 0;
    
    // Debug
    this.debug = {
      enabled: false,
      fps: 0,
      frameTime: 0,
      collisionChecks: 0,
      networkLatency: 0,
      playerCount: 0,
    };
    
    this.resize = () => {
      const menuBottom =
        this.state === "MENU"
          ? (document.querySelector(".launch-deck")?.offsetHeight || 188) +
            (document.querySelector(".footer")?.offsetHeight || 43)
          : 0;
      const h = innerHeight - menuBottom;
      this.camera.aspect = innerWidth / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, h);
      if (this.state === "MENU" && this.car)
        this.car.group.scale.setScalar(innerWidth < 600 ? 1.08 : 1.55);
    };
    window.addEventListener("resize", this.resize);
    this.applySettings();
    this.bindGarage();
    this.cameraReady = false;
    this.loop = this.loop.bind(this);
    
    // Init auth and username
    this.initMultiplayerSystem();
    
    requestAnimationFrame(this.loop);
    document.addEventListener("pointerdown", () => this.audio.init(), {
      once: true,
    });
    document.addEventListener("keydown", () => this.audio.init(), {
      once: true,
    });
  }

  async initMultiplayerSystem() {
    try {
      await initAuth();
      console.log("[Game] Auth initialized");

      // Setup lobby manager listeners
      lobbyManager.on('lobbyUpdated', (lobby) => {
        this.lobby = lobby;
        this.isHost = lobby.host_id === getCurrentUserId();
        if (["MULTIPLAYER_LOBBY", "PLAYER_INTRO", "MAP_INTRO"].includes(this.state)) {
          this.ui.render();
        }
      });

      lobbyManager.on('playersUpdated', (players) => {
        this.lobbyPlayers = players;
        if (["MULTIPLAYER_LOBBY", "PLAYER_INTRO", "MAP_INTRO"].includes(this.state)) {
          this.ui.render();
        }
        // Update debug
        this.debug.playerCount = players.length;
      });

      lobbyManager.on('playerJoined', (player) => {
        console.log("[Game] Player joined:", player);
        this.ui.toast(`${player.profiles?.username || 'Player'} joined the lobby`);
      });

      lobbyManager.on('playerLeft', (player) => {
        console.log("[Game] Player left:", player);
        this.ui.toast(`Player left the lobby`);
      });

      lobbyManager.on('raceStarting', (lobby) => {
        // Defensive: ignore duplicate/late 'raceStarting' events if we're
        // already mid-flow or racing, so a redelivered event can't reset
        // world state out from under an active race.
        if (["PLAYER_INTRO", "MAP_INTRO", "COUNTDOWN", "RACING"].includes(this.state)) {
          console.log("[Game] Ignoring duplicate race starting event, already in", this.state);
          return;
        }
        console.log("[Game] Race starting");
        this.ui.toast("Race starting...");
        this.startMultiplayerRaceFlow();
      });

      lobbyManager.on('raceStarted', (lobby) => {
        console.log("[Game] Race started (realtime)");
        if (this.state === "MULTIPLAYER_LOBBY" || this.state === "PLAYER_INTRO" || this.state === "MAP_INTRO") {
          // Already in flow, ignore
        }
      });

      lobbyManager.on('lobbyClosed', () => {
        console.log("[Game] Lobby closed");
        this.ui.toast("Lobby closed");
        this.leaveMultiplayer();
      });

      // Check username
      if (!hasStoredUsername()) {
        this.setState("USERNAME_PROMPT");
      } else {
        // A username exists locally, but the Supabase "profiles" row may not
        // (e.g. it was saved before Supabase was connected, or on another
        // device). Sync it now so hosting/joining a lobby never fails on the
        // profiles foreign key.
        if (isSupabaseConfigured()) {
          try {
            await ensureProfile(getStoredUsername());
          } catch (e) {
            console.warn("[Game] Failed to sync Supabase profile:", e);
          }
        }
        this.menu();
      }
    } catch (e) {
      console.error("[Game] Multiplayer init failed:", e);
      this.menu();
    }
  }

  applySettings() {
    const s = this.store.data.settings;
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        matchMedia("(pointer: coarse)").matches ? 1.25 : 2,
        s.graphics === "low" ? 1 : s.graphics === "medium" ? 1.3 : 1.75,
      ),
    );
    this.renderer.shadowMap.enabled = s.graphics !== "low";
    // Performance: lower shadow resolution for low/medium
    this.sun.shadow.mapSize.set(
      s.graphics === "high" ? 2048 : s.graphics === "medium" ? 1024 : 512,
      s.graphics === "high" ? 2048 : s.graphics === "medium" ? 1024 : 512,
    );
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
    document.getElementById("screen-effects").classList.toggle("crt", s.crt);
    if (this.particles) {
      this.particles.mesh.visible = s.particles;
      this.particles.skids.visible = s.particles;
    }
    this.store.save();
  }

  setState(state) {
    this.state = state;
    this.input.active = ["RACING", "COUNTDOWN", "PAUSED"].includes(state);
    if (!["RACING", "COUNTDOWN"].includes(state)) this.input.clear();
    this.audio.mode = state === "RACING" ? "race" : "menu";
    if (state !== "RACING")
      document.getElementById("screen-effects").classList.remove("boost");
    this.ui.render();
    this.resize();
  }

  async loading(text, action, opts = {}) {
    const token = ++this.loadToken;
    this.loadingText = text;
    this.setState("LOADING");
    await new Promise((resolve) => setTimeout(resolve, 35));
    if (token !== this.loadToken) return;
    try {
      await action();
    } catch (e) {
      console.error(e);
      if (opts.onError) {
        opts.onError(e);
      } else {
        this.showError("The track could not be prepared. Reload to try again.");
      }
    }
  }

  loadWorld(data) {
    if (this.track?.data.id === data.id && this.environment) return;
    if (this.track) {
      this.scene.remove(this.track.group);
      this.track.dispose();
    }
    if (this.environment) {
      this.scene.remove(this.environment.group);
      this.environment.dispose();
    }
    this.track = new Track(data);
    this.environment = createEnvironment(this.track);
    this.scene.add(this.track.group, this.environment.group);
    this.scene.background = new THREE.Color(data.sky);
    this.scene.fog = new THREE.Fog(
      data.fog,
      data.id === "forest" ? 75 : 140,
      data.id === "forest" ? 420 : 850,
    );
    this.sun.color.set(this.environment.night ? 0xa7c3de : 0xffe1b6);
    this.sun.intensity = this.environment.night
      ? this.track.data.kart
        ? 1.7
        : 1.1
      : 3;
    this.ambient.intensity = this.environment.night
      ? this.track.data.kart
        ? 1.85
        : 1.1
      : 2.5;
    this.ambient.color.set(this.environment.night ? 0x9db6d1 : 0xffedcf);
  }

  clearRace() {
    this.kart?.dispose();
    this.kart = null;
    this.multiplayerRace?.dispose();
    this.multiplayerRace = null;
    for (const a of this.ai) {
      this.scene.remove(a.car.group);
      a.car.dispose();
    }
    this.ai = [];
    for (const remote of this.remotePlayers) {
      this.scene.remove(remote.car.group);
      remote.car.dispose();
    }
    this.remotePlayers = [];
    if (this.particles) {
      this.scene.remove(this.particles.mesh, this.particles.skids);
      this.particles.dispose();
      this.particles = null;
    }
    this.player = null;
    collisionSystem.clear();
  }

  rebuildCar() {
    if (this.car) {
      this.scene.remove(this.car.group);
      this.car.dispose();
    }
    const s = this.store.data,
      c = this.previewCar;
    this.car = new Car(
      this.carSpec(c),
      s.paint[c.id] || c.color,
      s.custom[c.id] || {},
      true,
    );
    this.scene.add(this.car.group);
    if (["GARAGE", "CHARACTER_SELECT"].includes(this.state)) {
      this.car.group.position.set(0, 0.24, 0);
      this.car.group.rotation.y = 0;
    } else if (this.track) {
      const loc = this.track.at(
        this.track.data.id === "coast" ? 0.852 : 0.15,
        -2.7,
      );
      this.car.group.position.copy(loc.p);
      this.car.group.rotation.y = loc.yaw;
      this.car.group.scale.setScalar(innerWidth < 600 ? 1.08 : 1.55);
    }
    this.cameraReady = false;
  }

  showWorld() {
    this.track.group.visible = true;
    this.environment.group.visible = true;
    if (this.garageGroup) this.garageGroup.visible = false;
    this.scene.background = new THREE.Color(this.track.data.sky);
    this.scene.fog = new THREE.Fog(
      this.track.data.fog,
      this.track.data.id === "forest" ? 75 : 140,
      this.track.data.id === "forest" ? 420 : 850,
    );
    this.sun.intensity = this.environment.night
      ? this.track.data.kart
        ? 1.7
        : 1.1
      : 3;
    this.ambient.intensity = this.environment.night
      ? this.track.data.kart
        ? 1.85
        : 1.1
      : 2.5;
    this.sun.color.set(this.environment.night ? 0xa7c3de : 0xffe1b6);
    this.ambient.color.set(this.environment.night ? 0x9db6d1 : 0xffedcf);
  }

  menu() {
    this.loading("SETTING THE SCENE…", () => {
      this.clearRace();
      this.multiplayerActive = false;
      this.previewTrack =
        TRACKS.find((t) => t.id === this.trackId) || TRACKS[0];
      this.previewCar =
        CARS.find((c) => c.id === this.store.data.car) || CARS[0];
      this.loadWorld(this.previewTrack);
      this.showWorld();
      this.rebuildCar();
      this.setState("MENU");
    });
  }

  openGarage() {
    this.clearRace();
    this.previewCar = CARS.find((c) => c.id === this.store.data.car) || CARS[0];
    this.state = "GARAGE";
    this.rebuildCar();
    this.track.group.visible = false;
    this.environment.group.visible = false;
    this.scene.background = new THREE.Color(0xe7e7d8);
    this.scene.fog = new THREE.Fog(0xe7e7d8, 30, 100);
    this.ambient.intensity = 2.4;
    this.sun.intensity = 3;
    this.sun.color.set(0xffead3);
    if (!this.garageGroup) {
      this.garageGroup = new THREE.Group();
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(150, 150),
        new THREE.MeshStandardMaterial({ color: 0xc9cfbc, roughness: 0.86 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.1;
      floor.receiveShadow = true;
      this.garageGroup.add(floor);
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(5.6, 5.7, 0.3, 64),
        new THREE.MeshStandardMaterial({
          color: 0xdbdccb,
          roughness: 0.65,
          metalness: 0.1,
        }),
      );
      platform.position.y = 0.07;
      platform.receiveShadow = true;
      platform.castShadow = true;
      this.garageGroup.add(platform);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(5.62, 0.025, 6, 80),
        new THREE.MeshBasicMaterial({ color: 0xef673e }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.17;
      this.garageGroup.add(ring);
      const grid = new THREE.GridHelper(120, 40, 0xc0c6b3, 0xc0c6b3);
      grid.position.y = -0.08;
      this.garageGroup.add(grid);
      this.scene.add(this.garageGroup);
    }
    this.garageGroup.visible = true;
    this.garageAngle = 0.65;
    this.setState("GARAGE");
  }

  selectCar(id) {
    this.previewCar = CARS.find((c) => c.id === id) || CARS[0];
    this.rebuildCar();
    this.ui.render();
    
    // If in multiplayer lobby, update selection
    if (this.state === "MULTIPLAYER_LOBBY" || this.multiplayerActive) {
      lobbyManager.updatePlayerSelection({ car: id }).catch(e => {
        console.warn("[Game] Failed to update car in lobby:", e);
      });
    }
  }

  openTracks() {
    this.previewTrack = TRACKS.find((t) => t.id === this.trackId) || TRACKS[0];
    this.loading("SCOUTING THE NEXT DESTINATION…", () => {
      this.clearRace();
      this.loadWorld(this.previewTrack);
      this.showWorld();
      if (this.car) this.car.group.visible = false;
      this.cameraReady = false;
      this.setState("TRACK_SELECT");
    });
  }

  selectTrack(id) {
    const data = TRACKS.find((t) => t.id === id) || TRACKS[0];
    this.loading("LOADING " + data.name.toUpperCase() + "…", () => {
      this.previewTrack = data;
      this.loadWorld(data);
      this.showWorld();
      if (this.car) this.car.group.visible = false;
      this.cameraReady = false;
      this.setState("TRACK_SELECT");
      
      // If host in multiplayer lobby, update map
      if (this.lobby && this.isHost) {
        lobbyManager.updateLobbySettings({ mapId: id }).catch(e => {
          console.warn("[Game] Failed to update map:", e);
        });
      }
    });
  }

  // Single-player race (existing, with AI)
  startRace() {
    this.loading("PREPARING THE GRID…", () => {
      this.clearRace();
      this.multiplayerActive = false;
      const data = TRACKS.find((t) => t.id === this.trackId) || TRACKS[0];
      this.previewCar =
        CARS.find((c) => c.id === this.store.data.car) || CARS[0];
      this.loadWorld(data);
      this.showWorld();
      this.rebuildCar();
      this.car.group.scale.setScalar(1);
      this.player = new CarPhysics(
        this.carSpec(this.previewCar),
        this.track,
        0.008,
        -3,
      );
      this.car.group.position.copy(this.player.position);
      this.car.group.rotation.y = this.player.yaw;
      this.progress = new RaceProgress(0.008);
      
      // Only spawn AI in single-player
      for (let i = 0; i < 7; i++) {
        const spec = this.carSpec(
          CARS[(i + 1) % CARS.length],
          CHARACTERS[(i + 1) % CHARACTERS.length],
        );
        const car = new Car(spec, spec.color, { number: i + 1 }, false);
        this.scene.add(car.group);
        this.ai.push(
          new AICar(
            car,
            this.track,
            i,
            (DIFFICULTIES[this.store.data.difficulty] || 0.88) *
              (this.store.data.mode === "kart"
                ? { easy: 0.82, normal: 0.94, hard: 1, expert: 1 }[
                    this.store.data.difficulty
                  ] || 1
                : 1),
          ),
        );
      }
      
      this.particles = new Particles();
      this.scene.add(this.particles.mesh, this.particles.skids);
      this.particles.mesh.visible = this.store.data.settings.particles;
      this.particles.skids.visible = this.store.data.settings.particles;
      if (this.store.data.mode === "kart") this.kart = new KartRace(this);
      
      this.countdown = 3.8;
      this.lastBeep = 4;
      this.raceTime = 0;
      this.lapStart = 0;
      this.laps = [];
      this.bestLap = Infinity;
      this.position = 8;
      this.lastPosition = 8;
      this.overtakes = 0;
      this.cameraReady = false;
      this.collisionCooldown = 0;
      this.lastGear = 1;
      this.setup = false;
      this.setState("COUNTDOWN");
    });
  }

  // Multiplayer methods
  openMultiplayer() {
    if (!hasStoredUsername()) {
      this.setState("USERNAME_PROMPT");
      return;
    }
    this.setState("MULTIPLAYER_MENU");
  }

  async createMultiplayerLobby() {
    await this.loading("CREATING LOBBY…", async () => {
      const mode = this.store.data.mode || 'classic';
      const mapId = this.trackId || 'coast';
      const car = this.store.data.car || 'gt';
      const character = this.store.data.character || 'vex';
      
      const { lobby, player } = await lobbyManager.createLobby({
        mode,
        mapId,
        car,
        character,
      });
      
      this.lobby = lobby;
      this.lobbyPlayers = [player];
      this.isHost = true;
      this.multiplayerActive = true;
      
      // Load world for selected map
      const trackData = TRACKS.find(t => t.id === mapId) || TRACKS[0];
      this.loadWorld(trackData);
      this.showWorld();
      if (this.car) this.car.group.visible = false;
      
      this.setState("MULTIPLAYER_LOBBY");
    }, {
      onError: (e) => {
        console.error("[Game] Create lobby failed:", e);
        this.ui.toast(e.message || "Failed to create lobby");
        this.setState("MULTIPLAYER_MENU");
      }
    });
  }

  async joinMultiplayerLobby(code) {
    await this.loading("JOINING LOBBY…", async () => {
      const { lobby, player } = await lobbyManager.joinLobby(code);
      
      this.lobby = lobby;
      this.isHost = lobby.host_id === getCurrentUserId();
      this.multiplayerActive = true;
      
      // Load world for lobby's map
      const trackData = TRACKS.find(t => t.id === lobby.map_id) || TRACKS[0];
      this.loadWorld(trackData);
      this.showWorld();
      if (this.car) this.car.group.visible = false;
      
      // Fetch players
      this.lobbyPlayers = await lobbyManager.fetchPlayers(lobby.id);
      
      this.setState("MULTIPLAYER_LOBBY");
    }, {
      onError: (e) => {
        console.error("[Game] Join lobby failed:", e);
        this.ui.toast(e.message || "Failed to join lobby");
        this.setState("MULTIPLAYER_MENU");
      }
    });
  }

  async leaveMultiplayer() {
    try {
      await lobbyManager.leaveLobby();
    } catch (e) {
      console.warn("[Game] Leave lobby failed:", e);
    } finally {
      this.clearRace();
      this.lobby = null;
      this.lobbyPlayers = [];
      this.isHost = false;
      this.multiplayerActive = false;
      this.multiplayerRace = null;
      this.menu();
    }
  }

  async startMultiplayerRaceFlow() {
    // Flow: Lobby -> Loading -> Player Intro -> Map Intro -> Starting Grid -> Countdown -> Race
    this.loading("PREPARING MULTIPLAYER RACE…", async () => {
      // Fetch latest players
      this.lobbyPlayers = await lobbyManager.fetchPlayers(this.lobby.id);
      
      // Ensure no AI - multiplayer is human only
      console.log(`[Game] Starting multiplayer race with ${this.lobbyPlayers.length} human players, NO AI`);
      
      // Load track
      const trackData = TRACKS.find(t => t.id === this.lobby.map_id) || TRACKS[0];
      this.loadWorld(trackData);
      this.showWorld();
      
      // Start player introductions
      this.playerIntroIndex = 0;
      this.setState("PLAYER_INTRO");
    });
  }

  nextPlayerIntro() {
    this.playerIntroIndex++;
    if (this.playerIntroIndex >= this.lobbyPlayers.length) {
      // All players introduced, show map
      this.setState("MAP_INTRO");
      this.mapIntroTime = this.time + 3; // 3 seconds map intro
    } else {
      this.ui.render();
    }
  }

  async startMultiplayerRace() {
    this.loading("PREPARING THE GRID…", async () => {
      this.clearRace();
      this.multiplayerActive = true;
      
      const trackData = TRACKS.find(t => t.id === this.lobby.map_id) || TRACKS[0];
      this.loadWorld(trackData);
      this.showWorld();
      
      // Use lobby's mode
      this.store.data.mode = this.lobby.mode;
      
      // Create local car from selection
      const localPlayerData = this.lobbyPlayers.find(p => p.player_id === getCurrentUserId());
      const carId = localPlayerData?.selected_car || this.store.data.car;
      const charId = localPlayerData?.selected_character || this.store.data.character;
      
      this.previewCar = CARS.find(c => c.id === carId) || CARS[0];
      if (charId) {
        this.store.data.character = charId;
      }
      
      this.rebuildCar();
      this.car.group.scale.setScalar(1);
      
      // Create multiplayer race manager - NO AI
      const race = new MultiplayerRace(this, this.lobby, this.lobbyPlayers);
      this.multiplayerRace = race;
      await race.init();

      // If something else replaced this.multiplayerRace while we were
      // awaiting init() (e.g. the lobby was left, or a newer race start
      // began), this attempt is stale — discard it instead of clobbering
      // whatever state is now current.
      if (this.multiplayerRace !== race) {
        race.dispose?.();
        return;
      }

      // Set local player references for compatibility with existing code
      this.player = race.localPhysics;
      this.progress = race.localProgress;
      this.car.group.position.copy(this.player.position);
      this.car.group.rotation.y = this.player.yaw;
      
      // For kart mode
      if (this.store.data.mode === "kart") {
        this.kart = new KartRace(this);
        // Override kart racers to be only human players for multiplayer
        // But keep existing kart logic for items etc
      }
      
      this.particles = new Particles();
      this.scene.add(this.particles.mesh, this.particles.skids);
      this.particles.mesh.visible = this.store.data.settings.particles;
      this.particles.skids.visible = this.store.data.settings.particles;
      
      this.countdown = 3.8;
      this.lastBeep = 4;
      this.raceTime = 0;
      this.lapStart = 0;
      this.laps = [];
      this.bestLap = Infinity;
      this.position = this.lobbyPlayers.length; // Start last, will be calculated
      this.lastPosition = this.position;
      this.overtakes = 0;
      this.cameraReady = false;
      this.collisionCooldown = 0;
      this.lastGear = 1;
      
      this.setState("COUNTDOWN");
    });
  }

  pause() {
    if (this.state === "PAUSED") {
      this.resume();
      return;
    }
    if (!["RACING", "COUNTDOWN"].includes(this.state)) return;
    this.pauseReturn = this.state;
    this.setState("PAUSED");
  }

  resume() {
    if (this.state !== "PAUSED") return;
    this.setState(this.pauseReturn || "RACING");
  }

  finish() {
    // Single-player finish
    if (this.multiplayerActive) {
      // Multiplayer finish handled by MultiplayerRace
      return;
    }
    
    const p = this.player,
      s = this.store.data,
      finishes = s.finishes + 1;
    const drift = Math.floor(p.driftScore),
      score = Math.round(
        (9 - this.position) * 1800 +
          Math.max(0, 60000 - this.raceTime * 100) +
          drift +
          this.overtakes * 100 +
          (this.kart?.racers[0].tokens || 0) * 100,
      );
    const unlocks = [...CARS, ...TRACKS, ...CHARACTERS]
      .filter((c) => c.cost === finishes)
      .map((c) => c.name);
    if (finishes === 4) unlocks.push("Expert difficulty");
    this.result = {
      position: this.position,
      time: this.raceTime,
      bestLap: this.bestLap,
      score,
      drift,
      overtakes: this.overtakes,
      unlocks,
      tokens: this.kart?.racers[0].tokens || 0,
      kartStats: this.kart
        ? { ...this.kart.stats, items: this.kart.racers[0].uses }
        : null,
    };
    this.store.record({
      mode: s.mode,
      character: s.mode === "kart" ? s.character : null,
      tokens: this.kart?.racers[0].tokens || 0,
      name: s.name,
      score,
      track: this.track.data.id,
      car: s.car,
      time: this.raceTime,
      bestLap: this.bestLap,
      position: this.position,
      drift,
      date: new Date().toISOString().slice(0, 10),
    });
    this.audio.finish();
    this.setState("RESULTS");
  }

  step(dt) {
    if (this.state !== "RACING") return;
    
    // Multiplayer race
    if (this.multiplayerActive && this.multiplayerRace) {
      this.multiplayerRace.before(dt);
      
      const input = this.input.controls,
        p = this.player;
      
      if (!p) return;
      
      const before = this.progress.checkpoint;
      const out = p.update(dt, input);
      
      // Improved collision: check fall and stuck
      const fallCheck = collisionSystem.checkFall(p, this.track);
      if (fallCheck.isFalling) {
        console.log("[Game] Fall detected, recovering");
        if (this.multiplayerRace) {
          // In multiplayer, use kart respawn logic if available
          this.kart?.respawn?.(this.kart.racers[0]);
        } else {
          collisionSystem.recoverToCheckpoint(p, this.progress, this.track);
        }
        this.ui.toast("Recovering to checkpoint...");
      }
      
      const stuckCheck = collisionSystem.checkStuck(p, input, dt);
      if (stuckCheck.shouldRecover) {
        console.log("[Game] Stuck detected, recovering");
        collisionSystem.recoverToCheckpoint(p, this.progress, this.track);
        this.ui.toast("Stuck - recovering...");
      }
      
      this.car.group.position.copy(p.position);
      this.car.group.rotation.y = p.yaw;
      this.car.update(dt, p.speed, p.steer, input.brake, this.environment.night);
      
      const gear = Math.max(
        1,
        Math.min(6, 1 + Math.floor((Math.abs(p.speed) * 3.6) / 48)),
      );
      if (gear !== this.lastGear) {
        this.audio.tone(180, 0.04, 0.025, "triangle");
        this.lastGear = gear;
      }
      
      this.raceTime += dt;
      const newLap = this.progress.update(out.nearest.s, out.headingDot);
      if (before !== this.progress.checkpoint && !newLap)
        this.audio.tone(780, 0.06, 0.035, "sine");
      if (newLap) {
        const lap = this.raceTime - this.lapStart;
        this.laps.push(lap);
        this.bestLap = Math.min(this.bestLap, lap);
        this.lapStart = this.raceTime;
        this.audio.tone(950, 0.25, 0.1, "triangle");
        if (!this.progress.finished) {
          const el = document.getElementById("lap-notice");
          if (el) {
            el.textContent = `LAP ${this.progress.lap + 1} / 3 · ${timeString(lap)}`;
            this.noticeUntil = this.raceTime + 3;
          }
        }
      }
      
      // Multiplayer after
      this.multiplayerRace.after(dt);
      
      // Calculate position among human players only
      const positions = this.multiplayerRace.getPositions();
      this.position = positions.findIndex(p => p.id === getCurrentUserId()) + 1;
      if (this.position < this.lastPosition && this.raceTime > 2)
        this.overtakes += this.lastPosition - this.position;
      this.lastPosition = this.position;
      
      // Particles
      if (this.store.data.settings.particles) {
        if (p.drifting) {
          this.particles.emit(
            p.position,
            0xc5c4b8,
            this.store.data.settings.graphics === "low" ? 1 : 2,
          );
          this.particles.skid(p.position, p.yaw);
        } else if (p.offroad && Math.abs(p.speed) > 5)
          this.particles.emit(p.position, 0xc5aa79, 2);
        else if (p.boosting || p.itemBoosting)
          this.particles.emit(
            p.position
              .clone()
              .add(
                new THREE.Vector3(
                  -Math.sin(p.yaw) * 2,
                  0.1,
                  -Math.cos(p.yaw) * 2,
                ),
              ),
            0x71d4f2,
            3,
          );
        else if (input.throttle && Math.random() > 0.8)
          this.particles.emit(p.position, 0x7c8077, 1);
        if (out.collision) this.particles.emit(p.position, 0xffb24b, 9);
      }
      this.particles.update(dt);
      
      if (this.noticeUntil && this.raceTime > this.noticeUntil) {
        const el = document.getElementById("lap-notice");
        if (el) el.textContent = "";
        this.noticeUntil = 0;
      }
      
      document
        .getElementById("screen-effects")
        .classList.toggle(
          "boost",
          (p.boosting || p.itemBoosting) && this.store.data.settings.motion,
        );
      
      if (this.progress.finished && !this.multiplayerRace.finishedPlayers.has(getCurrentUserId())) {
        // Will be handled by multiplayerRace
      }
      
      return;
    }
    
    // Single-player (existing logic with improvements)
    this.kart?.before(dt);
    const input = this.input.controls,
      p = this.player;
    const before = this.progress.checkpoint;
    const out = p.update(dt, input);
    
    // Improved: continuous collision check to prevent tunneling
    const prevPos = p.position.clone().sub(p.velocity.clone().multiplyScalar(dt));
    const ccd = collisionSystem.checkContinuousCollision(prevPos, p.position, this.track, 3);
    if (ccd) {
      // Hit wall during movement, correct
      p.position.copy(ccd.position);
      p.velocity.multiplyScalar(0.5);
      p.collision = 1;
      out.collision = true;
    }
    
    // Fall and stuck detection
    const fallCheck = collisionSystem.checkFall(p, this.track);
    if (fallCheck.isFalling) {
      if (this.kart) {
        this.kart.respawn(this.kart.racers[0]);
      } else {
        collisionSystem.recoverToCheckpoint(p, this.progress, this.track);
      }
    }
    
    const stuckCheck = collisionSystem.checkStuck(p, input, dt);
    if (stuckCheck.shouldRecover) {
      collisionSystem.recoverToCheckpoint(p, this.progress, this.track);
    }
    
    this.car.group.position.copy(p.position);
    this.car.group.rotation.y = p.yaw;
    this.car.update(dt, p.speed, p.steer, input.brake, this.environment.night);
    const gear = Math.max(
      1,
      Math.min(6, 1 + Math.floor((Math.abs(p.speed) * 3.6) / 48)),
    );
    if (gear !== this.lastGear) {
      this.audio.tone(180, 0.04, 0.025, "triangle");
      this.lastGear = gear;
    }
    this.raceTime += dt;
    const newLap = this.progress.update(out.nearest.s, out.headingDot);
    if (before !== this.progress.checkpoint && !newLap)
      this.audio.tone(780, 0.06, 0.035, "sine");
    if (newLap) {
      const lap = this.raceTime - this.lapStart;
      this.laps.push(lap);
      this.bestLap = Math.min(this.bestLap, lap);
      this.lapStart = this.raceTime;
      this.audio.tone(950, 0.25, 0.1, "triangle");
      if (!this.progress.finished) {
        const el = document.getElementById("lap-notice");
        if (el) {
          el.textContent = `LAP ${this.progress.lap + 1} / 3 · ${timeString(lap)}`;
          this.noticeUntil = this.raceTime + 3;
        }
      }
    }
    
    // AI update
    for (const a of this.ai) a.update(dt, this.ai, p);
    
    // Improved vehicle collision with broad-phase
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    
    // Collect all vehicles for collision
    const allVehicles = [
      { position: p.position, velocity: p.velocity, spec: p.spec, physics: p, id: 'player' },
      ...this.ai.map(a => ({
        position: a.car.group.position,
        velocity: new THREE.Vector3(Math.sin(a.car.group.rotation.y) * a.speed, 0, Math.cos(a.car.group.rotation.y) * a.speed),
        spec: a.car.spec,
        physics: a,
        id: a.index,
      }))
    ];
    
    // Use improved collision system
    const collisions = collisionSystem.update(dt, allVehicles, this.track);
    
    // Additional player vs AI specific handling (for compatibility)
    for (const a of this.ai) {
      const dist = p.position.distanceTo(a.car.group.position);
      if (dist < 2.05 && this.collisionCooldown <= 0) {
        const normal = p.position.clone().sub(a.car.group.position);
        normal.y = 0;
        if (normal.lengthSq() < 0.001) normal.set(1, 0, 0);
        normal.normalize();
        p.position.addScaledVector(normal, 2.08 - dist);
        p.velocity.addScaledVector(
          normal,
          this.kart
            ? (7 * (a.car.spec.weight || 75)) / (p.spec.weight || 75)
            : 7,
        );
        p.velocity.multiplyScalar(
          this.kart ? 0.7 + (p.spec.weight || 75) * 0.0019 : 0.84,
        );
        a.speed *= this.kart ? 0.7 + (a.car.spec.weight || 75) * 0.0019 : 0.84;
        a.targetLane = -a.lane;
        p.collision = 1;
        out.collision = true;
        this.audio.tone(65, 0.12, 0.18, "sawtooth");
        this.collisionCooldown = 0.35;
      }
    }
    
    this.kart?.after(dt);
    const ranked = rankRacers([
      {
        progress: this.progress.total,
        player: true,
        finishedAt: this.progress.finished ? this.raceTime : null,
      },
      ...this.ai.map((a) => ({
        progress: a.progress.total,
        player: false,
        finishedAt: a.finishedAt,
      })),
    ]);
    this.position = ranked.findIndex((a) => a.player) + 1;
    if (this.position < this.lastPosition && this.raceTime > 2)
      this.overtakes += this.lastPosition - this.position;
    this.lastPosition = this.position;
    
    // Performance: only emit particles if needed and not every frame for throttle
    if (this.store.data.settings.particles) {
      if (p.drifting) {
        this.particles.emit(
          p.position,
          0xc5c4b8,
          this.store.data.settings.graphics === "low" ? 1 : 2,
        );
        this.particles.skid(p.position, p.yaw);
      } else if (p.offroad && Math.abs(p.speed) > 5)
        this.particles.emit(p.position, 0xc5aa79, 2);
      else if (p.boosting || p.itemBoosting)
        this.particles.emit(
          p.position
            .clone()
            .add(
              new THREE.Vector3(
                -Math.sin(p.yaw) * 2,
                0.1,
                -Math.cos(p.yaw) * 2,
              ),
            ),
          0x71d4f2,
          3,
        );
      else if (input.throttle && Math.random() > 0.8)
        this.particles.emit(p.position, 0x7c8077, 1);
      if (out.collision) this.particles.emit(p.position, 0xffb24b, 9);
    }
    this.particles.update(dt);
    if (out.collision && this.collisionCooldown <= 0) {
      this.audio.tone(65, 0.12, 0.18, "sawtooth");
      this.collisionCooldown = 0.2;
    }
    if (this.noticeUntil && this.raceTime > this.noticeUntil) {
      const el = document.getElementById("lap-notice");
      if (el) el.textContent = "";
      this.noticeUntil = 0;
    }
    document
      .getElementById("screen-effects")
      .classList.toggle(
        "boost",
        (p.boosting || p.itemBoosting) && this.store.data.settings.motion,
      );
    if (this.progress.finished) this.finish();
  }

  updateCamera(dt) {
    if (!this.car || !this.track) return;
    const mobile = innerWidth < 600;
    const cameraTarget = this._cameraTarget;
    const lookTarget = this._lookTarget;
    const state =
      this.state === "SETTINGS" && this.settingsReturn === "PAUSED"
        ? "PAUSED"
        : this.state;
    let roll = 0;
    if (
      ["RACING", "COUNTDOWN", "PAUSED", "RESULTS"].includes(state) &&
      this.player
    ) {
      const p = this.player,
        forward = this._forward.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)),
        speed = Math.abs(p.speed),
        brake = this.input.controls.brake;
      cameraTarget
        .copy(p.position)
        .addScaledVector(
          forward,
          -(
            8.8 +
            speed * 0.052 -
            brake * 0.9 +
            (this.kart && p.airborne ? 3 : 0)
          ),
        );
      cameraTarget.y += 4.4 + speed * 0.013;
      lookTarget.copy(p.position).addScaledVector(forward, 6 + speed * 0.08);
      lookTarget.y += 1.5;
      roll = -p.steer * Math.min(speed / 60, 1) * 0.026;
      if (this.store.data.settings.shake && p.collision > 0) {
        cameraTarget.x += (Math.random() - 0.5) * p.collision * 0.35;
        cameraTarget.y += (Math.random() - 0.5) * p.collision * 0.2;
      }
      this.camera.fov = THREE.MathUtils.damp(
        this.camera.fov,
        50 + speed * 0.095 + (p.boosting || p.itemBoosting ? 6 : 0),
        4,
        dt,
      );
    } else if (["GARAGE", "CHARACTER_SELECT"].includes(state)) {
      const dist = this.garageZoom * (mobile ? 1.1 : 1),
        a = this.garageAngle;
      cameraTarget.set(Math.sin(a) * dist, 5.5, Math.cos(a) * dist);
      lookTarget.set(0, 0.7, 0);
      if (!mobile)
        lookTarget.add(
          new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(1.5),
        );
      else lookTarget.y = -0.5;
      this.camera.fov = mobile ? 44 : 39;
      this.car.update(dt, 0, 0, this.previewBrakes, this.previewLights);
    } else if (state === "TRACK_SELECT") {
      const loc = this.track.at(0.055 + Math.sin(this.time * 0.023) * 0.02);
      cameraTarget.copy(loc.p).add(new THREE.Vector3(-90, 100, 70));
      lookTarget.copy(loc.p).add(new THREE.Vector3(35, -5, -20));
      this.camera.fov = 50;
    } else if (["MULTIPLAYER_LOBBY", "PLAYER_INTRO", "MAP_INTRO"].includes(state)) {
      // Lobby camera - overview
      const loc = this.track.at(0.05);
      cameraTarget.copy(loc.p).add(new THREE.Vector3(-60, 80, 50));
      lookTarget.copy(loc.p);
      this.camera.fov = 55;
      if (this.car) {
        this.car.update(dt, 0, 0, false, this.environment.night);
      }
    } else {
      const p = this.car.group.position,
        heading = this.car.group.rotation.y;
      const a = heading + 0.65 + Math.sin(this.time * 0.08) * 0.045;
      const dist = mobile ? 17 : 17;
      cameraTarget
        .copy(p)
        .add(
          new THREE.Vector3(
            Math.sin(a) * dist,
            mobile ? 7 : 6.1,
            Math.cos(a) * dist,
          ),
        );
      const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      lookTarget.copy(p).addScaledVector(right, mobile ? -1.2 : -4.8);
      lookTarget.y += mobile ? 5.4 : 2;
      this.camera.fov = mobile ? 48 : 42;
      this.car.update(dt, 0, 0, false, this.environment.night);
    }
    if (!this.cameraReady) {
      this.camera.position.copy(cameraTarget);
      this.smoothLook = lookTarget.clone();
      this.cameraReady = true;
    } else {
      const smooth = ["RACING", "COUNTDOWN"].includes(state)
        ? 1 - Math.exp(-dt * 5)
        : 1 - Math.exp(-dt * 3);
      this.camera.position.lerp(cameraTarget, smooth);
      this.smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 7));
    }
    this.camera.lookAt(this.smoothLook);
    this.camera.rotateZ(roll);
    this.camera.updateProjectionMatrix();
    const focus = this.car.group.position;
    this.sun.position.copy(focus).add(new THREE.Vector3(-55, 85, 35));
    this.sun.target.position.copy(focus);
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    
    // Performance: measure frame time
    const frameStart = performance.now();
    let dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    
    // FPS calculation
    if (this.debug.enabled) {
      this.debug.frameTime = performance.now() - frameStart;
      this.debug.fps = Math.round(1 / dt);
    }
    
    const frozen =
      ["PAUSED", "RESULTS"].includes(this.state) ||
      (this.state === "SETTINGS" && this.settingsReturn === "PAUSED");
    if (!frozen) this.time += dt;
    
    if (this.state === "COUNTDOWN") {
      this.countdown -= dt;
      const num = Math.max(1, Math.ceil(this.countdown - 0.4));
      if (num !== this.lastBeep) {
        this.lastBeep = num;
        this.audio.tone(440, 0.12, 0.11);
        const el = document.getElementById("countdown");
        if (el) {
          el.textContent = num;
          el.classList.remove("pop");
          void el.offsetWidth;
          el.classList.add("pop");
        }
      }
      if (this.countdown <= 0.4) {
        this.setState("RACING");
        this.audio.tone(880, 0.35, 0.14);
        const countdownEl = document.getElementById("countdown");
        if (countdownEl) countdownEl.textContent = "GO!";
        this.goUntil = 1.1;
      }
    } else if (this.state === "RACING") {
      const substeps = Math.ceil(dt / (1 / 60));
      for (let i = 0; i < substeps && this.state === "RACING"; i++)
        this.step(dt / substeps);
      if (this.raceTime > this.goUntil) {
        const el = document.getElementById("countdown");
        if (el) el.textContent = "";
      }
      this.hudClock += dt;
      if (this.hudClock > 0.055) {
        this.ui.updateHUD();
        this.hudClock = 0;
      }
    } else if (this.state === "MAP_INTRO") {
      if (this.time > this.mapIntroTime) {
        this.startMultiplayerRace();
      }
    }
    
    if (!frozen) {
      this.environment?.update(this.time);
      this.updateCamera(dt);
    }
    
    this.audio.update(
      dt,
      this.player?.speed || 0,
      this.state === "RACING" ? this.input.controls.throttle : 0,
      this.player?.drifting ||
        (this.input.controls.brake && Math.abs(this.player?.speed || 0) > 10),
      ["RACING", "COUNTDOWN"].includes(this.state),
      !!(this.player?.boosting || this.player?.itemBoosting),
    );
    
    // Performance: only reset info if debug enabled
    if (this.debug.enabled) {
      this.renderer.info.reset();
    }
    
    this.renderer.render(this.scene, this.camera);
    
    // Performance: clear collision cache periodically
    if (this.time % 5 < dt) {
      collisionSystem.clearCache();
    }
  }

  bindGarage() {
    const canvas = this.renderer.domElement;
    let dragging = false,
      last = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (!["GARAGE", "CHARACTER_SELECT"].includes(this.state)) return;
      dragging = true;
      last = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (dragging && ["GARAGE", "CHARACTER_SELECT"].includes(this.state)) {
        this.garageAngle -= (e.clientX - last) * 0.009;
        last = e.clientX;
      }
    });
    const up = () => (dragging = false);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!["GARAGE", "CHARACTER_SELECT"].includes(this.state)) return;
        e.preventDefault();
        this.garageZoom = THREE.MathUtils.clamp(
          this.garageZoom + e.deltaY * 0.01,
          8,
          20,
        );
      },
      { passive: false },
    );
  }

  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else
        this.ui.toast(
          "Fullscreen is not supported by this browser. Use landscape mode for a wider view.",
        );
    } catch {
      this.ui.toast(
        "Fullscreen is unavailable here. Open the game in its own tab to use fullscreen.",
      );
    }
  }

  showError(message) {
    this.state = "ERROR";
    this.ui.root.innerHTML = `<div class="error-screen"><h1>QUICK PIT STOP.</h1><p>${message}</p><button class="primary" onclick="location.reload()">RELOAD GAME</button></div>`;
  }

  // Debug toggle
  toggleDebug() {
    this.debug.enabled = !this.debug.enabled;
    if (this.debug.enabled) {
      console.log("[Debug] Enabled");
    } else {
      console.log("[Debug] Disabled");
      // Remove debug overlay if exists
      const overlay = document.getElementById("debug-overlay");
      if (overlay) overlay.remove();
    }
    this.ui.render();
  }
}