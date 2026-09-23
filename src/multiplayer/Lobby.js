import { supabase, isSupabaseConfigured } from "../supabase/client.js";
import { getCurrentUserId, getProfile } from "../supabase/auth.js";
import { serverClock } from "./Clock.js";

// Generate random 6-digit code
export function generateLobbyCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function validateLobbyCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: "Lobby code is required" };
  }
  const trimmed = code.trim();
  if (!/^[0-9]{6}$/.test(trimmed)) {
    return { valid: false, error: "Code must be exactly 6 digits" };
  }
  return { valid: true, code: trimmed };
}

export class LobbyManager {
  constructor() {
    this.currentLobby = null;
    this.currentPlayers = [];
    this.isHost = false;
    this.lobbyChannel = null;
    this.playersChannel = null;
    this.listeners = new Map();
    this.mockLobbies = this.loadMockLobbies();
  }

  loadMockLobbies() {
    try {
      return JSON.parse(localStorage.getItem("mock-lobbies") || "{}");
    } catch {
      return {};
    }
  }

  saveMockLobbies() {
    localStorage.setItem("mock-lobbies", JSON.stringify(this.mockLobbies));
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => {
      const arr = this.listeners.get(event);
      const idx = arr.indexOf(callback);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  emit(event, data) {
    const arr = this.listeners.get(event) || [];
    for (const cb of arr) {
      try {
        cb(data);
      } catch (e) {
        console.error(`[Lobby] Error in ${event} listener:`, e);
      }
    }
  }

  async createLobby(options = {}) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error("Not authenticated");

    const mode = options.mode || 'classic';
    const mapId = options.mapId || 'coast';
    let code = null;
    let attempts = 0;

    // Try to generate unique code
    while (attempts < 10) {
      if (isSupabaseConfigured()) {
        try {
          const { data, error } = await supabase.rpc('generate_lobby_code');
          if (error) throw error;
          code = data;
        } catch (e) {
          console.warn("[Lobby] RPC generate_lobby_code failed, using local:", e);
          code = generateLobbyCode();
        }
      } else {
        code = generateLobbyCode();
      }

      // Check if code exists in active lobbies (mock mode)
      if (!isSupabaseConfigured()) {
        const exists = Object.values(this.mockLobbies).some(
          l => l.code === code && ['waiting', 'starting', 'racing'].includes(l.status)
        );
        if (!exists) break;
      } else {
        break; // In real mode, DB function ensures uniqueness, and unique index will catch collision
      }
      attempts++;
    }

    if (!code) throw new Error("Failed to generate lobby code");

    try {
      if (isSupabaseConfigured()) {
        // Create lobby in Supabase
        const { data: lobby, error: lobbyError } = await supabase
          .from("lobbies")
          .insert({
            code,
            host_id: userId,
            mode,
            map_id: mapId,
            status: 'waiting',
            max_players: 8,
          })
          .select()
          .single();

        if (lobbyError) {
          // If code collision, retry once
          if (lobbyError.code === '23505') { // unique violation
            console.warn("[Lobby] Code collision, retrying...");
            return this.createLobby(options);
          }
          throw lobbyError;
        }

        // Add host as first player
        const profile = await getProfile(userId);
        const { data: player, error: playerError } = await supabase
          .from("lobby_players")
          .insert({
            lobby_id: lobby.id,
            player_id: userId,
            selected_car: options.car || 'gt',
            selected_character: options.character || (mode === 'kart' ? 'vex' : null),
            is_ready: false,
          })
          .select()
          .single();

        if (playerError) throw playerError;

        this.currentLobby = lobby;
        this.isHost = true;
        
        await this.subscribeToLobby(lobby.id);
        
        console.log("[Lobby] Created:", lobby.code, lobby.id);
        this.emit('lobbyCreated', { lobby, player });
        this.emit('lobbyUpdated', lobby);
        
        return { lobby, player };
      } else {
        // Mock mode
        const lobbyId = "lobby-" + Math.random().toString(36).slice(2, 11);
        const lobby = {
          id: lobbyId,
          code,
          host_id: userId,
          mode,
          map_id: mapId,
          status: 'waiting',
          max_players: 8,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        this.mockLobbies[lobbyId] = lobby;
        
        // Mock profiles
        const profiles = JSON.parse(localStorage.getItem("mock-profiles") || "{}");
        const profile = profiles[userId] || { username: "Player" };

        // Add player
        const playerId = "lp-" + Math.random().toString(36).slice(2, 11);
        const player = {
          id: playerId,
          lobby_id: lobbyId,
          player_id: userId,
          selected_car: options.car || 'gt',
          selected_character: options.character || (mode === 'kart' ? 'vex' : null),
          is_ready: false,
          joined_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          profiles: profile,
        };

        const mockPlayersKey = `mock-lobby-players-${lobbyId}`;
        const existing = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");
        existing.push(player);
        localStorage.setItem(mockPlayersKey, JSON.stringify(existing));

        this.saveMockLobbies();
        this.currentLobby = lobby;
        this.currentPlayers = existing;
        this.isHost = true;
        await this.subscribeToLobby(lobbyId);

        console.log("[Lobby] Created (mock):", lobby.code, lobby.id);
        this.emit('lobbyCreated', { lobby, player });
        this.emit('lobbyUpdated', lobby);
        this.emit('playersUpdated', existing);

        return { lobby, player };
      }
    } catch (e) {
      console.error("[Lobby] Create failed:", e);
      throw new Error(e.message || "Failed to create lobby");
    }
  }

  async joinLobby(code) {
    const validation = validateLobbyCode(code);
    if (!validation.valid) throw new Error(validation.error);

    const userId = getCurrentUserId();
    if (!userId) throw new Error("Not authenticated");

    try {
      if (isSupabaseConfigured()) {
        // Find lobby by code
        const { data: lobby, error: lobbyError } = await supabase
          .from("lobbies")
          .select("*")
          .eq("code", validation.code)
          .in("status", ["waiting"])
          .single();

        if (lobbyError || !lobby) {
          throw new Error("Lobby not found");
        }

        // Check if full
        const { count, error: countError } = await supabase
          .from("lobby_players")
          .select("*", { count: 'exact', head: true })
          .eq("lobby_id", lobby.id);

        if (countError) throw countError;

        if (count >= lobby.max_players) {
          throw new Error("Lobby is full");
        }

        if (lobby.status !== 'waiting') {
          throw new Error(lobby.status === 'racing' ? "Race has already started" : "Lobby is closed");
        }

        // Check if already member
        const { data: existing } = await supabase
          .from("lobby_players")
          .select("*")
          .eq("lobby_id", lobby.id)
          .eq("player_id", userId)
          .single();

        let player = existing;

        if (!existing) {
          // Join
          const { data: newPlayer, error: joinError } = await supabase
            .from("lobby_players")
            .insert({
              lobby_id: lobby.id,
              player_id: userId,
              selected_car: 'gt',
              selected_character: lobby.mode === 'kart' ? 'vex' : null,
              is_ready: false,
            })
            .select()
            .single();

          if (joinError) throw joinError;
          player = newPlayer;
        }

        this.currentLobby = lobby;
        this.isHost = lobby.host_id === userId;

        await this.subscribeToLobby(lobby.id);

        console.log("[Lobby] Joined:", lobby.code);
        this.emit('lobbyJoined', { lobby, player });
        this.emit('lobbyUpdated', lobby);

        return { lobby, player };
      } else {
        // Mock mode
        this.mockLobbies = this.loadMockLobbies();
        const lobby = Object.values(this.mockLobbies).find(
          l => l.code === validation.code && l.status === 'waiting'
        );

        if (!lobby) throw new Error("Lobby not found");

        const mockPlayersKey = `mock-lobby-players-${lobby.id}`;
        const existingPlayers = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");

        if (existingPlayers.length >= lobby.max_players) {
          throw new Error("Lobby is full");
        }

        if (existingPlayers.some(p => p.player_id === userId)) {
          // Already in lobby
          this.currentLobby = lobby;
          this.currentPlayers = existingPlayers;
          this.isHost = lobby.host_id === userId;
          return { lobby, player: existingPlayers.find(p => p.player_id === userId) };
        }

        const profiles = JSON.parse(localStorage.getItem("mock-profiles") || "{}");
        const profile = profiles[userId] || { username: "Player" };

        const playerId = "lp-" + Math.random().toString(36).slice(2, 11);
        const player = {
          id: playerId,
          lobby_id: lobby.id,
          player_id: userId,
          selected_car: 'gt',
          selected_character: lobby.mode === 'kart' ? 'vex' : null,
          is_ready: false,
          joined_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          profiles: profile,
        };

        existingPlayers.push(player);
        localStorage.setItem(mockPlayersKey, JSON.stringify(existingPlayers));

        this.currentLobby = lobby;
        this.currentPlayers = existingPlayers;
        this.isHost = lobby.host_id === userId;
        await this.subscribeToLobby(lobby.id);

        console.log("[Lobby] Joined (mock):", lobby.code);
        this.emit('lobbyJoined', { lobby, player });
        this.emit('lobbyUpdated', lobby);
        this.emit('playersUpdated', existingPlayers);

        return { lobby, player };
      }
    } catch (e) {
      console.error("[Lobby] Join failed:", e);
      throw new Error(e.message || "Unable to join lobby");
    }
  }

  async leaveLobby() {
    if (!this.currentLobby) return;

    const userId = getCurrentUserId();
    const lobbyId = this.currentLobby.id;

    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from("lobby_players")
          .delete()
          .eq("lobby_id", lobbyId)
          .eq("player_id", userId);

        if (error) throw error;
      } else {
        const mockPlayersKey = `mock-lobby-players-${lobbyId}`;
        let players = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");
        players = players.filter(p => p.player_id !== userId);
        localStorage.setItem(mockPlayersKey, JSON.stringify(players));

        // If host leaves, migrate host
        if (this.currentLobby.host_id === userId) {
          if (players.length > 0) {
            // Earliest joined becomes new host
            players.sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
            const newHost = players[0];
            this.mockLobbies[lobbyId].host_id = newHost.player_id;
            this.mockLobbies[lobbyId].updated_at = new Date().toISOString();
            this.saveMockLobbies();
            console.log("[Lobby] Host migrated to:", newHost.player_id);
          } else {
            // No players left, close lobby
            this.mockLobbies[lobbyId].status = 'closed';
            this.saveMockLobbies();
          }
        }

        this.emit('playersUpdated', players);
      }

      console.log("[Lobby] Left:", lobbyId);
    } catch (e) {
      console.error("[Lobby] Leave failed:", e);
    } finally {
      await this.unsubscribeFromLobby();
      this.currentLobby = null;
      this.currentPlayers = [];
      this.isHost = false;
      this.emit('lobbyLeft', {});
    }
  }

