# Multiplayer: synchronization audit and current implementation

## Deployment gate

**Apply `supabase/migrations/005_race_network.sql` before deploying this client to an existing project.** New installations may run `supabase/schema.sql` and enable the table publications described in `supabase/README.md`. No movement table or per-frame SQL write is introduced.

The changes have automated coverage, but **live Supabase websocket authorization, WAN reconnection, and competitive eight-device performance still require deployment testing**. This checkout has no configured Supabase project. Do not treat the offline tests as certification of online playability.

## Audit of the previous implementation

The audit followed this exact path:

`Input.controls → Game.step → CarPhysics.update → MultiplayerRace.after → broadcastLocalState → LobbyManager race channel → player_state callback → RemotePlayer.addState → RemotePlayer.update → Car.group → renderer.render`

| Question | What the source actually did / defect found |
|---|---|
| Initialization/authentication | `supabase/client.js` creates one browser client. `auth.js` restores or anonymously authenticates a Supabase user. A real authentication failure previously fabricated a mock user ID while still using real SQL; that fallback is now prohibited when configured. |
| Lobby persistence | `lobbies`, `lobby_players`, and `profiles`; membership keyed by authenticated user ID, with PostgreSQL change subscriptions. The invoker host-migration trigger attempted to change `host_id` under an RLS policy requiring the new ID to still be the departing user. SQL 005 fixes this with a fixed-scope definer trigger. |
| Send location/rate | `MultiplayerRace.after()` called a 50 ms gate: at most 20 Hz, dependent on physics stepping. No movement SQL writes were present. Rendering was not awaiting a network request. |
| Storage/transport | Transient Broadcast payload on a lobby-owned race channel, not PostgreSQL. The old `eventsPerSecond: 20` client option did not implement application-level backpressure; it has been removed, not increased. |
| Reception | Callback selected the remote map entry using a payload-supplied `player_id`, without membership/finite-value/sequence validation or authenticated sender binding. |
| Timestamps/order | Sender used `performance.now()`, but `addState()` replaced it with receiver arrival time. No sequence number or stale-packet rejection existed. |
| Buffer/interpolation | A ten-entry array was filled but **never sampled**. Rendering lerped to the newest target by `0.15` **per frame**, so visual delay grew as frame rate fell. |
| Frozen mesh bug | After one second without a packet, prediction changed `remote.position` but skipped the only `car.group.position.copy(...)` call. Thus the predicted vehicle never reached the renderer. Prediction then stopped after half a second. |
| Rotation/velocity | Only yaw was sent. Yaw chasing was frame-dependent; velocity was not used between ordinary packets. |
| Subscription lifetime | First-race callbacks were registered before subscribing, but race disposal only nulled its channel reference. The lobby retained the channel and old closures. Subsequent races attached additional handlers to it. Lobby subscription setup also lacked teardown/generation protection. |
| Progress/results | Remote `RaceProgress` was initialized at the grid and **never updated**. Only the host created/received a race session ID, so guests could not persist their results. Client-chosen finishing positions could conflict with the database unique position constraint. |
| Grid/start | A host-side 4.2-second timeout changed lobby status. Each receiver loaded assets and independently ran another 3.8-second countdown, making load time and event arrival time part of the starting advantage. |
| Selected physics | `getCarSpecForPlayer()` ignored `CARS` and `combineStats`, returning placeholder 75-valued physics. The chosen visible car and actual multiplayer physics did not match. |
| Kart interactions | The Kart race wrapper contained the local human only (the AI list was empty). Remote item handlers existed but local item activation did not send them. |
| Collision/recovery | Remote velocity and position were cosmetically modified after receiving state; a second track-boundary resolver competed with `CarPhysics`. Classic multiplayer fall recovery attempted an optional Kart-only method and did nothing. |
| Assets/camera/loop | The existing renderer, world reuse, physics substeps, input simulation, and exponential chase-camera damping were usable and retained. No justification was found for rebuilding these systems. |

