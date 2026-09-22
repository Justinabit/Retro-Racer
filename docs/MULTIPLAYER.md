# Multiplayer Architecture - Pixel Racer 3D

## Overview

Multiplayer is **real-player only** - NEVER AI. The system uses Supabase for persistent state and Realtime Broadcast for ephemeral position sync.

## Flow

```
OPEN GAME
  ↓
USERNAME CHECK (3-16 chars, letters/numbers/spaces)
  ↓
MAIN MENU
  Single Player | Multiplayer | Settings
  ↓
MULTIPLAYER MENU
  Create Lobby | Join Lobby
  ↓
CREATE LOBBY
  Generates 6-digit code (e.g., 482193)
  Host auto-joins as P1
  ↓
LOBBY (waiting)
  Code: 482193
  Players: 1/8, 2/8, ... 8/8 max
  Mode: classic/kart
  Map: selected track
  Each player: car, character (kart), ready state
  Realtime updates for join/leave/selection/ready
  ↓
ALL READY (min 2, max 8, all ready, valid selections)
  Host can start
  ↓
PLAYER HIGHLIGHTS
  Cinematic intro for each HUMAN player only
  Shows username, character, car
  No AI
  ↓
MAP HIGHLIGHT
  Track name, preview, laps, length, shortcuts, hazards
  ↓
STARTING GRID
  Only real players, P1, P2, P3...
  No AI fallback
  ↓
COUNTDOWN
  3, 2, 1, GO!
  ↓
MULTIPLAYER RACE
  Local player: immediate responsive controls, physics, no server wait
  Remote players: interpolation, state buffering, smoothing
  Name tags above cars (canvas sprites, face camera, distance culling)
  Power-ups: synchronized collection (host authority for box ownership)
  Collision: robust vehicle separation, track boundaries, no-clipping fixes
  Fall detection: recover to checkpoint
  Stuck detection: recover after 4s
  ↓
RESULTS
  Only real players
  Positions from rankRacers (progress-based, finish time tie-break)
  Saved to race_results if Supabase configured
  ↓
RETURN TO LOBBY / MENU
```

## Supabase Integration

### Tables

- **profiles**: id (uuid, FK auth.users), username (unique case-insensitive, 3-16 chars, safe)
- **lobbies**: id, code (6-digit numeric, unique among active), host_id, mode, map_id, status (waiting, starting, racing, finished, closed), max_players (8), timestamps
- **lobby_players**: id, lobby_id, player_id, selected_car, selected_character, is_ready, joined_at, last_seen_at, unique(lobby_id, player_id)
- **race_sessions**: id, lobby_id, started_at, finished_at, mode, map_id, status
- **race_results**: id, race_id, player_id, finishing_position (1-8), finish_time, unique(race_id, player_id), unique(race_id, finishing_position) - NO AI rows

### Functions

- `generate_lobby_code()`: Random 6-digit, checks active lobbies, retries up to 100
- `can_start_race(lobby_uuid, requester_id)`: Validates host, waiting status, 2-8 players, all ready, valid cars/characters
- `handle_host_migration()`: Trigger on lobby_players DELETE, if host leaves, earliest joined becomes new host, else close lobby
- `cleanup_old_lobbies()`: Close waiting >24h, delete closed >7d
- `update_updated_at()`: Trigger for updated_at

### RLS

Enabled on all tables. Policies:
- Profiles viewable by all, users can only insert/update own
- Lobbies viewable by all, auth can create, only host can update/delete
- Lobby_players viewable by all, auth can join waiting lobbies with <8 players, users can update/delete own, host can delete any
- Race_sessions viewable by lobby members, only host can create/update
- Race_results viewable by all, players can insert own, host can insert for lobby

### Realtime

- **Postgres Changes**: lobbies, lobby_players, race_sessions, race_results, profiles for lobby membership, ready, selections, host, status
- **Broadcast**: Ephemeral position sync (20Hz), power-up events, finish events - NOT stored in DB
- **Presence**: Online status, disconnect handling