  async updatePlayerSelection({ car, character, isReady }) {
    if (!this.currentLobby) throw new Error("No lobby");

    const userId = getCurrentUserId();
    const updates = {};

    if (this.currentLobby.status !== 'waiting') throw new Error('Race roster is locked');
    if (car !== undefined || character !== undefined) updates.is_ready = false;
    if (car !== undefined) updates.selected_car = car;
    if (character !== undefined) updates.selected_character = character;
    if (isReady !== undefined) updates.is_ready = isReady;

    updates.last_seen_at = new Date().toISOString();

    try {
      if (isSupabaseConfigured()) {
        const { data, error } = await supabase
          .from("lobby_players")
          .update(updates)
          .eq("lobby_id", this.currentLobby.id)
          .eq("player_id", userId)
          .select()
          .single();

        if (error) throw error;
        this.emit('playerUpdated', data);
        return data;
      } else {
        const mockPlayersKey = `mock-lobby-players-${this.currentLobby.id}`;
        let players = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");
        const idx = players.findIndex(p => p.player_id === userId);
        if (idx >= 0) {
          players[idx] = { ...players[idx], ...updates };
          localStorage.setItem(mockPlayersKey, JSON.stringify(players));
          this.currentPlayers = players;
          this.emit('playersUpdated', players);
          this.emit('playerUpdated', players[idx]);
          return players[idx];
        }
      }
    } catch (e) {
      console.error("[Lobby] Update selection failed:", e);
      throw e;
    }
  }

