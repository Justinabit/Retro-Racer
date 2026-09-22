# Kart Race Expansion — Design Document

This document describes the additive Kart Race expansion built on top of the preserved Classic mode. Classic remains untouched; all kart code lives under `src/kart/` and is invoked via `Game.store.data.mode === "kart"` checks.

## Goals

- Keep Classic 100% compatible: 6 cars, 5 tracks, garage, 3 laps / 12 checkpoints, save key `pixel-racer-save` v1.
- Add 8 original characters and 6 adventure circuits without backend, with procedural assets only.
- Provide item racing, drift mini-turbo, token collection, shortcuts, hazards, and falling recovery.

## Characters (8)

Original designs, not licensed: vex, bolt, rush, slide, grip, titan, zip, nova. Unlocks at finishes 0,0,1,1,2,2,3,4.

Each character has top, accel, handling, grip, drift, weight, color, type, trait. Stats are 40% character + 60% vehicle via `combineStats(car, character)` in `src/kart/data.js`. Weight affects knockback:

- Player collision impulse: `7 * (opponentWeight) / (playerWeight)`
- Speed retention after impact: `0.7 + weight * 0.0019` (heavier retains more)
- AI uses same formula.

## Tracks (6 adventure)

Lengths measured from actual spline geometry (not invented): metropolis 3.06 km, volcano 3.24 km, sky 3.48 km, jungle 3.62 km, canyon 3.78 km, winter 3.96 km. Unlocks 0,1,2,2,3,4.

Each track data includes `kart: true`, `night` optional, `seed`, `hazard`, `openEdges` (for Sky Island), `length` computed via `Track` sampling.

### Routes

`src/kart/Routes.js` exports `buildShortcuts(track)` and `nearestRoute(track, position)`.

- Builds 2 shortcuts per track at fixed s positions (e.g., 0.166–0.251 and 0.582–0.668), 7.6 m long vs 17 m main straight. Narrow (3.5 m) yellow-marked lanes.
- `Track.js` now imports these and stores `track.routes`. `Track.nearest()` delegates to `nearestRoute` if closer than main.
- `Track.openEdge(s)` returns true for `data.openEdges` intervals (Sky Island 0.4–0.48 and 0.8–0.86) where rail scale is set to 0, allowing falls.

### Items, tokens, pads, ramps, hazards

- **Item boxes:** 24 per track, placed every 1/24 of lap, alternating lateral offsets. 0.5 s roulette, 1.4 s cooldown, 5 s respawn.
- **Tokens:** 76 per track, gold torus meshes. 12 s respawn, +0.18 nitro, +100 score, feedback tone 1050 Hz.
- **Pads:** 3 per track at 0.13, 0.4, 0.74 s, teal boxes with arrows, 3 s cooldown, 1.7 s boost.
- **Ramps:** 2 per track at 0.3, 0.77 s, gold boxes, launch if speed >18, airborne via `airVelocity` 17.
- **Hazards:** 3 per track at 0.27, 0.54, 0.89 s, type per track: traffic, rockfall, gate, pendulum, train, snowplow. Timed cycle 12 s: inactive 0–1.5 s, warning 1.5–3 s (lamp orange), active 3–8 s (moves across road 28 units), inactive 8–12 s. Collision radius 4.5 m (9 m for train). Warning label `TYPE · WATCH THE LIGHT` placed at s-0.007.

### Falling recovery

If `position.y < nearest.p.y -16` or `nearest.distance >65` or `!isFinite(y)`, or stuck (throttle held, speed <1 for 4 s, not locked), respawn at `(checkpoint-1)/12 +0.003`, yaw from track, velocity 0, speed 0, `locked=2` (2 s stop), `immune=3`, item cleared, stats `respawns++`. Message "CHECKPOINT RECOVERY · 2 SECOND STOP" for 2.5 s.

## Items (8)

Defined in `src/kart/data.js` ITEMS with name, glyph, description, duration/range.

- boost 3 s: `racer.boost = max(..., 3)`
- bolt 160 m / 4 s: seeking projectile, spawns at racer, seeks nearest ahead within 160 m, 4 s life, on hit applies `hit` (lock 0.5 s, immunity 1.8 s, shield check)
- wave 15 m: ring expanding, radius 15 m, 0.5 s life
- shield 10 s: absorbs one hit, mesh sphere visible when >0
- oil 14 s: disc behind, 14 s life, causes spin if hit
- turbo 1.35 s: `turbo` timer
- magnet 8 s /12 m: pulls tokens and slows leader within 12 m, 8 s
- emp 22 m /1.5 s lock: disables items for rivals within 22 m, 1.5 s lock

