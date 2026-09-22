import { CHARACTERS, ITEMS } from "./data.js";
export function characterScreen(ui) {
  const g = ui.g,
    c = g.character,
    s = g.store.data;
  return `${ui.header()}<main class="character-view"><div class="character-heading"><button class="back-link" data-action="menu">← BACK TO MENU</button><div class="eyebrow">KART RACE / 01 · SELECT RACER</div><h1>SMALL CREW.
<em>BIG ENERGY.</em></h1><p>Eight originals. Find your racing instinct.</p></div><section class="character-panel"><span class="eyebrow">${c.type}</span><h2>${c.name}</h2><p>${c.trait}</p>${["accel", "speed", "handling", "drift", "weight"].map((key, i) => `<div class="stat-row"><span>${["ACCELERATION", "TOP SPEED", "HANDLING", "DRIFT", "WEIGHT"][i]}</span><i><b style="width:${c[key]}%;background:${c.color}"></b></i><strong>${c[key]}</strong></div>`).join("")}<p class="combination-note">Your racer contributes 40% of performance; your vehicle contributes 60%. Weight controls impact resistance.</p><button class="primary wide" data-action="choose-character" ${s.finishes < c.cost ? "disabled" : ""}>${s.finishes < c.cost ? `FINISH ${c.cost} RACES TO UNLOCK` : "CHOOSE VEHICLE →"}</button><small>DRAG THE SCENE TO ROTATE · SCROLL TO ZOOM</small></section><div class="character-picker">${CHARACTERS.map((v, i) => `<button data-action="character" data-value="${v.id}" class="character-choice ${c.id === v.id ? "selected" : ""}" style="--racer:${v.color}"><span class="helmet-icon"><i></i></span><span><small>0${i + 1} ${s.finishes < v.cost ? " / LOCKED" : ""}</small><strong>${v.name}</strong></span></button>`).join("")}</div></main>${ui.footer()}`;
}
export function enhanceKartUI(ui) {
  const g = ui.g,
    s = g.store.data,
    root = ui.root;
  if (g.state === "MENU") {
    root.querySelector(".hero-meta").innerHTML =
      `<div class="mode-switch" role="group" aria-label="Race mode"><button data-action="mode" data-value="classic" aria-pressed="${s.mode === "classic"}">CLASSIC</button><button data-action="mode" data-value="kart" aria-pressed="${s.mode === "kart"}">KART RACE <small>NEW</small></button></div>`;
    if (s.mode === "kart") {
      root.querySelector(".eyebrow").lastChild.textContent =
        " THE ADVENTURE CIRCUIT.";
      root.querySelector(".hero-copy p").innerHTML =
        "Original racers. Unexpected turns.<br>Items, jumps, and a little friendly chaos.";
    }
  }
  if (s.mode !== "kart") return;
  document.body.classList.add("kart-mode");
  const nav = root.querySelector("nav");
  if (nav)
    nav.insertAdjacentHTML(
      "afterbegin",
      '<button class="nav-link" data-action="characters" aria-label="Racers"><span>Racers</span><b>◉</b></button>',
    );
  const footer = root.querySelector(".footer-mid");
  if (footer) footer.textContent = "8 RACERS / 11 DESTINATIONS / ONE ADVENTURE";
  if (g.state === "GARAGE") {
    root.querySelector(".page-heading .eyebrow").textContent =
      `02 / ${g.character.name.toUpperCase()} · CHOOSE YOUR MACHINE`;
    root
      .querySelector(".garage-panel")
      .insertAdjacentHTML(
        "afterbegin",
        `<div class="kart-combo">${g.character.name.toUpperCase()} + VEHICLE · OPEN-COCKPIT EDITION</div>`,
      );
    const stat = g.carSpec(g.previewCar);
    root.querySelectorAll(".stat-row").forEach((row, i) => {
      const v = Math.round(
        stat[["speed", "accel", "handling", "braking", "drift"][i]],
      );
      row.querySelector("strong").textContent = v;
      row.querySelector("b").style.width = v + "%";
    });
  }
  if (g.state === "TRACK_SELECT") {
    const t = g.previewTrack;
    root
      .querySelector(".track-panel")
      .insertAdjacentHTML(
        "beforeend",
        `<div class="adventure-facts"><span>SHORTCUTS <b>${t.kart ? 2 : 0}</b></span><span>HAZARDS <b>${t.hazard ? t.hazard.toUpperCase() : "ITEMS"}</b></span><span>ITEM BOXES <b>24</b></span></div>`,
      );
  }
  if (["RACING", "COUNTDOWN"].includes(g.state)) {
    root
      .querySelector(".race-hud")
      .insertAdjacentHTML(
        "beforeend",
        `<div class="kart-hud"><button data-action="item" id="item-slot" aria-label="Use held item"><span class="item-glyph" id="item-glyph">◇</span><span><small>ITEM <kbd>E / X</kbd></small><strong id="item-name">EMPTY</strong></span></button><div class="token-readout">◉ <strong id="token-count">0</strong><small>TOKENS</small></div><div id="kart-status"></div><div class="drift-charge"><i id="drift-charge"></i></div><small>DRIFT → RELEASE → MINI-TURBO</small></div><div id="kart-message" role="status"></div>`,
      );
    const pedals = root.querySelector(".touch-pedals");
    const item = document.createElement("button");
    item.dataset.action = "item";
    item.className = "touch-item";
    item.textContent = "ITEM";
    item.setAttribute("aria-label", "Use held item");
    pedals.prepend(item);
  }
  if (g.state === "RESULTS" && g.result.kartStats)
    root
      .querySelector(".saved-record")
      .insertAdjacentHTML(
        "beforebegin",
        `<div class="kart-result">◉ ${g.result.tokens} TOKENS EARNED · ${g.result.kartStats.items} ITEMS USED · ${g.result.kartStats.shortcuts} SHORTCUTS · ${g.result.kartStats.jumps} JUMPS</div>`,
      );
  if (g.state === "HOW_TO_PLAY")
    root.querySelector(".how-panel").insertAdjacentHTML(
      "beforeend",
      `<div class="pro-tip"><strong>KART FIELD GUIDE</strong><p>E / X or ITEM: activate your held item. Purple boxes respawn after 5 seconds. Gold tokens replenish nitro and add 100 points. Hold a drift, then release to mini-turbo. Teal pads boost; gold ramps launch.</p><p>Yellow-marked shortcut lanes are narrower but award extra tokens. Red warning lights announce a crossing hazard. Sky Island unrailed sections allow falls: recovery returns you to the last checkpoint and stops you for 2 seconds.</p>${Object.values(
        ITEMS,
      )
        .map((i) => `<p><b>${i.name}</b> — ${i.description}</p>`)
        .join("")}</div>`,
    );
}
export function updateKartHUD(ui) {
  const k = ui.g.kart;
  if (!k) return;
  const r = k.racers[0],
    item = ITEMS[r.item],
    set = (id, text) => {
      const e = document.getElementById(id);
      if (e) e.textContent = text;
    };
  set("item-name", r.roulette > 0 ? "ROLLING…" : item?.name || "EMPTY");
  set("item-glyph", r.roulette > 0 ? "?" : item?.glyph || "◇");
  set("token-count", r.tokens);
  set("kart-message", k.time < k.messageUntil ? k.message : "");
  set(
    "kart-status",
    r.locked > 0
      ? `RECOVERY ${r.locked.toFixed(1)}s`
      : r.emp > 0
        ? "EMP · ITEMS DISABLED"
        : r.shield > 0
          ? `SHIELD ACTIVE · ${Math.ceil(r.shield)}s`
          : r.turbo > 0
            ? "TURBO ACTIVE"
            : r.boost > 0
              ? "BOOST ACTIVE"
              : r.magnet > 0
                ? `MAGNET · ${Math.ceil(r.magnet)}s`
                : r.cooldown > 0
                  ? "ITEM COOLDOWN"
                  : "",
  );
  const bar = document.getElementById("drift-charge");
  if (bar) bar.style.width = Math.min(100, (r.driftCharge / 3) * 100) + "%";
}
