# Pixel Racer 3D

**Retro arcade racing. Analog soul. Digital heart. Now with Kart Race adventure.**

A self-contained Three.js browser racer with procedural 3D cars and scenery, eight-car races, a configurable garage, checkpoint-validated laps, persistent local progression, and an additive **Kart Race** expansion featuring 8 original characters and 6 adventure circuits.

## Run locally

Requires **Node.js 20.19+ or 22.12+**, npm, and a browser with WebGL 2 support.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The server binds to `0.0.0.0`, and the configuration permits Arena's `.e2b.app` preview hosts.

No account, backend, API key, externally hosted model, or audio download is needed. Fonts are bundled from Fontsource rather than requested from Google at runtime. Sound starts after a click, tap, or keyboard interaction, in accordance with browser autoplay restrictions.

## Play

**Menu → choose mode → choose racer/vehicle → choose track → Hit the Road.**

| Input | Action |
| --- | --- |
| W / Up arrow | Accelerate |
| S / Down arrow | Brake; keep holding to reverse |
| A, D / Left, Right arrows | Steer |
| Space | Handbrake and drift |
| Shift | Nitro (Classic) |
| E / X | Use held item (Kart) |
| P / Escape | Pause/resume |
| R | Restart the race |

Touch devices get independent steering, gas, brake, drift, nitro/item buttons. Multiple simultaneous touches and touch cancellation are supported. Portrait and landscape layouts are available. Fullscreen is in the top navigation; browser embedding permissions can restrict it, in which case the game provides a message.

- Finish **three laps**, passing all **12 checkpoints in order** on each lap.
- Keep to the asphalt: the shoulder slows the car, and visible rails cause impacts. In Kart mode, Sky Island has unrailed fall sections.
- Brake before tighter turns. Hold Space and steer above about 47 km/h to drift.
- **Classic:** Drifting earns score and recharges nitro more quickly. Nitro also recharges slowly when not used.
- **Kart:** Hold a drift to charge mini-turbo (release at 1-3 bars). Gold tokens restore nitro and add 100 points. Teal boost pads and gold ramps provide speed/air.
- Garage paint, wheel color, stripes, spoiler, and race number change the actual 3D car.
- Drag the garage/character scene to rotate the view; scroll to zoom. Headlight and brake-light previews are functional.

### Modes

Use the **CLASSIC / KART RACE NEW** switch on the home hero to change modes. The switch is additive: Classic remains exactly as shipped, while Kart adds racers, adventure tracks, items, and HUD elements.

## Cars and progression (Classic)

All six cars can be inspected immediately. Locked cars cannot be equipped until their condition is met.

| Car | Race finishes required | Character |
| --- | ---: | --- |
| Pixel GT | 0 | Balanced starter |
| Speed Demon | 1 | Faster, with less grip |
| Drift King | 2 | Highest drift and handling ratings |
| V8 Muscle | 3 | Strong acceleration, slower cornering |
| Rally Sport | 4 | Responsive steering and brakes |
| Hyper One | 6 | Highest speed rating |

| Track | Race finishes required | Environment |
| --- | ---: | --- |
| Sunset Coast | 0 | Sunset, palms, ocean, coastal hills and tunnel |
| Neon City | 0 | Night skyline, neon signage and illuminated streets |
| Desert Rush | 1 | Cacti, mesas, canyon scenery and roadside gas station |
| Forest Run | 2 | Dense conifers, elevation changes, river and morning fog |
| Night Circuit | 3 | Grandstands, barriers and stadium lights |

Easy, Normal and Hard are available initially. Expert unlocks after four finishes. Each destination has a different spline layout and elevation profile. Displayed track length is calculated from its actual geometry, rather than a made-up distance.

## Kart Race expansion

Eight original characters, each with distinct top speed, acceleration, handling, drift, and weight. Weight affects knockback: heavier racers retain more speed on collision (0.7 + weight*0.0019) and deal more impulse.

| Character | Cost | Trait | Weight |
| --- | --- | --- | --- |
| Vex | 0 | Cunning cornering | 68 |
| Bolt | 0 | Straight-line burst | 72 |
| Rush | 1 | Aggressive overtaker | 70 |
| Slide | 1 | Drift specialist | 62 |
| Grip | 2 | All-weather control | 78 |
| Titan | 2 | Heavy impact | 92 |
| Zip | 3 | Nimble escape | 58 |
| Nova | 4 | Balanced prodigy | 74 |

**Stat combination:** Your racer contributes **40%** of performance; your vehicle contributes **60%**. Open-cockpit kart visuals are applied in Kart mode, but underlying car stats still matter.

