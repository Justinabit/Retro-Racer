# Changes - Multiplayer, Collision, Performance, Supabase Update

## Modified Files

### Core
- `src/core/Game.js`: Complete rewrite to support multiplayer, collision system, performance optimizations, username/lobby flow, player/map intros, host migration, debug mode. Preserves single-player with AI, adds multiplayer with NO AI.
- `src/player/CarPhysics.js`: Improved collision - CCD to prevent tunneling, ramp height handling, robust boundary correction (0.15 buffer, 0.75 damping), stuck detection (lowSpeed, invalidGeometry), fall detection, recovery method, reused vectors for performance.
- `src/ai/AICar.js`: Marked as AI (isAI=true), improved avoidance (broad-phase), stuck recovery, lane clamping, deltaS tunneling prevention. Isolated from multiplayer.
- `src/ui/UI.js`: Added multiplayer states (USERNAME_PROMPT, MULTIPLAYER_MENU, JOIN_LOBBY, MULTIPLAYER_LOBBY, PLAYER_INTRO, MAP_INTRO), performance caching (_cachedElements, _hudCache, setIfChanged), multiplayer UI, username validation, lobby code handling, ready system, name tags in minimap, debug overlay.
- `src/ui/icons.js`: Added users and copy icons.
- `src/effects/Particles.js`: Already optimized with pool (420), kept.
- `src/track/Track.js`: Existing with openEdge, routes - kept.
- `src/world/Environment.js`: Kept.
- `src/style.css`: Added 400+ lines for multiplayer UI (username overlay, lobby, player intro, map intro, results, debug, responsive).
- `src/main.js`: Added debug toggle (Ctrl+Shift+D), visibility and beforeunload handlers for disconnect.
- `vite.config.js`: Added supabase manual chunk.

### New Files
- `src/supabase/client.js`: Supabase client with mock fallback for offline development.
- `src/supabase/auth.js`: Anonymous auth, profile management, mock fallback.
- `src/multiplayer/Username.js`: Validation (3-16, letters/numbers/spaces, no HTML/JS/SQL), sanitization, uniqueness check, creation, prompt UI.
- `src/multiplayer/Lobby.js`: Lobby manager with 6-digit code generation, create/join/leave, selection updates, host settings, start validation (min 2, max 8, all ready, valid cars/chars), realtime subscriptions (postgres_changes), broadcast channel for positions, host migration, mock mode via localStorage.
- `src/multiplayer/MultiplayerRace.js`: RemotePlayer interpolation (buffer 10, smoothing 0.15, extrapolation 0.5s), name tags (canvas sprites), broadcast position sync 20Hz (not DB writes), power-up sync, finish handling, collision for human players only, NO AI, results.
- `src/physics/Collision.js`: CollisionSystem with broad-phase (cached), narrow-phase vehicle separation (mass ratio, buffer, impulse, damping), track boundary (soft/hard, openEdge), CCD (steps ceil(dist/2)), stuck detection (3s stuck, 2s invalid), fall detection (below, far, openEdge), recovery to checkpoint, separateVehicles helper.
- `supabase/schema.sql`: Complete schema (profiles, lobbies, lobby_players, race_sessions, race_results), functions (generate_lobby_code, can_start_race, handle_host_migration, cleanup_old_lobbies, update_updated_at), triggers, RLS policies, realtime notes, indexes.
- `supabase/migrations/001_initial_schema.sql`: Tables
- `supabase/migrations/002_functions_and_triggers.sql`: Functions and triggers
- `supabase/migrations/003_rls_policies.sql`: RLS
- `supabase/migrations/004_realtime.sql`: Realtime publication
- `supabase/README.md`: Setup documentation
- `.env.example`: Env vars
- `docs/MULTIPLAYER.md`: Architecture documentation
- `docs/CHANGES.md`: This file

### Unchanged (preserved)
- `src/data.js`: Cars, classic tracks
- `src/kart/data.js`: Characters, kart tracks, items, combineStats (preserved, but openEdges fixed to array)
- `src/kart/*`: Routes, Items, KartRace, World, UI, Character - preserved and reused
- `src/core/Audio.js`, `Input.js`, `Storage.js`: Preserved
- `src/player/Car.js`: Preserved
- `tests/*`: Existing tests still pass

## Important Changes Explained