Durations: boost 3, shield 10, turbo 1.35, oil 14, magnet 8, wave radius 15, emp radius 22 lock 1.5, bolt range 160 life 4.

Roulette: when box collected, `roulette=0.5` s, item chosen via seeded random weighted by position (leader gets weaker). Cooldown 1.4 s prevents immediate reuse. Immunity 1.8 s after hit.

## Drift mini-turbo and token nitro

In `KartRace.before()`:

- If drifting, `driftCharge += dt * (0.6 + spec.drift/100)`, capped at 3.
- On release, if `>1`, `boost = max(boost, 0.45 + charge*0.3)`, feedback "TURBO!".

Token collection handled in `ItemSystem.after()`: distance <2.5, adds `tokens++`, `physics.nitro = min(1, nitro+0.18)`, feedback "token".

## World

`src/world/Environment.js` delegates to `createAdventureEnvironment(track)` when `track.data.kart`. Adventure env creates themed props: traffic cones, rocks, gates, pendulums, trains, snowplows, plus generic foliage but with palette per track. Classic env unchanged.

`src/kart/World.js` implements adventure env with seeded random, track-following placement, label sprites.

## Particles

`src/effects/Particles.js` extended: count 420, methods `puff`, `skidKart`, `shieldBurst`, `tokenPop`, `boostFlame`, `bumpSpark`, `oilSlick`, `wave`, `magnetTether`, plus original `emit`, `skid`, `update`, `dispose`. Used by `KartRace.feedback()` for hit/token/jump etc. Kart HUD also triggers via `Game.step()` when boosting.

## UI

`src/kart/UI.js`:

- `characterScreen(ui)`: heading, panel with 5 stat rows, 40/60 note, picker of 8 characters with helmet icon.
- `enhanceKartUI(ui)`: injects mode switch (CLASSIC / KART RACE NEW) into `.hero-meta`, adds Racers nav link, updates footer to "8 RACERS / 11 DESTINATIONS / ONE ADVENTURE", adds kart combo note in garage, recomputes stat rows via `combineStats`, adds adventure facts (shortcuts/hazards/boxes) in track select, injects kart HUD (item slot with roulette, item glyph, token readout, status, drift charge, message) and touch ITEM button, adds kart result stats and field guide with ITEMS list.
- `updateKartHUD(ui)`: updates roulette, glyph, token, shield/turbo/boost/magnet/cooldown/locked messages, drift charge bar.

`src/ui/UI.js` updated: imports `ALL_TRACKS`, handles `CHARACTER_SELECT` state, mode switch, character choose, item activation, `raceTracks` getter (filters classic when classic mode), `trackId` namespaced, `combineStats` via Game, map draws `track.routes`.

## Storage

`src/core/Storage.js` extended with optional fields: `mode` (classic/kart, default classic), `character` (default vex), `kartTrack` (default metropolis), `tokens` (lifetime collected), `kartFinishes`, `finishes` still counts all. Best times namespaced: `best(trackId, mode)` uses key `kart:<id>` for kart. Records include `mode`, `character`, `tokens`. Migration from v1 without kart fields sets defaults. 100 record cap preserved.

## Game orchestration

`src/core/Game.js`:

- Getters `trackId` and `raceTracks` respect mode.
- `character` getter with preview.
- `carSpec(car, character)` returns combined when kart.
- `openCharacters()`, `chooseCharacter(id)`, `setMode(mode)`.
- `startRace()` spawns 7 AI with kart difficulty scaling, creates `KartRace` when mode kart, adds particles.
- `step()` includes weight-based collision, calls `kart.before()` and `kart.after()`.
- `finish()` includes tokens, kartStats, score includes tokens*100.
- Camera extra distance when airborne in kart.

## Verification

`npm test` runs `tests/game.test.js` (30 combos) and `tests/kart.test.js` (48 combos). Browser tests via Playwright portable Chromium under `.cache/`:

- `npm run test:browser` Classic flow.
- `npm run test:kart-browser` Kart flow: mode switch, character select 8, garage combo, track facts, HUD elements, item activation, full kart race with tokens/shortcuts/jumps, records namespaced, field guide, Sky Island openEdge and falling recovery, mobile touch ITEM.

All systems are procedural, no backend, no external assets beyond bundled fonts.

## Future ideas (out of scope)

- Online ghost sharing, split-screen, more hazards, cup progression.
