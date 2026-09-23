import { selectionStats, statRows } from "../multiplayer/SelectionStats.js";
import { ALL_TRACKS, CHARACTERS } from "../kart/data.js";
import { characterScreen, enhanceKartUI, updateKartHUD } from "../kart/UI.js";
import { CARS, PAINTS, timeString } from "../data.js";
import { icon } from "./icons.js";
import { validateUsername } from "../multiplayer/Username.js";
import { validateLobbyCode } from "../multiplayer/Lobby.js";
import { getCurrentUserId } from "../supabase/auth.js";
import { isSupabaseConfigured } from "../supabase/client.js";

const safe = (s) =>
  String(s).replace(
    /[&<>\"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export class UI {
  constructor(game) {
    this.g = game;
    this.root = document.getElementById("ui");
    this._cachedElements = new Map();
    this.root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]");
      if (!b || b.disabled) return;
      game.audio.click();
      this.action(b.dataset.action, b.dataset.value);
    });
    this.root.addEventListener("change", (e) => this.change(e.target));
    this.root.addEventListener("input", (e) => this.handleInput(e.target));
  }

  // Performance: cached DOM queries
  getElement(id) {
    if (!this._cachedElements.has(id)) {
      const el = document.getElementById(id);
      if (el) this._cachedElements.set(id, el);
      return el;
    }
    return this._cachedElements.get(id);
  }

  clearCache() {
    this._cachedElements.clear();
  }

  header(active = "") {
    const multiplayerActive = this.g.multiplayerActive;
    return `<header class="header"><button class="brand" data-action="menu" aria-label="Pixel Racer home">PIXEL<span>RACER</span><sup>3D</sup><small>RETRO ARCADE RACING</small></button><nav aria-label="Main navigation">${[
      ["garage", "car", "Garage"],
      ["tracks", "flag", "Tracks"],
      ["multiplayer", "users", "Multiplayer"],
      ["records", "trophy", "Records"],
      ["settings", "settings", "Settings"],
    ]
      .map(
        ([a, i, t]) =>
          `<button class="nav-link ${active === a ? "active" : ""} ${a === "multiplayer" && multiplayerActive ? "multiplayer-active" : ""}" data-action="${a}" aria-label="${t}">${icon(i)}<span>${t}</span>${a === "multiplayer" ? '<small class="mp-badge">NEW</small>' : ''}</button>`,
      )
      .join(
        "",
      )}</nav><div class="header-end"><span class="local-status"><i></i> ${multiplayerActive ? `${this.g.lobbyPlayers?.length || 1}/8 MULTIPLAYER` : 'ALL SYSTEMS GO'}</span><button class="icon-button" data-action="fullscreen" title="Toggle fullscreen" aria-label="Toggle fullscreen">${icon("expand")}</button></div></header>`;
  }

  footer() {
    const tracks = this.g.raceTracks;
    return `<footer class="footer"><span><i class="status-dot"></i> BUILT FOR THE DRIVE.</span><span class="footer-mid">${CARS.length} MACHINES <b>/</b> ${tracks.length} DESTINATIONS <b>/</b> INFINITE GOOD TIMES</span><button data-action="how">${icon("help")} HOW TO PLAY <span>↗</span></button></footer>`;
  }

  renderSelectionStats() {
    const g = this.g, s = g.store.data;
    const { car, character, effective } = selectionStats(s.car, s.character, g.lobby?.mode);
    const previous = CARS.find(c => c.id === this.previousMultiplayerCar);
    const rows = (spec, compare) => statRows(spec, compare).map(r => `<div class="mp-stat"><span>${r.label}</span><meter min="0" max="100" value="${r.value}" aria-label="${r.label}">${r.value}</meter><b>${Number(r.value.toFixed(1))}<small>/100</small></b>${compare ? `<em class="${r.difference > 0 ? 'higher' : r.difference < 0 ? 'lower' : ''}">${r.difference > 0 ? '+' : ''}${Number(r.difference.toFixed(1))}</em>` : ''}</div>`).join('');
    return `<section class="mp-selection-stats" aria-label="Selected vehicle statistics"><canvas id="mp-car-preview" width="480" height="240" aria-label="3D preview of ${safe(car.name)}"></canvas><h4>${safe(car.name)}</h4><p>${safe(car.type)}</p><h5>CAR RATINGS ${previous && previous.id !== car.id ? `· Δ VS ${safe(previous.name)}` : ''}</h5>${rows(car, previous?.id !== car.id ? previous : null)}${g.lobby?.mode === 'kart' ? `<h5>CHARACTER · ${safe(character.name)}</h5><p>${safe(character.trait)}</p>${rows(character)}<details><summary>COMBINED RACING STATS</summary>${rows(effective)}<small>Uses the same 60% car / 40% character calculation and weight adjustment as racing physics.</small></details>` : ''}<small>Actual configuration ratings, not measured km/h. Higher weight means greater collision resistance, not necessarily faster handling.</small></section>`;
  }

  render() {
    const g = this.g,
      state = g.state;
    this.root.className = state.toLowerCase();
    document.body.dataset.state = state;
    document.body.classList.remove("kart-mode");
    this.clearCache();
    
    const TRACKS = g.raceTracks;
    const s = g.store.data;
    const car = g.carSpec(CARS.find((c) => c.id === s.car) || CARS[0]),
      track = TRACKS.find((t) => t.id === g.trackId) || TRACKS[0];

    // Debug overlay
    const debugOverlay = g.debug?.enabled ? this.renderDebugOverlay() : '';

    if (state === "USERNAME_PROMPT") {
      this.root.innerHTML = `${this.header()}<main class="username-page-v2"><div class="username-card-v2"><div class="username-card-top"><div class="eyebrow">FIRST TIME ON THE GRID? • WELCOME</div><h1>CHOOSE YOUR <em>NAME</em></h1><p class="username-subtitle">This is how other racers will see you in multiplayer. You can change it anytime in settings. Keep it clean, keep it fast.</p></div><div class="username-input-wrap-v2"><label for="username-input">USERNAME <span>3-16 CHARS</span></label><div class="input-with-icon"><input type="text" id="username-input" maxlength="16" placeholder="e.g. SpeedKing" value="${safe(s.name !== "PLAYER" ? s.name : "")}" autocomplete="off" spellcheck="false"/><span class="input-icon">${icon("users")}</span></div><div class="username-hint">Letters, numbers and spaces only. No special characters.</div><div id="username-error" class="username-error-v2" hidden></div></div><button class="primary wide username-continue-btn" data-action="submit-username"><span>CONTINUE TO GARAGE</span> ${icon("arrow")}</button><div class="username-examples-v2"><span>QUICK PICK:</span><div class="example-chips"><button data-action="fill-username" data-value="RacerX">RacerX</button><button data-action="fill-username" data-value="TurboKid">TurboKid</button><button data-action="fill-username" data-value="NightShift">NightShift</button><button data-action="fill-username" data-value="Apex">Apex</button></div></div><div class="username-footer-note"><i></i> Your name appears above your car, in lobbies, and on leaderboards. Make it memorable.</div></div></main>${this.footer()}${debugOverlay}`;
      setTimeout(() => {
        const input = document.getElementById("username-input");
        if (input) input.focus();
      }, 100);
    } else if (state === "MENU") {
      this.root.innerHTML = `${this.header()}<main class="home"><div class="hero-shade"></div><section class="hero-copy"><div class="eyebrow"><span class="mini-flag">▧</span> THE GOLDEN ERA. REBUILT.</div><h1>LESS RULES.\nMORE <em>THROTTLE.</em></h1><p>Chase the horizon. Own every corner.\nPure arcade racing. No looking back.</p><button class="text-link" data-action="how">THIS IS HOW WE ROLL ${icon("arrow")}</button><div class="hero-meta"><span>EST. 1986</span><i></i><span>REIMAGINED FOR NOW</span></div></section><div class="scene-label"><span class="crosshair">+</span><div>${car.name.toUpperCase()} <span> / ${car.year}</span><small>ANALOG SOUL. DIGITAL HEART.</small></div></div><div class="vertical-caption">35° 42′ N   121° 19′ W   /   WESTBOUND</div><div class="hero-bottom"><span>INSERT GOOD TIMES.</span><div><i class="orange-dot"></i> LIVE 3D <span>•</span> ${track.weather.toUpperCase()} ${!isSupabaseConfigured() ? '• OFFLINE MODE' : ''}</div></div></main><section class="launch-deck"><div class="track-tile"><button class="tile-cover" data-action="tracks" aria-label="Choose track"><div class="track-art ${track.id}"><span class="art-sun"></span><span class="art-mountain one"></span><span class="art-mountain two"></span><span class="art-road"></span><span class="art-tag">${String(TRACKS.indexOf(track) + 1).padStart(2, "0")} / ${String(TRACKS.length).padStart(2, "0")}</span>${icon("arrow")}</div></button><div class="track-info"><span class="eyebrow small">YOUR NEXT ESCAPE</span><h2>${track.name}</h2><span class="subline">${icon("pin")} ${track.region}</span><div class="tags"><span>${icon("sun")} ${track.weather}</span><span>3 LAPS</span><span>${(g.track.length / 1000).toFixed(2)} KM</span></div></div><button class="change-link" data-action="tracks">CHANGE ${icon("chevron")}</button></div><div class="car-tile"><span class="eyebrow small">YOUR RIDE</span><div class="ride-title"><h2>${car.name}</h2><button data-action="garage" class="icon-button" aria-label="Change vehicle">${icon("arrow")}</button></div><div class="mini-stats"><span>SPD <i><b style="width:${car.speed}%\"></b></i></span><span>HND <i><b style="width:${car.handling}%\"></b></i></span><span>ACC <i><b style="width:${car.accel}%\"></b></i></span></div><span class="ride-type"><i style="background:${s.paint[car.id] || car.color}"></i> ${car.type}</span></div><div class="start-tile"><button class="primary start-button" data-action="start"><span>LET’S RACE<small>THE ROAD IS CALLING.</small></span>${icon("arrow")}</button><button class="primary start-button multiplayer-button" data-action="multiplayer" style="margin-top:8px; background:#2d3a4a;"><span>MULTIPLAYER<small>${s.name} • ${g.isHost ? 'HOST' : 'JOIN FRIENDS'}</small></span>${icon("users")}</button><span class="start-note"><kbd>W A S D</kbd> TO DRIVE <b>·</b> <kbd>SPACE</kbd> TO DRIFT ${!isSupabaseConfigured() ? '<br><small>OFFLINE: Multiplayer uses local mock</small>' : ''}</span></div></section>${this.footer()}${debugOverlay}`;
    } else if (state === "MULTIPLAYER_MENU") {
      const isOnline = isSupabaseConfigured();
      this.root.innerHTML = `${this.header("multiplayer")}<main class="multiplayer-menu-v2"><div class="mp-v2-container"><div class="mp-v2-header"><button class="back-link" data-action="menu">${icon("back")} BACK TO MENU</button><div class="mp-v2-title-row"><div><div class="eyebrow"><i class="status-dot"></i> REAL PLAYERS ONLY • NO BOTS • 2-8 FRIENDS</div><h1>MULTI<em>PLAYER</em></h1><p>Race against real friends. No AI, no bots — just pure skill. Create a lobby, share the code, and hit the road together.</p></div><div class="mp-v2-badge">${icon("users")}<span>${isOnline ? 'ONLINE' : 'OFFLINE MOCK'}</span></div></div></div><div class="mp-v2-grid"><div class="mp-v2-main"><div class="mp-user-card-v2"><div class="mp-user-avatar">${safe(s.name).charAt(0).toUpperCase()}</div><div class="mp-user-info"><span>YOU ARE RACING AS</span><strong>${safe(s.name)}</strong><small>Visible above your car, in lobbies and results</small></div><button class="chip" data-action="change-username">CHANGE</button></div><div class="mp-actions-v2"><button class="mp-action-card primary-card" data-action="create-lobby"><div class="mp-action-icon">${icon("users")}</div><div class="mp-action-text"><strong>CREATE LOBBY</strong><span>Host a race • Get 6-digit code • Up to 8 players</span></div><div class="mp-action-arrow">${icon("arrow")}</div></button><button class="mp-action-card secondary-card" data-action="join-lobby-prompt"><div class="mp-action-icon">${icon("flag")}</div><div class="mp-action-text"><strong>JOIN LOBBY</strong><span>Enter friend's code • Join instantly • No password</span></div><div class="mp-action-arrow">${icon("arrow")}</div></button></div><div class="mp-status-v2 ${isOnline ? 'online' : 'offline'}">${isOnline ? `${icon("check")} <strong>Supabase connected</strong> — Real multiplayer enabled. Share codes with friends anywhere.` : `${icon("clock")} <strong>Offline mock mode</strong> — Multiplayer works in same browser only. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for real online play.`}</div></div><div class="mp-v2-side"><div class="mp-how-card-v2"><h3>${icon("flag")} HOW IT WORKS</h3><div class="mp-steps"><div class="mp-step"><span>1</span><div><strong>Create lobby</strong><p>Host gets a 6-digit code</p></div></div><div class="mp-step"><span>2</span><div><strong>Friends join</strong><p>Enter code → max 8 players</p></div></div><div class="mp-step"><span>3</span><div><strong>Pick & ready</strong><p>Select car & character → Ready up</p></div></div><div class="mp-step"><span>4</span><div><strong>Race</strong><p>5s grid preview, synced for everyone → Go!</p></div></div></div><div class="mp-how-note">${icon("check")} Only human players — <b>NEVER AI</b>. 2 players = 2 racers, 8 = 8.</div></div><div class="mp-tips-card"><h4>QUICK TIPS</h4><ul><li>${icon("bolt")} Host can change map & mode</li><li>${icon("users")} Host migrates if host leaves</li><li>${icon("trophy")} Results save for all players</li><li>${icon("settings")} Change name anytime in settings</li></ul></div></div></div></div></main>${this.footer()}${debugOverlay}`;
    } else if (state === "JOIN_LOBBY") {
      this.root.innerHTML = `${this.header("multiplayer")}<main class="join-lobby-page-v2"><div class="join-v2-container"><button class="back-link" data-action="multiplayer">${icon("back")} BACK TO MULTIPLAYER</button><div class="join-v2-card"><div class="eyebrow">ENTER LOBBY CODE • 6 DIGITS</div><h1>JOIN <em>LOBBY</em></h1><p>Ask your friend for the 6-digit code. Numbers only, no spaces.</p><div class="lobby-code-input-group-v2"><label for="lobby-code-input">LOBBY CODE</label><div class="code-input-wrap"><input type="text" id="lobby-code-input" maxlength="6" placeholder="• • • • • •" inputmode="numeric" autocomplete="off" spellcheck="false"/><span class="code-icon">${icon("flag")}</span></div><small>Exactly 6 numbers — e.g. 482193</small><div id="lobby-code-error" class="username-error-v2" hidden></div></div><div class="join-actions-v2"><button class="primary wide" data-action="join-lobby-submit"><span>JOIN LOBBY</span> ${icon("arrow")}</button><button class="outline wide" data-action="multiplayer">CANCEL</button></div><div class="join-help"><h4>WHERE DO I FIND THE CODE?</h4><p>Host creates lobby and sees a big code like <b>482193</b> at the top. They share it via chat, voice, or copy button.</p></div></div></div></main>${this.footer()}${debugOverlay}`;
      setTimeout(() => {
        const input = document.getElementById("lobby-code-input");
        if (input) input.focus();
      }, 100);
    } else if (state === "MULTIPLAYER_LOBBY") {
      const lobby = g.lobby;
      const players = g.lobbyPlayers || [];
      const isHost = g.isHost;
      const currentUserId = getCurrentUserId();
      const canStart = isHost && players.length >= 2 && players.every(p => p.is_ready);
      
      this.root.innerHTML = `${this.header("multiplayer")}<main class="lobby-page-v2"><div class="lobby-v2-container"><div class="lobby-v2-header"><div class="lobby-code-hero"><div class="lobby-code-label"><span>LOBBY CODE</span><small>SHARE THIS WITH FRIENDS</small></div><div class="lobby-code-big"><strong>${lobby ? lobby.code.split('').map(d=>`<i>${d}</i>`).join('') : '------'}</strong><div class="lobby-code-actions"><button class="chip" data-action="copy-code">${icon("copy")} COPY</button><button class="chip outline-chip" data-action="leave-lobby">LEAVE</button></div></div><div class="lobby-meta"><span>${players.length}/8 PLAYERS</span><span>•</span><span>${lobby?.mode?.toUpperCase() || 'CLASSIC'}</span><span>•</span><span>${ALL_TRACKS.find(t => t.id === lobby?.map_id)?.name || 'Track'}</span><span>•</span><span class="host-badge">${isHost ? 'YOU ARE HOST' : 'WAITING FOR HOST'}</span></div></div></div><div class="lobby-v2-grid"><div class="lobby-v2-main"><div class="lobby-players-v2"><div class="lobby-section-header"><h3>${icon("users")} PLAYERS <span>${players.length}/8</span></h3><small>Real players only — no bots, no AI</small></div><div class="players-list-v2">${players.map((p, i) => {
        const isMe = p.player_id === currentUserId;
        const username = p.profiles?.username || p.username || `Player${i+1}`;
        const isPlayerHost = p.player_id === lobby?.host_id;
        const car = CARS.find(c => c.id === p.selected_car) || CARS[0];
        const character = CHARACTERS.find(c => c.id === p.selected_character);
        return `<div class="player-row-v2 ${isMe ? 'is-me' : ''} ${p.is_ready ? 'ready' : 'not-ready'}"><div class="player-avatar">${safe(username).charAt(0).toUpperCase()}</div><div class="player-info-v2"><div class="player-name-line"><strong>${safe(username)} ${isMe ? '<small>YOU</small>' : ''}</strong>${isPlayerHost ? '<span class="host-tag">HOST</span>' : ''}<span class="ready-tag ${p.is_ready ? 'ready' : ''}">${p.is_ready ? 'READY' : 'NOT READY'}</span></div><div class="player-car-line">${icon("car")} ${car.name}${character ? ` • ${character.name}` : ''}</div></div><div class="player-status-v2">${p.is_ready ? icon("check") : icon("clock")}</div></div>`;
      }).join("")}${players.length === 0 ? '<div class="empty-players-v2"><div class="empty-icon">${icon("users")}</div><p>Waiting for players to join...</p><small>Share the code above</small></div>' : ''}${Array.from({length: Math.max(0, 8-players.length)}).map((_,i)=>`<div class="player-row-v2 empty-slot"><div class="player-avatar empty">?</div><div class="player-info-v2"><strong>Waiting for player...</strong><small>Share code ${lobby?.code || ''} to invite</small></div></div>`).join("")}</div></div></div><div class="lobby-v2-side"><div class="lobby-settings-v2"><h3>${icon("settings")} LOBBY SETTINGS</h3><div class="setting-row-v2"><div><span>MODE</span><strong>${lobby?.mode?.toUpperCase() || 'CLASSIC'}</strong></div>${isHost ? `<select id="lobby-mode" data-setting="lobby-mode" class="mini-select"><option value="classic" ${lobby?.mode === 'classic' ? 'selected' : ''}>CLASSIC</option><option value="kart" ${lobby?.mode === 'kart' ? 'selected' : ''}>KART</option></select>` : ''}</div><div class="setting-row-v2"><div><span>MAP</span><strong>${ALL_TRACKS.find(t => t.id === lobby?.map_id)?.name || lobby?.map_id || 'Coast'}</strong></div>${isHost ? `<button data-action="change-map" class="chip small">CHANGE</button>` : ''}</div><div class="setting-row-v2 no-border"><div><span>MAX</span><strong>8 HUMAN • NO AI</strong></div><small class="no-ai-badge">NEVER BOTS</small></div></div><div class="lobby-my-selection-v2"><h3>${icon("car")} YOUR RIDE</h3><div class="selection-row-v2"><label>Car</label><select id="mp-car" data-custom="mp-car" class="full-select">${CARS.map(c => `<option value="${c.id}" ${s.car === c.id ? 'selected' : ''}>${c.name} — ${c.type}</option>`).join("")}</select></div>${lobby?.mode === 'kart' ? `<div class="selection-row-v2"><label>Character</label><select id="mp-character" data-custom="mp-character" class="full-select">${CHARACTERS.map(ch => `<option value="${ch.id}" ${s.character === ch.id ? 'selected' : ''}>${ch.name} — ${ch.trait}</option>`).join("")}</select></div>` : ''}${this.renderSelectionStats()}<button class="primary wide ready-btn ${players.find(p => p.player_id === currentUserId)?.is_ready ? 'is-ready' : ''}" data-action="toggle-ready" id="ready-button"><span>${players.find(p => p.player_id === currentUserId)?.is_ready ? 'YOU ARE READY — CLICK TO UNREADY' : 'READY UP'}</span> ${icon("check")}</button><small class="ready-hint">Select car${lobby?.mode === 'kart' ? ' & character' : ''} then ready up. All players must be ready.</small></div><div class="lobby-actions-v2"><button class="primary wide start-race-btn ${canStart ? 'can-start' : ''}" data-action="start-multiplayer-race" ${!canStart ? 'disabled' : ''}><span>${!isHost ? 'WAITING FOR HOST TO START' : players.length < 2 ? `NEED ${2-players.length} MORE PLAYER${2-players.length>1?'S':''}` : !players.every(p => p.is_ready) ? 'WAITING FOR ALL READY' : `START RACE • ${players.length} PLAYERS`}</span> ${icon("flag")}</button><div class="lobby-action-hints">${isHost ? `<small>${icon("check")} You are host • You can start when all ready • Min 2, max 8, no AI</small>` : `<small>${icon("clock")} Select your ride and ready up. Host will start the race when everyone is ready.</small>`}</div></div></div></div></div></main>${this.footer()}${debugOverlay}`;
    } else if (state === "MULTIPLAYER_INTRO") {
      // Pure loading/highlight screen: no player controls it, no player can
      // skip or delay it. It auto-advances everywhere at once because the
      // real trigger is the synced 'racing' lobby status (see Game.js),
      // not anything happening on this screen. Capped at g.introDuration
      // (<=5s) for cosmetic progress only.
      const lobby = g.lobby;
      const players = g.lobbyPlayers || [];
      const trackData = ALL_TRACKS.find(t => t.id === lobby?.map_id) || ALL_TRACKS[0];
      const elapsed = Math.max(0, g.time - (g.introStartTime || g.time));
      const pct = Math.min(100, (elapsed / (g.introDuration || 5)) * 100);

      this.root.innerHTML = `<div class="mp-intro-v2"><div class="mp-intro-scrim"><div class="mp-intro-header"><div class="eyebrow"><i class="status-dot"></i> GET READY • ${players.length} HUMAN PLAYERS • NO AI</div><h1>${trackData.name.toUpperCase()}</h1><p>${trackData.subtitle}</p></div><div class="mp-intro-players"><h3>${icon("users")} ON THE GRID</h3><div class="mp-intro-player-grid">${players.map((p, i) => {
        const username = p.profiles?.username || p.username || `Player${i+1}`;
        const car = CARS.find(c => c.id === p.selected_car) || CARS[0];
        const character = CHARACTERS.find(c => c.id === p.selected_character);
        const isMe = p.player_id === getCurrentUserId();
        return `<div class="mp-intro-player-card ${isMe ? 'is-me' : ''}"><div class="mp-intro-avatar">${safe(username).charAt(0).toUpperCase()}</div><div class="mp-intro-player-info"><strong>${safe(username).toUpperCase()} ${isMe ? '<small>YOU</small>' : ''}</strong><small>${icon("car")} ${car.name}${character ? ` • ${character.name}` : ''}</small></div><span class="mp-intro-grid-pos">P${i+1}</span></div>`;
      }).join("")}</div></div><div class="mp-intro-footer"><div class="progress-bar-v2 wide"><i id="mp-intro-progress" style="width:${pct}%"></i></div><small>${icon("flag")} 3 laps • ${trackData.name} • Starting for everyone at once…</small></div></div></div>`;
    } else if (state === "CHARACTER_SELECT") {
      this.root.innerHTML = characterScreen(this);
    } else if (state === "GARAGE") {
      const c = g.previewCar;
      const unlocked = s.finishes >= c.cost;
      const cust = s.custom[c.id] || {};
      this.root.innerHTML = `${this.header("garage")}<main class="garage-view"><div class="page-heading"><button class="back-link" data-action="menu">${icon("back")} BACK TO THE OPEN ROAD</button><div class="eyebrow">${g.setup ? "01 / CHOOSE YOUR MACHINE" : "THE COLLECTION / 06 MACHINES"}</div><h1>YOUR RIDE.\n<em>YOUR RULES.</em></h1><p>Old-school character. A new kind of rush.</p></div><div class="garage-hint">↔ DRAG TO ROTATE <span> / </span> SCROLL TO ZOOM</div><section class="garage-panel"><span class="eyebrow small">${c.year} / ${c.type}</span><h2>${c.name}</h2>${["speed", "accel", "handling", "braking", "drift"].map((k, i) => `<div class="stat-row"><span>${["TOP SPEED", "ACCELERATION", "HANDLING", "BRAKING", "DRIFT"][i]}</span><i><b style="width:${c[k]}%"></b></i><strong>${c[k]}</strong></div>`).join("")}<div class="custom-section"><span class="eyebrow small">MAKE IT YOURS</span><div class="swatches">${PAINTS.map((p) => `<button aria-label="Paint ${p}" data-action="paint" data-value="${p}" class="swatch ${(s.paint[c.id] || c.color) === p ? "selected" : ""}" style="--paint:${p}"></button>`).join("")}</div><div class="custom-options"><label>WHEELS<select data-custom="wheels"><option value="#c5c4b7" ${cust.wheels !== "#242b2c" ? "selected" : ""}>Silver</option><option value="#242b2c" ${cust.wheels === "#242b2c" ? "selected" : ""}>Black</option></select></label><label>NUMBER<input data-custom="number" type="number" min="1" max="99" value="${Number(cust.number) || 86}"></label><label><input data-custom="decal" type="checkbox" ${cust.decal !== false ? "checked" : ""}> STRIPES</label><label><input data-custom="spoiler" type="checkbox" ${cust.spoiler !== false ? "checked" : ""}> SPOILER</label></div><div class="light-buttons"><button data-action="lights" class="chip ${g.previewLights ? "selected" : ""}">${icon("sun")} HEADLIGHTS</button><button data-action="brakelights" class="chip ${g.previewBrakes ? "selected" : ""}">BRAKE LIGHTS</button></div></div><button class="primary wide" data-action="equip" ${unlocked ? "" : "disabled"}>${unlocked ? (g.setup ? "CHOOSE TRACK" : s.car === c.id ? "EQUIPPED · RETURN" : "EQUIP THIS MACHINE") : `${icon("lock")} FINISH ${c.cost} RACE${c.cost > 1 ? "S" : ""} TO UNLOCK`} ${icon("arrow")}</button>${!unlocked ? `<small class="unlock-note">YOUR PROGRESS: ${s.finishes} / ${c.cost} RACES FINISHED</small>` : ""}</section><div class="car-picker">${CARS.map((v, i) => `<button data-action="car" data-value="${v.id}" class="car-choice ${v.id === c.id ? "selected" : ""}"><span>${String(i + 1).padStart(2, "0")} ${s.finishes < v.cost ? icon("lock") : icon("car")}</span><strong>${v.name}</strong><i style="background:${s.paint[v.id] || v.color}"></i></button>`).join("")}</div></main>${this.footer()}${debugOverlay}`;
    } else if (state === "TRACK_SELECT") {
      const t = g.previewTrack;
      const available = s.finishes >= t.cost;
      const isMP = g.multiplayerActive;
      const backAction = isMP ? "cancel-map-select" : (g.setup ? "garage" : "menu");
      const backLabel = isMP ? "BACK TO LOBBY" : (g.setup ? "BACK TO GARAGE" : "BACK TO MENU");
      const raceLabel = isMP
        ? "SELECT MAP"
        : (available ? "HIT THE ROAD" : `FINISH ${t.cost} RACES TO UNLOCK`);
      const racerCount = isMP ? `${g.lobbyPlayers?.length || 2} PLAYERS` : "8 RACERS";
      this.root.innerHTML = `${this.header(isMP ? "multiplayer" : "tracks")}<main class="tracks-view"><div class="page-heading"><button class="back-link" data-action="${backAction}">${icon("back")} ${backLabel}</button><div class="eyebrow">${isMP ? "MULTIPLAYER / CHOOSE THE MAP" : g.setup ? "02 / FIND YOUR HORIZON" : "THE WORLD IS YOUR RACETRACK"}</div><h1>PICK YOUR\n<em>PLAYGROUND.</em></h1></div><section class="track-panel"><span class="eyebrow">TRACK ${String(TRACKS.indexOf(t) + 1).padStart(2, "0")} / ${t.region}</span><h2>${t.name}</h2><p>${t.subtitle}</p><canvas id="track-preview-map" width="350" height="180" aria-label="Track layout"></canvas><div class="track-details"><span>DIFFICULTY<strong class="stars">${"★".repeat(t.difficulty)}${"☆".repeat(5 - t.difficulty)}</strong></span><span>LENGTH<strong>${(g.track.length / 1000).toFixed(2)} KM</strong></span><span>LAPS<strong>3</strong></span><span>BEST RACE<strong>${timeString(g.store.best(t.id, s.mode))}</strong></span></div>${isMP ? "" : `<label class="difficulty-select">RIVAL DIFFICULTY<select id="difficulty">${["easy", "normal", "hard", "expert"].map((d) => `<option ${s.difficulty === d ? "selected" : ""} ${d === "expert" && s.finishes < 4 ? "disabled" : ""} value="${d}">${d.toUpperCase()}${d === "expert" && s.finishes < 4 ? " · 4 FINISHES" : ""}</option>`).join("")}</select></label>`}<div class="track-weather">${icon("sun")} ${t.weather} <span>${racerCount} · 3 LAPS</span></div><button data-action="race" class="primary wide" ${available ? "" : "disabled"}>${raceLabel} ${icon(available ? "arrow" : "lock")}</button></section><div class="track-picker">${TRACKS.map((v, i) => `<button class="track-choice ${v.id === t.id ? "selected" : ""}" data-action="track" data-value="${v.id}"><div class="track-art ${v.id}"><span class="art-sun"></span><span class="art-mountain one"></span><span class="art-road"></span><span class="art-tag">${String(i + 1).padStart(2, "0")} ${s.finishes < v.cost ? " / LOCKED" : ""}</span></div><strong>${v.name}</strong><span>${v.weather.toUpperCase()}</span></button>`).join("")}</div></main>${this.footer()}${debugOverlay}`;
      this.drawMap(document.getElementById("track-preview-map"));
    } else if (["COUNTDOWN", "RACING"].includes(state)) {
      const isMP = g.multiplayerActive;
      const playerCount = isMP ? g.lobbyPlayers.length : 8;
      this.root.innerHTML = `<div class="race-hud"><div class="hud-top"><div class="hud-block"><span>LAP</span><strong id="lap">1 <small>/ 3</small></strong><p id="track-name">${g.track.data.name.toUpperCase()} ${isMP ? `• ${g.lobby?.code || ''}` : ''}</p></div><div class="hud-timer"><span>RACE TIME</span><strong id="timer">00:00.00</strong><small>BEST LAP <b id="best-lap">— — : — —</b></small></div><div class="hud-position"><div class="hud-block"><span>POSITION</span><strong id="position">1 <small>/ ${playerCount}</small></strong></div><button data-action="pause" class="race-pause" aria-label="Pause race">${icon("pause")}</button></div></div><div id="wrong-way" class="wrong-way" hidden>↶ WRONG WAY</div><div id="countdown" class="countdown"></div><div id="lap-notice" class="lap-notice"></div><div class="hud-bottom"><div class="hud-map"><canvas id="minimap" width="210" height="175" aria-label="Race minimap"></canvas><span id="checkpoint">CHECKPOINT 01 / 12</span><div class="drift-score"><span>DRIFT SCORE</span><strong id="drift-score">+0</strong></div></div><div class="speedometer"><div class="speed-main"><span id="gear" class="gear">N</span><strong id="speed">0</strong><span>KM/H<small id="max-speed">MAX ${Math.round(((16 + car.accel * 0.22) / ((16 + car.accel * 0.22) / (47 + car.speed * 0.38) + 0.1)) * 3.6)}</small></span></div><div class="rpm"><i id="rpm-fill"></i></div><div class="nitro"><span>${icon("bolt")} NITRO <kbd>SHIFT</kbd></span><i><b id="nitro-fill"></b></i></div></div></div><div class="race-key-hint">WASD / DRIVE    SPACE / DRIFT    R / RESTART ${isMP ? '• MULTIPLAYER • NO AI' : ''}</div></div><div class="touch-controls"><div class="touch-steer"><button data-control="left" aria-label="Steer left">◀</button><button data-control="right" aria-label="Steer right">▶</button></div><div class="touch-pedals"><button data-control="boost" class="touch-boost">NITRO</button><button data-control="drift">DRIFT</button><button data-control="brake">BRAKE</button><button data-control="gas" class="gas">GAS ↑</button></div></div>${debugOverlay}`;
      g.input.bindTouch();
    } else if (state === "PAUSED") {
      this.root.innerHTML = `<div class="modal-backdrop"><section class="pause-panel"><span class="eyebrow">TAKE A BREATHER.</span><h1>PIT STOP.</h1><p>The road will be right where you left it.</p><button class="primary wide" data-action="resume">BACK TO THE RACE ${icon("play")}</button><button class="outline wide" data-action="restart">RESTART RACE ${icon("flag")}</button><button class="outline wide" data-action="settings">SETTINGS ${icon("settings")}</button><button class="text-link" data-action="menu">QUIT TO MENU ${icon("arrow")}</button><small>PRESS P OR ESC TO RESUME</small></section></div>`;
    } else if (state === "SETTINGS") {
      const st = s.settings;
      this.root.innerHTML = `${this.header("settings")}<main class="standard-page"><div class="section-intro"><button class="back-link" data-action="back">${icon("back")} BACK</button><div class="eyebrow">TUNE YOUR EXPERIENCE</div><h1>JUST YOUR\n<em>SPEED.</em></h1><p>Your settings are saved automatically.</p></div><section class="settings-panel"><h3>01 / THE LOOK</h3><label class="setting-row">GRAPHICS QUALITY<select data-setting="graphics">${["low", "medium", "high"].map((v) => `<option ${st.graphics === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>${[
        ["shake", "Screen shake"],
        ["particles", "Particles & skid marks"],
        ["crt", "CRT scanlines"],
        ["motion", "Speed effects"],
      ]
        .map(([k, n]) => this.toggle(k, n, st[k]))
        .join(
          "",
        )}<h3>02 / THE SOUND</h3>${this.toggle("music", "Synthwave soundtrack", st.music)}${this.toggle("sfx", "Engine & sound effects", st.sfx)}${[
        ["master", "Master volume"],
        ["musicVolume", "Music volume"],
        ["sfxVolume", "Effects volume"],
      ]
        .map(
          ([k, n]) =>
            `<label class="setting-row">${n}<input aria-label="${n}" data-setting="${k}" type="range" min="0" max="1" step=".05" value="${st[k]}"></label>`,
        )
        .join(
          "",
        )}<h3>03 / THE DRIVER</h3><label class="setting-row">PLAYER NAME<input id="player-name" maxlength="16" value="${safe(s.name)}"></label><label class="setting-row">DEBUG MODE<input type="checkbox" data-setting="debug" ${g.debug?.enabled ? 'checked' : ''}></label><small class="save-status">${g.store.available ? "SAVED ON THIS DEVICE. NO ACCOUNT. JUST DRIVE." : "STORAGE UNAVAILABLE · PROGRESS LASTS THIS SESSION."}</small><small class="save-status">Supabase: ${isSupabaseConfigured() ? 'Connected' : 'Offline mock mode'} • User: ${getCurrentUserId()?.slice(0,8) || 'none'}</small></section></main>${this.footer()}${debugOverlay}`;
    } else if (state === "HOW_TO_PLAY") {
      this.root.innerHTML = `${this.header()}<main class="standard-page"><div class="section-intro"><button class="back-link" data-action="back">${icon("back")} BACK</button><div class="eyebrow">EASY TO LEARN. HARD TO LEAVE.</div><h1>FIND YOUR\n<em>FLOW.</em></h1><p>Three laps. Eight racers. One open road.</p><button data-action="start" class="primary">LET’S RACE ${icon("arrow")}</button></div><section class="how-panel"><h3>THE BASICS</h3>${[
        ["W / ↑", "Accelerate"],
        ["S / ↓", "Brake / hold to reverse"],
        ["A D / ← →", "Steer"],
        ["SPACE", "Handbrake / drift"],
        ["SHIFT", "Nitro boost"],
        ["E / X", "Use item (Kart/Multiplayer)"],
        ["P / ESC", "Pause / resume"],
        ["R", "Restart race"],
      ]
        .map(
          ([k, n]) =>
            `<div class="control-row"><kbd>${k}</kbd><span>${n}</span></div>`,
        )
        .join(
          "",
        )}<div class="pro-tip"><strong>GOOD TO KNOW</strong><p>Brake before a corner. Hold SPACE and steer at speed to drift. Drifting refills nitro faster. Keep all four wheels on the road for maximum speed.</p><p>Pass all 12 checkpoints in order to finish a lap. Finish races to unlock cars, destinations and Expert rivals. Touch controls appear on phones.</p></div><div class="pro-tip"><strong>MULTIPLAYER</strong><p>Multiplayer is real-player only - NO AI. Create lobby (6-digit code), share with friends, select car/character, ready up, host starts. Max 8 human players. Positions sync via realtime broadcast (not DB writes every frame). Name tags above cars. Host migration if host leaves lobby.</p><p>Collision improved: no-clipping through walls, vehicle separation, stuck detection, fall recovery to checkpoint.</p></div></section></main>${this.footer()}${debugOverlay}`;
    } else if (state === "RECORDS") {
      const records = s.records.slice().sort((a, b) => b.score - a.score);
      this.root.innerHTML = `${this.header("records")}<main class="records-page"><button class="back-link" data-action="menu">${icon("back")} BACK TO MENU</button><div class="record-heading"><div><div class="eyebrow">NO ALGORITHMS. JUST BRAGGING RIGHTS.</div><h1>LOCAL <em>RECORDS.</em></h1></div><div class="record-count"><strong>${s.finishes.toString().padStart(2, "0")}</strong><span>RACES FINISHED</span></div></div><p class="records-note">Your personal hall of fame. Stored on this device, not a global leaderboard.</p><div class="records-table"><div class="record-row table-head"><span># / DRIVER</span><span>TRACK / MACHINE</span><span>TIME</span><span>SCORE</span><span>DATE</span></div>${records.length ? records.map((r, i) => `<div class="record-row"><strong><small>${String(i + 1).padStart(2, "0")}</small> ${safe(r.name)}<small>${r.mode === "kart" ? "KART · " + safe(r.character || "vex").toUpperCase() : "CLASSIC"}${r.multiplayer ? ' • MP' : ''}</small></strong><span>${safe(ALL_TRACKS.find((t) => t.id === r.track)?.name || r.track)}<small>${safe(CARS.find((c) => c.id === r.car)?.name || r.car)}</small></span><strong>${timeString(r.time)}</strong><strong>${Number(r.score).toLocaleString()}</strong><span>${safe(r.date)}</span></div>`).join("") : `<div class="empty-records">${icon("trophy")}<h2>Great stories start at the grid.</h2><p>Finish your first race to put your name here.</p><button class="primary" data-action="start">MAKE YOUR FIRST RECORD ${icon("arrow")}</button></div>`}</div></main>${this.footer()}${debugOverlay}`;
    } else if (state === "RESULTS") {
      const r = g.result;
      const isMP = r.multiplayer;
      const positions = r.positions || [];
      
      this.root.innerHTML = `<div class="modal-backdrop results-backdrop"><section class="results-panel"><div class="eyebrow">${isMP ? 'MULTIPLAYER • HUMAN ONLY • NO AI' : 'CHECKERED FLAG. UNCHECKED JOY.'}</div><h1>RACE <em>COMPLETE.</em></h1><div class="finish-position"><strong>${r.position}<sup>${["ST", "ND", "RD"][r.position - 1] || "TH"}</sup></strong><span>PLACE\n<b>${g.track.data.name.toUpperCase()}</b>${isMP ? `<br><small>${positions.length} HUMAN PLAYERS` : ''}</b></span>${icon("flag")}</div>${isMP ? `<div class="mp-results"><h3>FINAL STANDINGS • ${positions.length} REAL PLAYERS</h3><div class="mp-positions">${positions.map(p => `<div class="mp-pos ${p.isLocal ? 'is-me' : ''}"><span>${p.position}</span><strong>${safe(p.username)}</strong><small>${p.time ? timeString(p.time) : 'DNF'}</small></div>`).join("")}</div></div>` : ''}<div class="result-stats">${[
        ["RACE TIME", timeString(r.time)],
        ["BEST LAP", timeString(r.bestLap)],
        ["TOTAL SCORE", r.score.toLocaleString()],
        ["OVERTAKES", r.overtakes],
        ["DRIFT SCORE", "+" + r.drift],
      ]
        .map(([n, v]) => `<span>${n}<strong>${v}</strong></span>`)
        .join(
          "",
        )}</div><div class="saved-record">${icon("check")} ${g.store.available ? "RECORD SAVED ON THIS DEVICE" : "RECORD KEPT FOR THIS SESSION"} <span>${s.finishes} RACES FINISHED</span></div>${r.unlocks?.length ? `<div class="unlock-banner">NEWLY UNLOCKED: ${r.unlocks.join(" · ")}</div>` : ""}<div class="result-actions"><button class="primary" data-action="${isMP ? 'leave-lobby' : 'next'}">${isMP ? 'RETURN TO LOBBY' : 'NEXT RACE'} ${icon("arrow")}</button><button class="outline" data-action="${isMP ? 'menu' : 'restart'}">${isMP ? 'MAIN MENU' : 'RACE AGAIN'}</button><button class="outline" data-action="records">LOCAL RECORDS</button></div><div class="result-links"><button data-action="garage">GARAGE</button><button data-action="tracks">TRACK SELECT</button><button data-action="menu">MAIN MENU</button></div></section></div>${debugOverlay}`;
    } else if (state === "LOADING") {
      this.root.innerHTML = `<div class="boot"><div class="brand">PIXEL<span>RACER</span><sup>3D</sup></div><div class="load-track"><i></i></div><p>${g.loadingText || "LOADING THE OPEN ROAD…"}</p></div>`;
    }
    
    enhanceKartUI(this);
  }

  renderDebugOverlay() {
    const g = this.g;
    const d = g.debug;
    return `<div id="debug-overlay" class="debug-overlay">
      <div>FPS: ${d.fps} | Frame: ${d.frameTime?.toFixed(1) || 0}ms</div>
      <div>Players: ${d.playerCount || (g.multiplayerActive ? g.lobbyPlayers?.length : g.ai?.length + 1) || 0} ${g.multiplayerActive ? '(MP NO AI)' : ''}</div>
      <div>Lobby: ${g.lobby?.code || 'none'} | Host: ${g.isHost ? 'yes' : 'no'}</div>
      <div>User: ${getCurrentUserId()?.slice(0,8) || 'none'} | Supabase: ${isSupabaseConfigured() ? 'on' : 'mock'}</div>
      <div>Pos: ${g.player ? `${g.player.position.x.toFixed(1)},${g.player.position.z.toFixed(1)}` : 'none'} | Speed: ${g.player ? Math.round(g.player.speed*3.6) : 0}</div>
      <div>Track: ${g.track?.data?.id || 'none'} | S: ${g.player ? g.track.nearest(g.player.position).s.toFixed(3) : '0'}</div>
    </div>`;
  }

  toggle(key, name, val) {
    return `<label class="setting-row">${name}<span class="switch"><input type="checkbox" data-setting="${key}" ${val ? "checked" : ""}><i></i></span></label>`;
  }

  action(a, v) {
    const g = this.g,
      s = g.store.data;
    switch (a) {
      case "submit-username":
        this.handleUsernameSubmit();
        break;
      case "fill-username":
        {
          const input = document.getElementById("username-input");
          if (input && v) {
            input.value = v;
            input.focus();
            const err = document.getElementById("username-error");
            if (err) err.hidden = true;
            input.classList.remove("error");
          }
        }
        break;
      case "change-username":
        g.setState("USERNAME_PROMPT");
        break;
      case "mode":
        g.setMode(v);
        break;
      case "characters":
        g.openCharacters();
        break;
      case "character":
        g.chooseCharacter(v);
        if (g.state === "MULTIPLAYER_LOBBY") {
          import("../multiplayer/Lobby.js").then(({ lobbyManager }) => {
            lobbyManager.updatePlayerSelection({ character: v });
          });
          s.character = v;
          s.save?.() || g.store.save();
        }
        break;
      case "choose-character":
        if (s.finishes < g.character.cost) return;
        s.character = g.character.id;
        g.store.save();
        g.openGarage();
        break;
      case "item":
        g.kart?.activate();
        break;
      case "menu":
        if (g.multiplayerActive) {
          g.leaveMultiplayer();
        } else {
          g.setup = false;
          g.menu();
        }
        break;
      case "start":
        g.setup = true;
        s.mode === "kart" ? g.openCharacters() : g.openGarage();
        break;
      case "garage":
        g.openGarage();
        break;
      case "tracks":
        g.openTracks();
        break;
      case "car":
        g.selectCar(v);
        break;
      case "track":
        g.selectTrack(v);
        break;
      case "paint":
        s.paint[g.previewCar.id] = v;
        g.store.save();
        g.rebuildCar();
        this.render();
        break;
      case "equip":
        if (s.finishes < g.previewCar.cost) return;
        s.car = g.previewCar.id;
        g.store.save();
        if (g.state === "MULTIPLAYER_LOBBY") {
          import("../multiplayer/Lobby.js").then(({ lobbyManager }) => {
            lobbyManager.updatePlayerSelection({ car: v || s.car });
          });
        } else {
          g.setup ? g.openTracks() : g.menu();
        }
        break;
      case "race":
        if (s.finishes < g.previewTrack.cost) return;
        if (g.multiplayerActive) {
          // Map selection for multiplayer: this button just confirms the
          // pick and returns the host to the lobby with the other
          // players — it must never fall through into a solo race.
          g.trackId = g.previewTrack.id;
          g.setState("MULTIPLAYER_LOBBY");
        } else {
          g.trackId = g.previewTrack.id;
          g.store.save();
          g.startRace();
        }
        break;
      case "lights":
        g.previewLights = !g.previewLights;
        this.render();
        break;
      case "brakelights":
        g.previewBrakes = !g.previewBrakes;
        this.render();
        break;
      case "settings":
        if (g.state === "SETTINGS") return;
        g.settingsReturn = g.state;
        g.setState("SETTINGS");
        break;
      case "how":
        g.settingsReturn = g.state;
        g.setState("HOW_TO_PLAY");
        break;
      case "back":
        if (g.settingsReturn === "PAUSED") g.setState("PAUSED");
        else g.menu();
        break;
      case "records":
        g.setup = false;
        g.setState("RECORDS");
        break;
      case "pause":
        g.pause();
        break;
      case "resume":
        g.resume();
        break;
      case "restart":
        if (g.multiplayerActive) {
          g.leaveMultiplayer();
        } else {
          g.startRace();
        }
        break;
      case "next": {
        const TRACKS = g.raceTracks;
        const i = TRACKS.findIndex((t) => t.id === g.trackId);
        g.trackId =
          TRACKS[(i + 1) % TRACKS.length].cost <= s.finishes
            ? TRACKS[(i + 1) % TRACKS.length].id
            : "coast";
        g.store.save();
        g.openTracks();
        break;
      }
      case "fullscreen":
        g.fullscreen();
        break;
      // Multiplayer actions
      case "multiplayer":
        g.openMultiplayer();
        break;
      case "create-lobby":
        g.createMultiplayerLobby();
        break;
      case "join-lobby-prompt":
        g.setState("JOIN_LOBBY");
        break;
      case "join-lobby-submit":
        this.handleJoinLobby();
        break;
      case "copy-code":
        if (g.lobby?.code) {
          navigator.clipboard.writeText(g.lobby.code).then(() => {
            this.toast(`Code ${g.lobby.code} copied!`);
          }).catch(() => {
            this.toast(`Code: ${g.lobby.code}`);
          });
        }
        break;
      case "leave-lobby":
        g.leaveMultiplayer();
        break;
      case "toggle-ready":
        this.handleToggleReady();
        break;
      case "start-multiplayer-race":
        this.handleStartMultiplayerRace();
        break;
      case "change-map":
        g.openTracks();
        break;
      case "cancel-map-select":
        g.setState("MULTIPLAYER_LOBBY");
        break;
    }
  }

  async handleUsernameSubmit() {
    const input = document.getElementById("username-input");
    const errorEl = document.getElementById("username-error");
    if (!input) return;

    const value = input.value;
    const validation = validateUsername(value);

    if (!validation.valid) {
      if (errorEl) {
        errorEl.textContent = validation.error;
        errorEl.hidden = false;
      }
      input.classList.add("error");
      return;
    }

    const submitBtn = this.root.querySelector('[data-action="submit-username"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "SAVING...";
    }

    try {
      const { createOrUpdateUsername } = await import("../multiplayer/Username.js");
      await createOrUpdateUsername(validation.username);
      this.g.store.data.name = validation.username;
      this.g.store.save();
      this.g.menu();
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = e.message;
        errorEl.hidden = false;
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "CONTINUE →";
      }
    }
  }

  async handleJoinLobby() {
    const input = document.getElementById("lobby-code-input");
    const errorEl = document.getElementById("lobby-code-error");
    if (!input) return;

    const code = input.value.trim();
    const validation = validateLobbyCode(code);

    if (!validation.valid) {
      if (errorEl) {
        errorEl.textContent = validation.error;
        errorEl.hidden = false;
      }
      input.classList.add("error");
      return;
    }

    const submitBtn = this.root.querySelector('[data-action="join-lobby-submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "JOINING...";
    }

    try {
      await this.g.joinMultiplayerLobby(validation.code);
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = e.message;
        errorEl.hidden = false;
      }
      input.classList.add("error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "JOIN";
      }
    }
  }

  async handleToggleReady() {
    const currentUserId = getCurrentUserId();
    const player = this.g.lobbyPlayers.find(p => p.player_id === currentUserId);
    if (!player) return;

    const newReady = !player.is_ready;
    
    // Validate selections before ready
    if (newReady) {
      if (!player.selected_car) {
        this.toast("Select a car first");
        return;
      }
      if (this.g.lobby?.mode === 'kart' && !player.selected_character) {
        this.toast("Select a character first");
        return;
      }
    }

    try {
      const { lobbyManager } = await import("../multiplayer/Lobby.js");
      await lobbyManager.updatePlayerSelection({ isReady: newReady });
      
      const btn = document.getElementById("ready-button");
      if (btn) {
        btn.textContent = newReady ? "NOT READY" : "READY";
      }
    } catch (e) {
      this.toast(e.message || "Failed to update ready state");
    }
  }

  async handleStartMultiplayerRace() {
    if (!this.g.isHost) {
      this.toast("Only host can start race");
      return;
    }

    const players = this.g.lobbyPlayers;
    if (players.length < 2) {
      this.toast("Need at least 2 players");
      return;
    }

    if (!players.every(p => p.is_ready)) {
      this.toast("All players must be ready");
      return;
    }

    try {
      const { lobbyManager } = await import("../multiplayer/Lobby.js");
      await lobbyManager.startRace();
      this.toast("Starting race...");
    } catch (e) {
      this.toast(e.message || "Failed to start race");
    }
  }

  handleInput(el) {
    if (el.id === "lobby-code-input") {
      // Auto-remove invalid chars and uppercase
      let val = el.value.replace(/[^0-9]/g, '').slice(0, 6);
      if (val !== el.value) {
        el.value = val;
      }
      const errorEl = document.getElementById("lobby-code-error");
      if (errorEl) errorEl.hidden = true;
      el.classList.remove("error");
    } else if (el.id === "username-input") {
      const errorEl = document.getElementById("username-error");
      if (errorEl) errorEl.hidden = true;
      el.classList.remove("error");
      // Remove invalid chars
      const sanitized = el.value.replace(/[^a-zA-Z0-9 ]/g, '');
      if (sanitized !== el.value) {
        el.value = sanitized;
      }
    }
  }

  change(el) {
    const g = this.g,
      s = g.store.data;
    if (el.dataset.setting) {
      const k = el.dataset.setting;
      if (k === 'debug') {
        g.debug.enabled = el.checked;
        if (g.debug.enabled) {
          console.log("[Debug] Enabled via settings");
        }
      } else {
        s.settings[k] =
          el.type === "checkbox"
            ? el.checked
            : el.type === "range"
              ? Number(el.value)
              : el.value;
      }
      g.applySettings();
    } else if (el.id === 'lobby-mode' && g.isHost) {
      const mode = el.value;
      import("../multiplayer/Lobby.js").then(({ lobbyManager }) => {
        lobbyManager.updateLobbySettings({ mode }).catch(e => {
          console.warn("Failed to update mode:", e);
        });
      });
    } else if (el.dataset.custom) {
      const k = el.dataset.custom;
      if (k === 'mp-car') {
        const carId = el.value;
        this.previousMultiplayerCar = s.car;
        s.car = carId;
        g.store.save();
        this.render();
        import("../multiplayer/Lobby.js").then(({ lobbyManager }) => {
          lobbyManager.updatePlayerSelection({ car: carId }).catch(e => this.toast(e.message));
        });
      } else if (k === 'mp-character') {
        const charId = el.value;
        s.character = charId;
        g.store.save();
        this.render();
        import("../multiplayer/Lobby.js").then(({ lobbyManager }) => {
          lobbyManager.updatePlayerSelection({ character: charId }).catch(e => this.toast(e.message));
        });
      } else {
        (s.custom[g.previewCar.id] ??= {})[k] =
          el.type === "checkbox"
            ? el.checked
            : k === "number"
              ? Math.max(1, Math.min(99, Number(el.value) || 1))
              : el.value;
        g.rebuildCar();
      }
    } else if (el.id === "difficulty") s.difficulty = el.value;
    else if (el.id === "player-name") {
      const newName = el.value.trim() || "PLAYER";
      const validation = validateUsername(newName);
      if (validation.valid) {
        s.name = validation.username;
        // Also update profile
        import("../multiplayer/Username.js").then(({ createOrUpdateUsername }) => {
          createOrUpdateUsername(validation.username).catch(() => {});
        });
      }
    }
    g.store.save();
  }

  drawMap(canvas, race = false) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d"),
      w = canvas.width,
      h = canvas.height,
      track = this.g.track,
      pts = track.points;
    const xs = pts.map((p) => p.x),
      zs = pts.map((p) => p.z),
      minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs),
      scale = Math.min((w - 32) / (maxX - minX), (h - 22) / (maxZ - minZ));
    const project = (p) => [
      (p.x - (maxX + minX) / 2) * scale + w / 2,
      (p.z - (maxZ + minZ) / 2) * scale + h / 2,
    ];
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = project(p);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = race ? "#f5eed8aa" : "#697168";
    ctx.lineWidth = race ? 5 : 7;
    ctx.lineJoin = "round";
    ctx.stroke();
    for (const route of track.routes || []) {
      ctx.beginPath();
      const a = project(route.points[0]),
        b = project(route.points.at(-1));
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.strokeStyle = "#d5ac55";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const [sx, sy] = project(pts[0]);
    ctx.fillStyle = "#ed673e";
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    if (race) {
      // Multiplayer: show remote players
      if (this.g.multiplayerActive && this.g.multiplayerRace) {
        for (const remote of this.g.multiplayerRace.remotePlayers.values()) {
          const [x, y] = project(remote.position);
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = "#7ec8e3";
          ctx.fill();
        }
      } else {
        for (const a of this.g.ai) {
          const [x, y] = project(a.car.group.position);
          ctx.beginPath();
          ctx.arc(x, y, 2.8, 0, Math.PI * 2);
          ctx.fillStyle = "#f0dca9";
          ctx.fill();
        }
      }
      const p = this.g.player;
      if (p) {
        const [x, y] = project(p.position);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-p.yaw);
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(-4, -4);
        ctx.lineTo(4, -4);
        ctx.closePath();
        ctx.fillStyle = "#ff6c42";
        ctx.fill();
        ctx.restore();
      }
    }
  }

  updateHUD() {
    updateKartHUD(this);
    const g = this.g,
      p = g.player;
    if (!p || !g.progress) return;

    // Performance: only update if changed
    const cache = g._hudCache;
    
    const setIfChanged = (id, value, cacheKey) => {
      if (cache[cacheKey] !== value) {
        const e = this.getElement(id);
        if (e) e.innerHTML = value;
        cache[cacheKey] = value;
      }
    };

    const lapValue = `${Math.min(3, g.progress.lap + 1)} <small>/ 3</small>`;
    setIfChanged("lap", lapValue, 'lap');

    const playerCount = g.multiplayerActive ? g.lobbyPlayers.length : 8;
    const posValue = `${g.position} <small>/ ${playerCount}</small>`;
    setIfChanged("position", posValue, 'position');

    const timerValue = timeString(g.raceTime);
    setIfChanged("timer", timerValue, 'timer');

    const bestLapValue = timeString(g.bestLap);
    setIfChanged("best-lap", bestLapValue, 'bestLap');

    const speedValue = Math.round(Math.abs(p.speed) * 3.6).toString();
    setIfChanged("speed", speedValue, 'speed');

    const gearValue = p.speed < -1 ? "R" : p.speed < 1 ? "N" : Math.min(6, 1 + Math.floor((p.speed * 3.6) / 48)).toString();
    setIfChanged("gear", gearValue, 'gear');

    const driftValue = "+" + Math.floor(p.driftScore);
    setIfChanged("drift-score", driftValue, 'drift');

    const checkpointValue = `CHECKPOINT ${Math.min(12, g.progress.checkpoint).toString().padStart(2, "0")} / 12`;
    setIfChanged("checkpoint", checkpointValue, 'checkpoint');

    // Nitro and RPM always update (they change frequently)
    const nitro = this.getElement("nitro-fill");
    if (nitro) nitro.style.width = p.nitro * 100 + "%";
    
    const rpm = this.getElement("rpm-fill");
    if (rpm)
      rpm.style.width = (((Math.abs(p.speed) * 3.6) % 48) / 48) * 100 + "%";
    
    const ww = this.getElement("wrong-way");
    if (ww) ww.hidden = !(g.progress.wrongWay && Math.abs(p.speed) > 5);
    
    // Only redraw minimap every other call for performance
    if (g.hudClock === 0 || Math.random() > 0.5) {
      this.drawMap(this.getElement("minimap"), true);
    }
  }

  toast(text) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("visible");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove("visible"), 3500);
  }
}