  async updateLobbySettings({ mode, mapId }) {
    if (!this.currentLobby) throw new Error("No lobby");
    if (!this.isHost) throw new Error("Only host can change settings");

    const userId = getCurrentUserId();
    if (this.currentLobby.host_id !== userId) throw new Error("Not host");

    const updates = {};
    if (mode !== undefined) updates.mode = mode;
    if (mapId !== undefined) updates.map_id = mapId;
    updates.updated_at = new Date().toISOString();

    try {
      if (isSupabaseConfigured()) {
        const { data, error } = await supabase
          .from("lobbies")
          .update(updates)
          .eq("id", this.currentLobby.id)
          .eq("host_id", userId)
          .select()
          .single();

        if (error) throw error;
        this.currentLobby = data;
        this.emit('lobbyUpdated', data);
        return data;
      } else {
        this.mockLobbies[this.currentLobby.id] = {
          ...this.mockLobbies[this.currentLobby.id],
          ...updates,
        };
        this.saveMockLobbies();
        this.currentLobby = this.mockLobbies[this.currentLobby.id];
        this.emit('lobbyUpdated', this.currentLobby);
        return this.currentLobby;
      }
    } catch (e) {
      console.error("[Lobby] Update settings failed:", e);
      throw e;
    }
  }

  async startRace() {
    if (!this.currentLobby) throw new Error("No lobby");
    if (!this.isHost) throw new Error("Only host can start race");

    const userId = getCurrentUserId();

    try {
      if (isSupabaseConfigured()) {
        await serverClock.sync();
        const { data, error } = await supabase.rpc('start_race', { lobby_uuid: this.currentLobby.id });
        if (error) throw error;
        const lobby = Array.isArray(data) ? data[0] : data;
        this.applyLobby(lobby);
        return lobby;
      } else {
        // Mock validation
        const mockPlayersKey = `mock-lobby-players-${this.currentLobby.id}`;
        const players = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");

        if (players.length < 2) throw new Error("Need at least 2 players");
        if (players.length > 8) throw new Error("Too many players");
        if (!players.every(p => p.is_ready)) throw new Error("Not all players ready");
        if (!players.every(p => p.selected_car)) throw new Error("Invalid car selections");
        if (this.currentLobby.mode === 'kart' && !players.every(p => p.selected_character)) {
          throw new Error("Invalid character selections");
        }

        this.mockLobbies[this.currentLobby.id] = { ...this.currentLobby, status: 'starting',
          race_id: crypto.randomUUID(), race_start_at: new Date(serverClock.now() + 10000).toISOString(),
          updated_at: new Date().toISOString() };
        this.saveMockLobbies();
        this.applyLobby(this.mockLobbies[this.currentLobby.id]);
        return this.currentLobby;
      }
    } catch (e) {
      console.error("[Lobby] Start race failed:", e);
      throw e;
    }
  }