### Adventure circuits

Six circuits from 3.06–3.96 km, each with **2 narrow alternate routes** (7.6 m vs 17 m main), **24 item boxes**, **76 tokens**, **3 boost pads**, **2 ramps**, **3 timed hazards** on a 12-second cycle, plus themed scenery.

| Track | Length | Hazard | Unlock |
| --- | --- | --- | --- |
| Metropolis Sprint | 3.06 km | Traffic | 0 |
| Volcano Run | 3.24 km | Rockfall | 1 |
| Sky Island | 3.48 km | Gate | 2 |
| Jungle Dash | 3.62 km | Pendulum | 2 |
| Canyon Drift | 3.78 km | Train | 3 |
| Winter Frost | 3.96 km | Snowplow | 4 |

Hazards: traffic, rockfall, gate, pendulum, train, snowplow. Warning lamps flash 1.5 s before activation. **Sky Island** has open edges at 0.4–0.48 and 0.8–0.86 where rails are removed; falling below the road or straying >65 units triggers **2 s checkpoint recovery** with 3 s immunity.

Shortcuts are yellow-marked narrow lanes that award extra tokens. Surfaces (winter ice, jungle mud, canyon sand) reduce grip and speed.

### Items (8)

All items use 0.5 s roulette, 1.4 s cooldown, 5 s box respawn, 12 s token respawn, 1.8 s hit immunity.

| Item | Glyph | Effect | Duration/Range |
| --- | --- | --- | --- |
| Boost | ▲ | Speed burst + nitro | 3 s |
| Bolt | ⚡ | Seeking projectile ahead | 160 m / 4 s |
| Wave | ◎ | Shockwave around racer | 15 m |
| Shield | ◍ | Absorbs one hit | 10 s |
| Oil | ● | Drops slick behind | 14 s |
| Turbo | » | Mini-turbo on release | 1.35 s |
| Magnet | U | Pulls tokens & slows leader | 8 s / 12 m |
| EMP | ⌬ | Disables rivals items | 22 m / 1.5 s lock |

**Token nitro restore:** collecting a gold token restores 0.18 nitro (up to 1.0) and adds 100 score. Drift mini-turbo charges at 0.6 + drift/100 per second, 3 bars max; releasing above 1 bar grants 0.45 + charge*0.3 boost.

## Implemented systems

- **WebGL rendering:** Three.js, perspective chase camera, warm/day/night lighting, fog, directional shadows, emissive lights, procedurally generated asphalt and sign textures. Kart mode delegates to `createAdventureEnvironment` with themed props (traffic, rocks, gates, etc.).
- **Player physics:** acceleration, braking/reverse, drag, speed-dependent steering, lateral grip, controllable drift, off-road drag, rail and opponent impacts, vertical movement/landing and downforce. Kart adds weight-based knockback and `kartEffects`.
- **Camera:** interpolated follow/look position, speed-dependent distance/FOV, braking approach, turn roll, collision shake and nitro effects. Extra distance when airborne in Kart.
- **Rivals:** seven independent spline-following competitors with look-ahead corner speed, acceleration/braking, lane selection, avoidance, distinct pace/aggression and their own checkpoints, laps and finish state. Kart difficulty scales 0.82/0.94/1.0/1.0 for easy/normal/hard/expert.
- **Race rules:** locked countdown grid, ordered checkpoints, wrong-way indication, three timed laps, best lap, actual progress-based positions, overtakes, finish and retry/next-track actions. Kart adds pads, ramps, hazards, shortcuts, respawn, item loop.
- **HUD:** live speed, gear/RPM bar, nitro, position, timer, lap/checkpoint counters, drift score and a real track/racer minimap. Kart adds item slot (roulette), token count, drift charge bar, status (shield/turbo/boost/magnet/cooldown/locked), and message banner.
- **Effects:** pooled drift smoke/dust, skid marks, exhaust, nitro and impact particles; optional scanlines, speed overlay and shake. Kart adds shield bursts, token pops, boost flames, bump sparks, wave rings, magnet tethers via extended `Particles`.
- **Audio:** synthesized engine/RPM, braking/drift noise, gear/collision/checkpoint/countdown/UI sounds, a sequenced menu/race soundtrack and results fanfare. All use Web Audio, with separate music/effects/master controls.
- **Menus:** home with mode switch, character select (40/60 note), garage with combo stats, track select with adventure facts (shortcuts/hazards/boxes), loading, countdown, race with kart HUD, pause, results with kart tokens/items/shortcuts/jumps, settings, controls and local records.
- **Persistence:** car/track selection, paint/customization, finished-race count, difficulty, player name, settings, lifetime best times/high scores, and up to 100 recent race records. Kart adds `mode`, `character`, `kartTrack`, `tokens`, `kartFinishes`, namespaced bestTimes `kart:<id>`.