These are source-level, reproducible defects, not a claim that every possible production freeze had one cause. Packet delivery on the user's actual Supabase project cannot be traced without a deployed connection.

## Current boundaries

### Persistent state

- Existing profile, username, lobby, selection, ready, map and mode records.
- `start_race(lobby_uuid)` validates `auth.uid()` as host and readiness, locks the lobby, creates one race session and an immutable `race_members` grid, and writes a shared server deadline ten seconds ahead.
- Membership mutation triggers serialize joins/selections against that start lock, prevent identity changes, and enforce capacity.
- `mark_race_started(rid)` allows a roster member to acknowledge GO only once the **server** deadline has elapsed. The host's browser need not remain connected.
- `submit_race_finish(rid, seconds)` is authenticated, idempotent, clock-bounded, and race-member-only. It serializes result ranking by finish time and finishes the persistent session once all roster members have submitted. Raw client result writes are revoked.
- Lobby recovery reads occur every five seconds; result recovery/retries every three seconds. Neither contains vehicle movement.

### Transient transport

`RaceTransport.js` owns channel lifetime, status, Presence, and sends. `NetworkState.js` is engine-independent validation/interpolation logic. `MultiplayerRace.js` maps authenticated IDs to actual vehicles and progress.

**Topic layout: `race:<raceId>:<authenticatedPlayerId>`**

Each client subscribes to exactly the same bounded set of race-member topics (2–8); it only publishes/tracks Presence on its own topic. These use the existing Supabase Realtime websocket, not one socket per player. A two-player game therefore has two race topics per client, plus the two low-frequency lobby subscriptions; eight players have eight plus two. These are intentional channels, not duplicates.

Why not one public/shared topic? Supabase's topic authorization does not authenticate arbitrary `playerId` fields inside each Broadcast payload. SQL policies allow reads only to the frozen race roster and writes only to the topic owner's `auth.uid()`. The receive callback binds the topic owner before packet validation. A player sending another player's ID on their own topic is rejected, and cannot publish on the victim's private topic. **Do not add broad permissive `realtime.messages` policies**, which would OR with these policies and defeat this boundary.

### State pipeline

1. The existing local `CarPhysics` simulates immediately from input, with normal substeps. It never awaits transport or DB acknowledgement.
2. Once per render frame, a separate networking pass samples fresh state, including while the grid/results are visible.
3. A configurable `NETWORK.rate` cap defaults to 20 Hz. Stationary states suppress unneeded sends but heartbeat every 500 ms. There is at most one in-flight send; packets are not queued for later catch-up. A saturated websocket buffer or disconnected channel drops the send attempt instead of triggering the SDK's unsubscribed HTTP fallback.
4. Packets identify type, race, authenticated player, sequence, and sender-monotonic timestamp; position, three rotation components, velocity, steering, throttle/brake/drift/boost flags, lap/checkpoint/progress, finish time and small Kart state travel together.
5. The receiver rejects nonfinite/out-of-range data, wrong sender/race, duplicate/older sequences, and backward timestamps.
6. Each remote stores at most 32 snapshots. A minimum-transit clock-offset estimate maps the sender's monotonic timeline to the receiver without comparing browser wall clocks.
7. The view samples 100 ms behind that timeline, interpolates position and wrapped angles, and quaternion-slerps mesh orientation. If a packet is missing it predicts from velocity for **at most 150 ms**, then stops predicting. Small corrections use time-based damping; errors over 35 world units reset in a controlled snap.
8. The sampled state **always updates the car mesh**, including prediction/stale branches. Wheels, steering and brake lights update at render rate. Progress/ranking use received race progress rather than inference from the delayed mesh.

The engine's chassis physics only rotates around yaw; packet pitch/roll are currently zero, matching the actual local group. The existing body lean animation uses synchronized steering/speed and is now frame-rate independent. No fake pitch/roll physics was added.

### Connection/lifecycle