### Security

- No service-role key in browser, only anon key via VITE_SUPABASE_ANON_KEY
- Username validation: trim, normalize spaces, 3-16, letters/numbers/spaces, no HTML/JS/SQL
- Lobby code validation: exactly 6 digits, numeric only
- Host validation server-side via RLS and can_start_race()
- No client can claim host, finish position, etc without validation

## Networking

### DO NOT use PostgreSQL for 60 FPS position

- Persistent state (lobby, ready, selections, results) in DB
- Ephemeral state (position, rotation, velocity) via Broadcast

### Broadcast Message Format

```json
{
  "player_id": "uuid",
  "x": 123.4,
  "y": 0.5,
  "z": -456.7,
  "yaw": 1.2,
  "speed": 25.3,
  "vx": 10,
  "vy": 0,
  "vz": 20,
  "timestamp": 123456789
}
```

- Sent at 20Hz (50ms interval)
- Only when race active
- Self: false (don't receive own)

### Interpolation

- RemotePlayer class buffers last 10 states
- Lerp position towards target with smoothing 0.15
- Yaw wrapping with atan2(sin, cos)
- Extrapolation for up to 0.5s if no update, then freeze
- Name tags: THREE.Sprite with canvas texture, distance culling >80, scale with distance

### Power-up Sync

- Collection: When player collects box, broadcast powerup_collected {player_id, box_index, item}
- Host authority: box cooldown set to 5s to prevent double collection
- Activation: Broadcast powerup_used {player_id, item, target}
- Effects: Visual particles, shield, boost, etc handled locally but notified

## Collision Improvements

### Previous Bugs Fixed

- Tunneling through walls at high speed: Added continuous collision detection (CCD) with substeps, checking intermediate positions
- Vehicle overlap: Robust separation with mass ratio, penetration correction + buffer, velocity impulse with restitution, damping
- Track boundary clipping: More robust correction (0.15 buffer, 0.75 damping), clamp lane to -5..5
- Ramp falling through: Added ramp height detection near ramps (0.3, 0.77), ground = max(track ground, ramp height)
- Falling through map: Improved fall detection (y < ground-16, distance >65, openEdge, !isFinite), recover to checkpoint
- Stuck in geometry: Stuck detection (speed <1.5 while trying to move for 3s, invalid geometry distance >25 for 2s), recover after 4s
- AI stuck: Added stuckTime tracking, lane reversal, forward teleport if >5s

### New Collision System (src/physics/Collision.js)

- Broad-phase: distance check <15, cached 100ms
- Narrow-phase: precise penetration, normal
- Vehicle collision: min separation 2.2, mass-based correction, impulse, damping, max velocity clamp
- Track boundary: soft (offroad) vs hard (collision), openEdge handling for Sky Island
- CCD: Check intermediate positions when moveDist >2, steps = ceil(dist/2)
- Stuck: lowSpeedTime, invalidGeometryTime, shouldRecover
- Fall: isBelow, isFar, isOffOpenEdge
- Recovery: to checkpoint (checkpoint-1)/12+0.003, reset velocity, 2s lock, 3s immunity

## Performance Optimizations

### Game Loop

- Reuse vectors: _cameraTarget, _lookTarget, _forward, _right, _tempVec to avoid creation
- Cache DOM elements: _cachedElements Map, getElement(id)
- HUD: Only update DOM when value changed (cache lap, position, timer, etc), minimap every other frame
- Collision: Broad-phase cache, clear every 5s
- Particles: Fixed pool (420), reuse, not create/destroy every frame
- Rendering: renderer.info.autoReset = false, only reset if debug enabled
- Shadow: Lower resolution for low/medium (512/1024 vs 2048)
- AI: Personality-based, not every frame heavy

### Three.js

- Shared geometries and materials where possible (Car.js merged bodywork, instanced meshes for rails, curbs, dashes)
- Frustum culling (default, but ensure not disabled unnecessarily)
- InstancedMesh for repeated objects (rails, posts, curbs, dashes)
- Texture reuse (asphalt DataTexture)
- Object pooling for particles and skid marks

### HUD

- setIfChanged pattern for lap, position, timer, bestLap, speed, gear, drift, checkpoint
- Nitro and RPM always update (frequent)
- Minimap redraw throttled

### Network

- Broadcast 20Hz, not 60Hz DB writes
- Only send necessary data (pos, yaw, speed, vel, timestamp)
- Interpolation smooths remote movement
- Local movement immediate, no server wait

## Username System

- First use: Check localStorage pixel-racer-username and pixel-racer-save.name
- If invalid/missing, show USERNAME_PROMPT state
- Validation: trim, 3-16, letters/numbers/spaces, no HTML/JS/SQL, normalize spaces
- Unique check: Case-insensitive via lower(username), allow own
- Save to: localStorage pixel-racer-username, pixel-racer-save.name, Supabase profiles
- Display: Above car (name tags), lobby, intros, grid, race, leaderboard, results
- Change: Via settings or multiplayer menu

## Host System

- Creator becomes host
- Only host can: start race, change map/mode, close lobby, kick (if implemented)
- Frontend hides/disables host controls for non-host
- Backend: RLS policies check auth.uid() = host_id, can_start_race() validates host
- Host disconnect: Trigger handle_host_migration, earliest joined becomes new host, deterministic (joined_at asc)

## Testing Checklist

### Username
- [ ] New user prompt
- [ ] Invalid (too short, too long, bad chars, HTML, SQL)
- [ ] Duplicate
- [ ] Persistence after refresh
- [ ] Change via settings

### Lobby
- [ ] Create generates unique 6-digit code
- [ ] Join with valid code
- [ ] Invalid code (letters, symbols, wrong length)
- [ ] Full lobby (8/8)
- [ ] Closed/racing lobby
- [ ] Multiple joins realtime
- [ ] Leave
- [ ] Host leave -> migration
- [ ] Host migration deterministic (earliest)

### Selection
- [ ] Classic: car selection
- [ ] Kart: character + car
- [ ] Ready state
- [ ] Ready requires valid selections

### Host
- [ ] Host can start (all ready, 2-8 players, valid)
- [ ] Non-host cannot start
- [ ] Host can change map/mode
- [ ] Non-host cannot change protected settings
- [ ] Server-side validation for start

### Multiplayer Race
- [ ] 2,3,4,5,6,7,8 players - NO AI in any case
- [ ] Starting grid = human count
- [ ] Player intros = human count
- [ ] Countdown
- [ ] Movement responsive
- [ ] Remote interpolation smooth, no teleport
- [ ] Collision no-clipping fixed
- [ ] Name tags
- [ ] Power-ups sync
- [ ] Lap counting
- [ ] Finish
- [ ] Results only real players

### Disconnect
- [ ] Player disconnect in lobby
- [ ] Host disconnect in lobby -> migration
- [ ] Player disconnect during race -> frozen
- [ ] Reconnect (if supported)
- [ ] Tab close, refresh

### Performance
- [ ] Long session stable FPS
- [ ] Multiple players smooth
- [ ] Heavy map (forest, city)
- [ ] Many effects
- [ ] Many collisions
- [ ] Network activity low

## Known Limitations

- No dedicated server - P2P via Broadcast, host is not authoritative for physics (could be cheated)
- No anti-cheat beyond basic validation
- Power-up sync is optimistic, host not fully authoritative
- No voice chat
- No spectator mode
- Reconnect during race limited (position sync resumes, but lap progress may be off)
- Offline mock mode only works same browser (localStorage), not real multiplayer without Supabase

## Future Improvements

- Authoritative server for physics and power-ups
- Lag compensation
- Better host migration during race
- Spectator
- Chat
- Matchmaking
- Leaderboards global
- Replay