  applyLobby(lobby) {
    if (!lobby?.id || lobby.id !== this.currentLobby?.id) return;
    if (Date.parse(lobby.updated_at) < Date.parse(this.currentLobby.updated_at)) return;
    if (JSON.stringify(lobby) === JSON.stringify(this.currentLobby) && (lobby.status !== 'starting' || this.startEmitted === lobby.race_id)) return;
    this.currentLobby = lobby;
    this.isHost = lobby.host_id === getCurrentUserId();
    this.emit('lobbyUpdated', lobby);
    if (lobby.status === 'starting' && this.startEmitted !== lobby.race_id) {
      this.startEmitted = lobby.race_id;
      this.emit('raceStarting', lobby);
    }
    if (lobby.status === 'racing') this.emit('raceStarted', lobby);
    if (lobby.status === 'closed') this.emit('lobbyClosed', lobby);
  }

  async refreshLobby(lobbyId) {
    if (this.refreshBusy || this.currentLobby?.id !== lobbyId) return;
    this.refreshBusy = true;
    try {
      const { data } = await supabase.from('lobbies').select('*').eq('id', lobbyId).single();
      if (this.currentLobby?.id === lobbyId && data) this.applyLobby(data);
    } catch (error) { console.warn("[Lobby] Refresh deferred:", error.message); }
    finally { this.refreshBusy = false; }
  }