### Deliberate scope

The original single-player modes are preserved alongside multiplayer. **LOCAL RECORDS are device-local, not an online leaderboard.** Weather is authored into each track (sunset, clear day, night, or fog); there is no selectable rain mode. Models, effects, audio and textures are generated procedurally—no unavailable licensed car assets, fake multiplayer buttons, or nonfunctional purchase options are included. It uses stylized standard lighting, not ray-traced reflections or a general-purpose rigid-body physics engine.

## Save data

The versioned save lives at `localStorage['pixel-racer-save']` v1. Invalid JSON and malformed fields fall back to safe defaults. If storage is unavailable or full, the game continues with in-memory progress and reports that records cannot be persisted. Lifetime personal bests are preserved even after older entries leave the 100-race history. Existing version-one saves are migrated from their available race history. Saves are scoped to the browser origin: development, production, and different preview URLs may have separate records.

Kart fields are optional and backward-compatible: `mode` (classic/kart), `character`, `kartTrack`, `tokens`, `kartFinishes`. Best times are namespaced: classic `coast`, kart `kart:metropolis`. Records include `mode`, `character`, `tokens`.

To reset your own progress, delete that key in browser developer tools. No personal data is transmitted to a server.

## Multiplayer (Real-Player Only)

**Networking update:** Apply `supabase/migrations/005_race_network.sql` to existing projects before deploying this client. See [the audit, tests, measured limits and live acceptance checklist](docs/MULTIPLAYER.md). Live Supabase/WAN and eight-device competitive performance still need verification.

**New:** Online multiplayer for 2-8 human players, zero AI. Requires a Supabase project with sufficient Realtime throughput, or works in offline mock mode (same-browser testing).

### Quick Start Multiplayer

1. Create Supabase project at supabase.com
2. Copy `.env.example` to `.env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. Run SQL from `supabase/schema.sql` in Supabase SQL Editor (or apply migrations from `supabase/migrations/`)
4. Enable Realtime for `lobbies`, `lobby_players`, `race_sessions` tables
5. `npm run dev`

Offline: Without env vars, multiplayer uses mock mode (localStorage `mock-lobbies`) for same-browser testing.

### Multiplayer Flow

`Main Menu → Multiplayer → Create/Join Lobby (6-digit code) → Lobby (real-time) → Ready → Player Highlights (human only) → Map Highlight → Starting Grid (human count only, no AI) → Race (interpolation, name tags) → Results (human only)`

- **Username:** 3-16 chars, letters/numbers/spaces, no HTML/JS/SQL, appears above car/lobby/intro/grid/leaderboard/results
- **Lobby Code:** 6-digit numeric, unique among active, collision-safe retry
- **Host:** Only host can start, change map/mode; backend validation via RLS and `can_start_race()`; host migration on disconnect (earliest joined)
- **Race Sync:** Persistent state (lobby, ready, selections) in Supabase DB; ephemeral position (20Hz) via Realtime Broadcast with interpolation buffer (10, smoothing 0.15, extrapolation 0.5s), NOT 60 FPS DB writes
- **Collision:** Hardened (CCD substeps, vehicle separation 2.2m mass ratio, track boundary buffer 0.15 damping 0.75, ramp height, fall/stuck recovery)
- **Power-ups:** Sync collection with host authority cooldown, broadcast usage
- **Performance:** Reused vectors, DOM cache, HUD only when changed, InstancedMesh, pooled particles (420), broadcast 20Hz

See `supabase/README.md` for setup, `docs/MULTIPLAYER.md` for architecture, `docs/CHANGES.md` for implementation details.

### Multiplayer Acceptance

- 2 players = 2 racers, 8 = 8, never AI in lobby/grid/leaderboard/results/highlights
- 6-digit lobby codes unique
- RLS enforced, no service-role key in browser
- Smooth FPS, no clipping

## Architecture

```text
index.html
src/
  main.js                  App entry, bundled fonts, WebGL error fallback
  data.js                  Six cars, five classic layouts, unlocks and formatting
  style.css                Responsive menu, garage, HUD, kart and touch interface
  core/
    Game.js                State transitions, race loop, camera, mode/character orchestration
    Input.js               Keyboard, touch, cancellation and focus-loss handling (E/X for items)
    Audio.js               Web Audio engine, SFX and sequenced soundtrack
    Storage.js             Versioned, validated local persistence with kart fields
  player/
    Car.js                 Procedural, animated, customizable 3D vehicle (open-cockpit in kart)
    CarPhysics.js          Player movement and surface/collision response (weight knockback)
  ai/AICar.js               Rival controller and independent race progress
  track/Track.js           Sampled spline, road mesh, rails, openEdge, routes, checkpoint ledger
  world/Environment.js     Seeded track-specific procedural scenery or adventure env
  effects/Particles.js     Pooled particles and instanced skid marks, kart puffs/shields/waves
  kart/
    data.js                8 characters, 6 adventure tracks, 8 items, combineStats
    Character.js           Character spec helpers
    Routes.js              buildShortcuts, nearestRoute for 2 narrow alternates
    Items.js               ItemSystem: boxes, tokens, projectiles, durations
    KartRace.js            Pads, ramps, hazards, respawn, view meshes, feedback
    World.js               Adventure environment per track
    UI.js                  characterScreen, enhanceKartUI, updateKartHUD
  ui/
    UI.js                  Menus, settings, HUD, minimaps, mode/character/item handling
    icons.js               Local SVG icon set