### Collision Fixes
- **Tunneling**: Added CCD in CarPhysics - when moveDist >2, check intermediate positions with steps ceil(dist/2), correct if hits wall
- **Vehicle overlap**: New CollisionSystem with min separation 2.2, mass-based positional correction (ratioA = massB/total), buffer 0.05, impulse with restitution 0.2, damping 0.92, max velocity clamp
- **Track boundaries**: Improved correction with 0.15 buffer, 0.75 damping, lane clamped to -5..5, openEdge handling for Sky Island
- **Ramps**: Detect near ramps (0.3, 0.77) within 0.02 s and 6 units, add ramp height (0.55 + slope*0.14) to ground
- **Fall**: Check y < ground-16, distance >65, !isFinite, openEdge off track, _fallTime >1, recover to checkpoint
- **Stuck**: Track _stuckTime, _lowSpeedTime, _invalidGeomTime, shouldRecover after 4s or 3s invalid

### Performance
- **Game loop**: Reuse vectors (_cameraTarget, _lookTarget, _forward, _right, _tempVec), avoid new Vector3 in hot paths
- **DOM**: Cache elements in Map, only update HUD when changed (setIfChanged), minimap every other frame
- **Collision**: Broad-phase cache 100ms, clear every 5s
- **Rendering**: info.autoReset false, lower shadow resolution for low/medium, InstancedMesh for rails/posts/curbs/dashes, shared geometries
- **Particles**: Fixed pool 420, not create/destroy
- **Network**: Broadcast 20Hz, not 60Hz DB writes, only necessary data

### Multiplayer - Real Players Only
- **No AI in multiplayer**: Game.startRace spawns 7 AI, startMultiplayerRace spawns 0 AI, only human players from lobby_players
- **Lobby**: 6-digit numeric code via generate_lobby_code() (DB function or local random), unique among active via unique index where status in (waiting,starting,racing)
- **Max 8**: Enforced via RLS check count <8 and max_players constraint
- **Host**: Creator is host, only host can start/change map/mode, validated via RLS auth.uid()=host_id and can_start_race() RPC
- **Host migration**: Trigger handle_host_migration on DELETE, earliest joined becomes new host
- **Ready**: is_ready bool, requires valid car (and character for kart), host start disabled until all ready and min 2
- **Sync**: Broadcast channel race-{lobby.id} for player_state (pos, yaw, speed, vel, timestamp) at 20Hz, not DB
- **Interpolation**: RemotePlayer buffers 10 states, lerp with smoothing, yaw wrapping, extrapolation 0.5s then freeze
- **Name tags**: Canvas sprites, face camera (Sprite), distance culling >80, scale with distance
- **Power-ups**: Collection broadcast, cooldown to prevent double, host authority concept
- **Disconnect**: Presence and last_seen_at, lobby leave removes player, host migration, during race freeze vehicle
- **Results**: Only real players, from rankRacers, saved to race_results if Supabase configured

### Supabase
- **Client**: Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, mock fallback if not configured (localStorage-based lobbies for same-browser testing)
- **Auth**: Anonymous sign-in, fallback mock user, profile creation
- **SQL**: Complete schema in supabase/schema.sql and migrations, matches application code (lobbies.code, lobby_players.selected_character, race_results.finishing_position, etc)
- **RLS**: Enabled, policies for profiles, lobbies, lobby_players, race_sessions, race_results
- **Realtime**: Postgres Changes for lobby/players, Broadcast for positions, Presence for online
- **Security**: No service-role key in browser, only anon, validation server-side

### Username
- **Prompt**: First use shows USERNAME_PROMPT if no valid stored username
- **Validation**: Trim, 3-16, letters/numbers/spaces, no HTML/JS/SQL, normalize spaces, prevent empty/only spaces
- **Unique**: Case-insensitive lower(username), allow own
- **Save**: localStorage pixel-racer-username, pixel-racer-save.name, Supabase profiles
- **Display**: Above car (name tags), lobby, intros, grid, race, leaderboard, results
- **Change**: Via settings or multiplayer menu

### Pre-race Intros
- **Player highlights**: For each human player, show username, character (kart), car, number, progress bar, NEXT button
- **Map highlight**: Track name, preview, laps, length, player count (human only), mode, shortcuts, hazards, ramps, boost pads
- **Starting grid**: Only real players, P1, P2, etc, no AI
- **Countdown**: 3,2,1,GO! existing

## Testing Checklist
See docs/MULTIPLAYER.md for full checklist. Key:
- Username valid/invalid/duplicate/persistence
- Lobby create unique 6-digit, join valid/invalid/full/closed, multiple joins realtime, leave, host leave migration
- Selection car/character, ready
- Host can start, non-host cannot, host can change map/mode, non-host cannot
- Multiplayer 2-8 players, NO AI in any case, grid = human count, intros = human count
- Race countdown, movement, collision no-clipping, remote interpolation smooth, name tags, power-ups sync, lap counting, finishing, results only real players
- Disconnect in lobby, host disconnect, during race, reconnect
- Performance long session, multiple players, heavy map, effects, collisions, network