- All handlers are bound before subscription. Start/dispose are idempotent; subscription generations prevent late lobby fetches/listeners from changing a replacement lobby.
- Per-topic connection errors schedule a single jittered retry. A successful SDK rejoin cancels it. Disconnected sends are dropped. Fresh full-state heartbeats restore remote state without replaying an old movement queue.
- Presence marks availability; it does not transport movement. Temporary outages retain the car/interpolation buffer. With the local connection healthy, 30 seconds without a remote update retires that racer to DNF and releases the scene objects, tags, item references, and channel. Explicit lobby departure removes them immediately, retaining only their results entry.
- Long outages that exceed that retirement grace require a new race; full page-reload race resumption is not implemented.
- Tags, textures, sprite materials, cars, interpolation buffers, handlers, timers and channels are released on leaving/restarting. The lobby's persistent subscription lifetime is separate from the race's transport lifetime.
- Multiplayer does not locally pause the race on blur/ESC; it clears input instead. Single-player pause is unchanged.

### Kart and collision behavior

- Kart item rosters now include only the real local/remote humans. Remote entries never run AI activation, collect boxes locally, or have their physics modified by another client's item simulation.
- Pickup/activation events have sequence IDs and a bounded retransmission journal. Peers acknowledge processed events in snapshots; duplicates are ignored. The journal expires after five seconds so an ancient attack is not replayed after a long outage. Durable start/finish are **not** dependent on this journal.
- Remote activation uses the existing item simulation for visuals/projectiles, with authenticated target IDs mapped to local item indices. Only the victim's client applies hit physics. Current shield/boost/turbo/magnet timers also travel in snapshots to recover their visual state.
- **Limit:** simultaneous item-box claims are still client-authoritative, not centrally arbitrated. This is not server-authoritative anti-cheat, nor guaranteed attack delivery after a multi-second outage. A host/server arbiter would be needed for strict tournament-grade item ownership and hit validation.
- Local-versus-remote impacts use bounded position correction/impulse and a cooldown; stale cars cannot create ghost impacts. There are no remote-versus-remote cosmetic pushes or duplicate track-boundary resolution. Existing acceleration/braking/drift balance is unchanged.

## Selection UI

`SelectionStats.js` reads `CARS`, `CHARACTERS`, and the existing `combineStats` function. The UI shows actual 0–100 configuration ratings, not fictitious physical units; it only shows fields present in the selected data. Cars have speed, acceleration, handling, braking and drift; character weight appears where supported. Kart panels explicitly distinguish car, character and combined racing stats. Differences are against the previously selected car and do not imply that heavier always means better.

`CarPreview.js` reuses the game's WebGL renderer. It keeps one preview scene/camera/light rig, disposes only the old vehicle on selection changes, and copies a small preview into a 2D UI canvas at up to 30 Hz. It does not add a WebGL renderer or animation loop. Names, descriptions and ratings update immediately; the low-frequency lobby selection still persists through the existing database flow and clears readiness.

## Diagnostics

The subtle race status badge is always available. For development builds only:

```dotenv
VITE_NETWORK_DEBUG=true
VITE_NETWORK_LOG=true
```

The overlay reports connection status, **server RPC RTT** (not an invented websocket ping), actual send/receive rates, active topics, player count, invalid/send-failure counts, and each peer's age, sequence, interpolation mode, rejected packets and XYZ. Optional logs report connection transitions; production does not create this panel or enable verbose logging.

## Verification performed in this checkout

```sh
npm test                       # 30 passing unit / simulation / Postgres tests
npm run build                  # passes; existing chunk-size/dynamic-import warnings remain
npm run dev                    # keep running while using browser suites below
npm run test:browser            # Classic regression, passes
npm run test:kart-browser       # Kart regression, passes
npm run test:multiplayer-browser # two browser pages, two races, passes
npm run test:multiplayer-load    # synthetic 2–8-racer renderer/receive benchmark
```