  async subscribeToLobby(lobbyId) {
    const generation = this.subscriptionGeneration = (this.subscriptionGeneration || 0) + 1;
    await this.unsubscribeFromLobby(false);
    if (generation !== this.subscriptionGeneration || this.currentLobby?.id !== lobbyId) return;
    this.subscribedLobbyId = lobbyId;
    if (isSupabaseConfigured()) {
      // Subscribe to lobby changes
      this.lobbyChannel = supabase
        .channel(`lobby-${lobbyId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'lobbies',
          filter: `id=eq.${lobbyId}`
        }, (payload) => {
          if (generation === this.subscriptionGeneration) this.applyLobby(payload.new);
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') void this.refreshLobby(lobbyId);
        });
      // Low-frequency durable-state recovery only. Never movement polling.
      this.refreshTimer = setInterval(() => void this.refreshLobby(lobbyId), 5000);

      // Subscribe to players
      this.playersChannel = supabase
        .channel(`lobby-players-${lobbyId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'lobby_players',
          filter: `lobby_id=eq.${lobbyId}`
        }, async (payload) => {
          console.log("[Lobby] Realtime players update:", payload);
          // Fetch all players
          const version = this.playersFetchVersion = (this.playersFetchVersion || 0) + 1;
          const players = await this.fetchPlayers(lobbyId);
          if (generation !== this.subscriptionGeneration || version !== this.playersFetchVersion || this.currentLobby?.id !== lobbyId) return;
          this.currentPlayers = players;
          this.emit('playersUpdated', players);
          
          if (payload.eventType === 'INSERT') {
            this.emit('playerJoined', payload.new);
          } else if (payload.eventType === 'DELETE') {
            this.emit('playerLeft', payload.old);
          } else if (payload.eventType === 'UPDATE') {
            this.emit('playerUpdated', payload.new);
          }
        })
        .subscribe();

      // Initial fetch
      const players = await this.fetchPlayers(lobbyId);
      if (generation !== this.subscriptionGeneration) return;
      this.currentPlayers = players;
      this.emit('playersUpdated', players);
    } else {
      // Mock mode - polling
      this.mockPollInterval = setInterval(() => {
        const mockPlayersKey = `mock-lobby-players-${lobbyId}`;
        const players = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");
        
        // Re-read shared storage so tabs see status/selection changes.
        this.mockLobbies = this.loadMockLobbies();
        const lobby = this.mockLobbies[lobbyId];
        if (!lobby) {
          this.emit('lobbyClosed', {});
          this.leaveLobby();
          return;
        }

        if (JSON.stringify(players) !== JSON.stringify(this.currentPlayers)) {
          this.currentPlayers = players;
          this.emit('playersUpdated', players);
        }
        this.applyLobby(lobby);
      }, 1000);
    }
  }

  async fetchPlayers(lobbyId) {
    try {
      if (isSupabaseConfigured()) {
        const { data, error } = await supabase
          .from("lobby_players")
          .select(`
            *,
            profiles (
              id,
              username
            )
          `)
          .eq("lobby_id", lobbyId)
          .order("joined_at", { ascending: true });

        if (error) throw error;
        return data || [];
      } else {
        const mockPlayersKey = `mock-lobby-players-${lobbyId}`;
        return JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");
      }
    } catch (e) {
      console.error("[Lobby] Fetch players failed:", e);
      return this.currentLobby?.id === lobbyId ? this.currentPlayers : [];
    }
  }

  async unsubscribeFromLobby(invalidate = true) {
    if (invalidate) this.subscriptionGeneration = (this.subscriptionGeneration || 0) + 1;
    this.playersFetchVersion = (this.playersFetchVersion || 0) + 1;
    this.subscribedLobbyId = null;
    this.startEmitted = null;
    clearInterval(this.refreshTimer); this.refreshTimer = null;
    clearInterval(this.mockPollInterval); this.mockPollInterval = null;
    const channels = [this.lobbyChannel, this.playersChannel].filter(Boolean);
    this.lobbyChannel = null; this.playersChannel = null;
    await Promise.allSettled(channels.map(channel => supabase.removeChannel(channel)));
  }

  getLobby() {
    return this.currentLobby;
  }

  getPlayers() {
    return this.currentPlayers;
  }

  getIsHost() {
    return this.isHost;
  }

}

export const lobbyManager = new LobbyManager();