tests/
  game.test.js             Deterministic physics, rules, AI and save tests (30 combos)
  kart.test.js             48 char/adventure combos, routes, items, storage
  browser.mjs              Real Chromium end-to-end flow and touch tests (Classic)
  kart-browser.mjs         Chromium flow for Kart: mode switch, racers, HUD, items
```

The simulation only advances in `RACING`. The countdown does not run vehicle physics. Pausing also freezes AI, race time, particles and the game camera; opening Settings from Pause preserves that freeze. Blur/visibility loss pauses an active race and clears held controls.

Track furniture uses instancing or material-batched geometry. Fixed car bodywork is merged while wheels retain their animation pivots. Particles and skid marks have fixed-size pools. Replaced worlds and cars dispose their GPU resources. Graphics quality changes pixel ratio and shadow quality; Low disables shadows and reduces drift emissions. Performance depends on GPU, browser and resolution; 60 FPS is a target, not a measured guarantee on every device.

## Test

```sh
npm test
```

Includes real physics-driven completion of **all 30 car/track combinations (Classic) + 48 character/adventure combinations (Kart)**, checkpoint ordering/reverse protection, AI completion on every layout, drift/nitro/reverse/rail response, differentiated acceleration, lifetime-best retention, kart routes/items/storage, and save corruption/storage failure handling.

For browser integration tests, leave the Vite development server running in one terminal, then:

```sh
npm run test:browser
npm run test:kart-browser
```

The suites use Playwright and a portable Chromium dev dependency. They create a fresh browser context and write screenshots/results under ignored `.cache/browser-tests/`. On Linux it extracts the bundled browser support libraries there. Set `CHROMIUM_EXECUTABLE=/path/to/chromium` to select another installed executable, and `TEST_URL=http://your-dev-server` to use another dev URL.

Browser tests cover Classic and Kart flows (see `docs/KART_EXPANSION.md` for Kart-specific checks).

## Build and deploy

```sh
npm run build
npm run preview
```

Deploy the contents of **`dist/`** to any static HTTPS host:

- **Netlify / Cloudflare Pages:** build command `npm run build`, output directory `dist`.
- **Vercel:** import the repository using its Vite preset, with output directory `dist`.
- **Nginx / Apache / object storage:** serve the generated files over HTTP(S) with normal JavaScript, font and CSS MIME types.
- **GitHub Pages:** for a project URL, set Vite's `base` to the repository subpath before building, or run `npm run build -- --base=/Retro-Racer/`.

There are no client-side URL routes or API services requiring proxy rewrites. Do not open `index.html` directly with a `file://` URL; use Vite or a static HTTP server. Embedded deployments should allow fullscreen if desired. WebGL and Web Audio must be available; unsupported WebGL produces a visible recovery message instead of an empty canvas.

## Credits

- Rendering: Three.js (MIT).
- Typography: Barlow Condensed and DM Sans, bundled through Fontsource (SIL Open Font License).
- Cars, scenery, texture generation, icon markup, soundtrack patterns and game logic are included in this repository.

## Continuous integration

The GitHub Actions workflow runs the unit/simulation tests, production build, and Chromium browser suites (Classic and Kart) on pull requests and pushes. Browser reports and screenshots are uploaded as workflow artifacts.