- Unit suites cover the existing car/map/AI/physics/item features; all 48 character/adventure combinations and 30 Classic car/track combinations still complete their laps.
- Network simulations cover 2–8 racers at 10, 75 and 200 ms nominal latency, jitter, 3–8% packet loss, reordering, and a two-second outage. They assert recovery, bounded buffers, finite states and no stale rollback on a straight.
- Transport tests use an injected client to check authenticated-topic identity binding, bind-before-subscribe, idempotency, in-flight/websocket backpressure, cancellation, retry and cleanup. They do not replace a live websocket test.
- PGlite runs real Postgres functions/triggers/RLS with minimal Auth/Realtime schema fixtures. Tests verify non-host start rejection, frozen roster, outsider/topic spoof rejection, start deadline, duplicate finish idempotency and ranked persistent results. Optional extension installers are skipped in this WASM fixture.
- The two-page browser suite exercises selections, real preview pixels, readiness, shared-deadline countdown, zero AI, correct selected physics, moving remote meshes, progress, packet-drop recovery, human-only results, cleanup, a second Kart race, replicated shield use, and explicit removal. No console errors were observed.
- Existing browser fixtures were updated to seed a valid username so they can reach the menu rather than time out at the already-existing first-run username prompt.

### Synthetic load measurement — not a WAN/hardware pass

Headless Chromium, **software SwiftShader**, 800×600, low graphics, one renderer with synthetic BroadcastChannel peers:

| Total racers | Remote cars | Receive/s | FPS | p95 frame ms | Geometries |
|---:|---:|---:|---:|---:|---:|
| 2 | 1 | 19.8 | 6.5 | 383.4 | 101 |
| 3 | 2 | 39.4 | 3.6 | 516.6 | 128 |
| 4 | 3 | 59.3 | 4.0 | 600.0 | 155 |
| 5 | 4 | 79.5 | 2.8 | 533.3 | 182 |
| 6 | 5 | 98.5 | 2.6 | 833.2 | 209 |
| 7 | 6 | 119.2 | 3.0 | 533.3 | 236 |
| 8 | 7 | 139.3 | 3.9 | 533.4 | 263 |

All configurations had zero AI/invalid packets, exactly N−1 remote models, and three buffered snapshots per peer at measurement. Browser coarse heap telemetry reported about 28 MB; this is not a memory leak proof. The software-rendered frame rates are **not competitively playable**, even at two racers, so they cannot support an eight-player FPS acceptance claim. GPU-device frame times, CPU/GPU usage, precise memory profiling, websocket ping and Supabase quota behavior must be measured separately. Raw generated reports stay in ignored `.cache/browser-tests/`.

## Required live acceptance pass

1. Apply SQL 005, verify Anonymous auth and Realtime private-channel authorization, and audit existing permissive `realtime.messages` policies.
2. Use distinct authenticated accounts on 2, 3, 4, 5, 6, 7 and 8 GPU-equipped clients. Run both modes/maps, finish in differing orders, verify durable ranks, and repeat races without growing topic/model counts.
3. Confirm each client has exactly N race topics + two lobby channels; rate stays at or below 20 outgoing movement messages/s and idle heartbeat near 2/s. At eight active racers, plan for roughly 160 publishes/s and 1,120 peer deliveries/s before other traffic. Check project quotas rather than raising the update rate to mask throttling.
4. Try a nonmember/private-topic join, another player's write topic, a forged payload ID, NaN/Infinity, old sequence, old race ID, duplicate finish, and a non-host start. Verify denial without corrupting rendering.
5. Add 50–100 ms and 150–250 ms latency/jitter/loss, interrupt the websocket for a few seconds, resume it, and background/restore a tab. Confirm current-state recovery without a queue burst or a new local countdown.
6. Profile 60/120 Hz rendering, CPU/GPU frame cost and memory on the supported target devices. Check collision feel, ramps, recovery, boosts and item-hit fairness under latency.

Until this pass is run, live Realtime behavior and eight-human competitive playability remain unverified, and the item-ownership limitation above remains explicit.
