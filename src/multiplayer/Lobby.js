import { supabase, isSupabaseConfigured } from "../supabase/client.js";
import { getCurrentUserId, getProfile } from "../supabase/auth.js";
import { validateUsername } from "./Username.js";

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
    this.broadcastChannel = null;
    this.presenceChannel = null;
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
        // Validate via RPC
        const { data: canStart, error: validateError } = await supabase
          .rpc('can_start_race', {
            lobby_uuid: this.currentLobby.id,
            requester_id: userId,
          });

        if (validateError) throw validateError;

        if (!canStart) {
          throw new Error("Cannot start race: not all players ready, invalid selections, or not enough players");
        }

        // Update lobby status to starting
        const { data, error } = await supabase
          .from("lobbies")
          .update({ status: 'starting', updated_at: new Date().toISOString() })
          .eq("id", this.currentLobby.id)
          .eq("host_id", userId)
          .select()
          .single();

        if (error) throw error;

        this.currentLobby = data;
        // Note: don't emit 'raceStarting' manually here — the host is also
        // subscribed to this lobby's realtime channel (see subscribeToLobby),
        // which will independently deliver this exact same status change.
        // Emitting it here too caused the host to run the race-start flow
        // twice, corrupting mid-race state.

        // After a brief delay, set to racing. This delay is the multiplayer
        // "highlight screen" window shown to all clients (bounded to <=5s) —
        // every client transitions off it in lockstep because they all react
        // to this same realtime status change, not to their own local timer.
        setTimeout(async () => {
          try {
            const { data: racingData } = await supabase
              .from("lobbies")
              .update({ status: 'racing', updated_at: new Date().toISOString() })
              .eq("id", this.currentLobby.id)
              .select()
              .single();

            if (racingData) {
              this.currentLobby = racingData;
              // Same reasoning: realtime subscription already emits
              // 'raceStarted' for this update, don't double-emit here.
            }
          } catch (e) {
            console.error("[Lobby] Failed to set racing:", e);
          }
        }, 4200);

        return data;
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

        this.mockLobbies[this.currentLobby.id].status = 'starting';
        this.mockLobbies[this.currentLobby.id].updated_at = new Date().toISOString();
        this.saveMockLobbies();
        this.currentLobby = this.mockLobbies[this.currentLobby.id];
        this.emit('lobbyUpdated', this.currentLobby);
        this.emit('raceStarting', this.currentLobby);

        setTimeout(() => {
          this.mockLobbies[this.currentLobby.id].status = 'racing';
          this.mockLobbies[this.currentLobby.id].updated_at = new Date().toISOString();
          this.saveMockLobbies();
          this.currentLobby = this.mockLobbies[this.currentLobby.id];
          this.emit('lobbyUpdated', this.currentLobby);
          this.emit('raceStarted', this.currentLobby);
        }, 4200);

        return this.currentLobby;
      }
    } catch (e) {
      console.error("[Lobby] Start race failed:", e);
      throw e;
    }
  }

  async subscribeToLobby(lobbyId) {
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
          console.log("[Lobby] Realtime lobby update:", payload);
          if (payload.new) {
            this.currentLobby = payload.new;
            this.isHost = payload.new.host_id === getCurrentUserId();
            this.emit('lobbyUpdated', payload.new);
            
            if (payload.new.status === 'starting') {
              this.emit('raceStarting', payload.new);
            } else if (payload.new.status === 'racing') {
              this.emit('raceStarted', payload.new);
            } else if (payload.new.status === 'closed') {
              this.emit('lobbyClosed', payload.new);
            }
          }
        })
        .subscribe();

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
          const players = await this.fetchPlayers(lobbyId);
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
      this.currentPlayers = players;
      this.emit('playersUpdated', players);
    } else {
      // Mock mode - polling
      this.mockPollInterval = setInterval(() => {
        const mockPlayersKey = `mock-lobby-players-${lobbyId}`;
        const players = JSON.parse(localStorage.getItem(mockPlayersKey) || "[]");
        
        // Check if lobby still exists
        const lobby = this.mockLobbies[lobbyId];
        if (!lobby) {
          this.emit('lobbyClosed', {});
          this.leaveLobby();
          return;
        }

        // Check for changes
        const currentIds = new Set(this.currentPlayers.map(p => p.id));
        const newIds = new Set(players.map(p => p.id));
        
        if (currentIds.size !== newIds.size || 
            JSON.stringify(players.map(p => p.is_ready).sort()) !== 
            JSON.stringify(this.currentPlayers.map(p => p.is_ready).sort())) {
          this.currentPlayers = players;
          this.emit('playersUpdated', players);
        }

        // Check lobby status changes
        if (lobby.status !== this.currentLobby?.status) {
          this.currentLobby = lobby;
          this.emit('lobbyUpdated', lobby);
          if (lobby.status === 'starting') this.emit('raceStarting', lobby);
          if (lobby.status === 'racing') this.emit('raceStarted', lobby);
          if (lobby.status === 'closed') this.emit('lobbyClosed', lobby);
        }
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
      return [];
    }
  }

  async unsubscribeFromLobby() {
    if (this.lobbyChannel) {
      try {
        await supabase.removeChannel(this.lobbyChannel);
      } catch {}
      this.lobbyChannel = null;
    }
    if (this.playersChannel) {
      try {
        await supabase.removeChannel(this.playersChannel);
      } catch {}
      this.playersChannel = null;
    }
    if (this.broadcastChannel) {
      try {
        await supabase.removeChannel(this.broadcastChannel);
      } catch {}
      this.broadcastChannel = null;
    }
    if (this.presenceChannel) {
      try {
        await supabase.removeChannel(this.presenceChannel);
      } catch {}
      this.presenceChannel = null;
    }
    if (this.mockPollInterval) {
      clearInterval(this.mockPollInterval);
      this.mockPollInterval = null;
    }
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

  // For broadcast channel (position sync)
  // Note: this creates the channel but does NOT subscribe it yet.
  // Supabase realtime requires all `.on(...)` listeners to be registered
  // BEFORE `.subscribe()` is called, or they silently never fire. The
  // caller (MultiplayerRace.setupBroadcast) registers its listeners and
  // then calls subscribeBroadcastChannel() itself once ready.
  getBroadcastChannel() {
    if (!this.currentLobby) return null;
    
    const channelName = `race-${this.currentLobby.id}`;
    
    if (!this.broadcastChannel) {
      if (isSupabaseConfigured()) {
        this.broadcastChannel = supabase.channel(channelName, {
          config: {
            broadcast: { self: false },
          },
        });
        this._broadcastChannelSubscribed = false;
      } else {
        // Mock broadcast using localStorage events
        this.broadcastChannel = {
          name: channelName,
          send: async ({ type, event, payload }) => {
            const key = `broadcast-${channelName}-${event}`;
            localStorage.setItem(key, JSON.stringify({ payload, timestamp: Date.now() }));
            // Dispatch storage event for same-tab testing
            window.dispatchEvent(new StorageEvent('storage', {
              key,
              newValue: JSON.stringify({ payload, timestamp: Date.now() }),
            }));
          },
          on: (type, filter, cb) => {
            if (type === 'broadcast') {
              const eventName = filter.event;
              const handler = (e) => {
                if (e.key && e.key.startsWith(`broadcast-${channelName}-${eventName}`)) {
                  try {
                    const data = JSON.parse(e.newValue);
                    cb({ payload: data.payload });
                  } catch {}
                }
              };
              window.addEventListener('storage', handler);
              return this.broadcastChannel;
            }
            return this.broadcastChannel;
          },
          subscribe: () => this.broadcastChannel,
          unsubscribe: () => {},
        };
        this._broadcastChannelSubscribed = true; // mock has nothing to subscribe
      }
    }
    
    return this.broadcastChannel;
  }

  // Subscribes the broadcast channel. Safe to call multiple times — only
  // actually subscribes once. Call this AFTER all `.on(...)` listeners
  // have been registered on the channel returned by getBroadcastChannel().
  subscribeBroadcastChannel() {
    if (!this.broadcastChannel || this._broadcastChannelSubscribed) return;
    this._broadcastChannelSubscribed = true;
    this.broadcastChannel.subscribe((status) => {
      console.log("[Lobby] Broadcast channel status:", status);
    });
  }
}

// Singleton
export const lobbyManager = new LobbyManager();