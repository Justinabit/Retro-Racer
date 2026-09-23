import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import portableChromium from "@sparticuz/chromium";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The portable browser makes this suite usable in minimal Linux CI images.
// Set CHROMIUM_EXECUTABLE to use a locally installed Chromium instead.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, ".cache/browser-tests");
mkdirSync(cache, { recursive: true });
const bundle = path.join(
  root,
  "node_modules/@sparticuz/chromium/bin/al2023.tar.br",
);
if (process.platform === "linux") {
  const tar = path.join(cache, "libs.tar");
  writeFileSync(tar, brotliDecompressSync(readFileSync(bundle)));
  execFileSync("tar", ["xf", tar, "-C", cache]);
}
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_EXECUTABLE ||
    (await portableChromium.executablePath()),
  args: [...portableChromium.args, "--enable-unsafe-swiftshader"],
  headless: true,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: `${cache}/lib:${process.env.LD_LIBRARY_PATH || ""}`,
  },
});
const errors = [];
const report = [];
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
});
const url = process.env.TEST_URL || "http://localhost:5173";
async function driver(id, name) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(
    ({ id, name }) => {
      localStorage.setItem(
        "mock-supabase-user",
        JSON.stringify({ id, isMock: true }),
      );
      localStorage.setItem("pixel-racer-username", name);
      localStorage.setItem(
        "pixel-racer-save",
        JSON.stringify({
          version: 1,
          name,
          finishes: 10,
          settings: { graphics: "low", music: false, sfx: false },
        }),
      );
      const profiles = JSON.parse(
        localStorage.getItem("mock-profiles") || "{}",
      );
      profiles[id] = { id, username: name };
      localStorage.setItem("mock-profiles", JSON.stringify(profiles));
    },
    { id, name },
  );
  await page.goto(url);
  await page.waitForFunction(() => __racer?.state === "MENU");
  return page;
}
async function lobby(page) {
  return page.evaluate(() => __racer.lobby);
}
try {
  const a = await driver("alice", "Alice");
  await a.evaluate(() => __racer.createMultiplayerLobby());
  await a.waitForFunction(() => __racer.state === "MULTIPLAYER_LOBBY");
  const code = (await lobby(a)).code;
  const b = await driver("bob", "Bob");
  await b.evaluate((code) => __racer.joinMultiplayerLobby(code), code);
  await a.waitForFunction(() => __racer.lobbyPlayers.length === 2);
  await a.locator("#mp-car").selectOption("demon");
  await a.waitForFunction(() => __racer.carPreview?.key.startsWith("demon:"));
  assert.match(await a.locator(".mp-selection-stats").innerText(), /95/);
  assert.equal(
    await a.locator("#mp-car-preview").evaluate((canvas) => {
      const pixels = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((n, i) => i % 4 === 3 && n > 0);
    }),
    true,
    "preview renders actual pixels using shared WebGL renderer",
  );
  await b.waitForFunction(
    () =>
      __racer.lobbyPlayers.find((p) => p.player_id === "alice")
        ?.selected_car === "demon",
  );
  assert.equal(
    await b.locator('[data-action="start-multiplayer-race"]').isDisabled(),
    true,
  );
  // Stamp starts with a server-style absolute deadline; both tabs use this.
  for (const p of [a, b])
    await p.evaluate(() => __racer.ui.handleToggleReady());
  await a.waitForFunction(() => __racer.lobbyPlayers.every((p) => p.is_ready));
  await a.evaluate(() => __racer.ui.handleStartMultiplayerRace());
  for (const p of [a, b])
    await p.waitForFunction(() => __racer.state === "RACING");
  for (const p of [a, b])
    assert.deepEqual(
      await p.evaluate(() => ({
        ai: __racer.ai.length,
        remote: __racer.multiplayerRace.remotePlayers.size,
      })),
      { ai: 0, remote: 1 },
    );
  assert.equal(await a.evaluate(() => __racer.player.spec.speed), 95);
  // Drive locally without waiting for a packet or a network acknowledgement.
  await a.evaluate(() => {
    const g = __racer;
    window.startPosition = g.player.position.clone();
    Object.defineProperty(g.input, "controls", {
      configurable: true,
      get: () => ({
        throttle: 1,
        steer: 0.2,
        brake: 0,
        boost: false,
        drift: false,
      }),
    });
  });
  await b.waitForFunction(() => {
    const r = __racer.multiplayerRace.remotePlayers.get("alice");
    return (
      r.buffer.sequence > 20 &&
      r.speed > 5 &&
      r.car.group.position.distanceTo(r.position) < 0.001
    );
  });
  assert.ok(
    (await a.evaluate(() =>
      __racer.player.position.distanceTo(window.startPosition),
    )) > 1,
  );
  const seq = await b.evaluate(
    () => __racer.multiplayerRace.remotePlayers.get("alice").buffer.sequence,
  );
  // Drop outgoing packets (not physics); then resume the SAME race transport.
  await a.evaluate(() => {
    const t = __racer.multiplayerRace.transport;
    t.realSend = t.send;
    t.send = () => false;
    window.outagePosition = __racer.player.position.clone();
  });
  await b.waitForFunction(
    () =>
      __racer.multiplayerRace.remotePlayers.get("alice").buffer.mode ===
      "stale",
  );
  await a.waitForFunction(
    () => __racer.player.position.distanceTo(window.outagePosition) > 0.2,
  );
  await a.evaluate(() => {
    const t = __racer.multiplayerRace.transport;
    t.send = t.realSend;
  });
  await b.waitForFunction(
    (seq) =>
      __racer.multiplayerRace.remotePlayers.get("alice").buffer.sequence >
      seq + 5,
    seq,
  );
  // Ranking is transmitted, not inferred from the delayed car mesh.
  await a.evaluate(() => {
    __racer.progress.lap = 1;
    __racer.progress.total = 1.1;
    __racer.progress.checkpoint = 2;
  });
  await b.waitForFunction(
    () => __racer.multiplayerRace.remotePlayers.get("alice").progress.lap === 1,
  );
  report.push(
    "Two independent clients: lobby selections, real preview pixels, host/ready rules, shared countdown, zero AI, car physics, moving remote mesh, progress, dropped-packet recovery.",
  );
  // Force finish for integration purposes; physics lap validity is covered by unit tests.
  for (const p of [a, b])
    await p.evaluate(() => {
      __racer.progress.finished = true;
      __racer.progress.lap = 3;
      __racer.progress.total = 3;
    });
  for (const p of [a, b])
    await p.waitForFunction(() => __racer.state === "RESULTS");
  assert.equal(await a.evaluate(() => __racer.result.positions.length), 2);
  for (const p of [a, b]) await p.evaluate(() => __racer.leaveMultiplayer());
  for (const p of [a, b])
    assert.equal(await p.locator(".race-connection").count(), 0);
  // Repeat on Kart mode to exercise fresh listeners and human item targets.
  await a.evaluate(() => {
    __racer.store.data.mode = "kart";
    return __racer.createMultiplayerLobby();
  });
  await b.evaluate(
    (code) => __racer.joinMultiplayerLobby(code),
    (await lobby(a)).code,
  );
  for (const p of [a, b])
    await p.evaluate(() => __racer.ui.handleToggleReady());
  await a.waitForFunction(
    () =>
      __racer.lobbyPlayers.length === 2 &&
      __racer.lobbyPlayers.every((p) => p.is_ready),
  );
  await a.evaluate(() => __racer.ui.handleStartMultiplayerRace());
  for (const p of [a, b])
    await p.waitForFunction(() => __racer.state === "RACING");
  for (const p of [a, b])
    assert.equal(await p.evaluate(() => __racer.kart.racers.length), 2);
  await a.evaluate(() => {
    delete __racer.input.controls;
    __racer.kart.racers[0].item = "shield";
    __racer.kart.racers[0].roulette = 0;
    __racer.kart.activate();
  });
  await b.waitForFunction(
    () => __racer.kart.racers.find((r) => r.networkId === "alice").shield > 0,
  );
  report.push(
    "Second race: channels/listeners cleaned up, Kart roster contains both humans, remote shield activation arrives without duplicate execution.",
  );
  const stats = await b.evaluate(() => {
    const g = __racer,
      t = g.multiplayerRace.transport;
    return {
      received: t.received,
      invalid: g.multiplayerRace.invalidPackets,
      objects: g.multiplayerRace.remotePlayers.size,
      geometries: g.renderer.info.memory.geometries,
    };
  });
  assert.equal(stats.invalid, 0);
  report.push(stats);
  await a.evaluate(() => __racer.leaveMultiplayer());
  await b.waitForFunction(
    () => __racer.multiplayerRace.remotePlayers.size === 0,
  );
  assert.equal(
    await b.evaluate(() => __racer.multiplayerRace.nameTags.size),
    1,
  );
  await b.evaluate(() => __racer.leaveMultiplayer());
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { passed: true, checks: report, consoleErrors: errors },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(cache, "multiplayer-report.json"),
    JSON.stringify({ passed: true, checks: report, errors }, null, 2),
  );
} finally {
  await browser.close();
}
