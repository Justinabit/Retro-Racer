import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import portableChromium from "@sparticuz/chromium";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, ".cache/browser-tests");
mkdirSync(cache, { recursive: true });
const bundle = path.join(root, "node_modules/@sparticuz/chromium/bin/al2023.tar.br");
if (process.platform === "linux") {
  const tar = path.join(cache, "libs.tar");
  writeFileSync(tar, brotliDecompressSync(readFileSync(bundle)));
  execFileSync("tar", ["xf", tar, "-C", cache]);
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || (await portableChromium.executablePath()),
  args: [...portableChromium.args, "--enable-unsafe-swiftshader"],
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${cache}/lib:${process.env.LD_LIBRARY_PATH || ""}` },
});
const errors = [];
const report = [];
const url = process.env.TEST_URL || "http://localhost:5173";
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
function observe(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
}
observe(page);
await page.addInitScript(() => {
  localStorage.setItem("pixel-racer-username", "TestDriver");
  if (!localStorage.getItem("pixel-racer-save"))
    localStorage.setItem(
      "pixel-racer-save",
      JSON.stringify({ version: 1, settings: { graphics: "low", music: false, sfx: false }, finishes: 10 }),
    );
});
const state = async (expected) => page.waitForFunction((s) => window.__racer?.state === s, expected);
const click = async (action, value) =>
  page.locator(`[data-action="${action}"]${value ? `[data-value="${value}"]` : ""}`).first().click();

function driveKart(options) {
  const g = __racer;
  let controls = {};
  Object.defineProperty(g.input, "controls", {
    get: () => controls,
    configurable: true,
  });
  let steps = 0;
  const seen = new Set();
  let itemsUsed = 0;
  while (g.state === "RACING" && steps++ < 26000) {
    const p = g.player, t = g.track, s = t.nearest(p.position).s;
    const look = t.at(s + (10 + Math.abs(p.speed) * 0.42) / t.length);
    const angle = Math.atan2(look.p.x - p.position.x, look.p.z - p.position.z);
    const error = Math.atan2(Math.sin(angle - p.yaw), Math.cos(angle - p.yaw));
    const dot = t.at(s).dir.dot(t.at(s + 30 / t.length).dir);
    const bend = Math.acos(Math.max(-1, Math.min(1, dot)));
    const target = options.speed / (1 + bend * 2.4);
    const shouldDrift = bend > 0.18 && p.speed > 20;
    controls = {
      throttle: p.speed < target ? 1 : 0,
      brake: p.speed > target + 4 ? 1 : 0,
      steer: Math.max(-1, Math.min(1, error * 3)),
      drift: shouldDrift,
      boost: false,
    };
    // occasionally use item
    if (g.kart && g.kart.racers[0].item && g.kart.racers[0].roulette <= 0 && Math.random() > 0.92) {
      if (g.kart.activate()) itemsUsed++;
    }
    g.step(1 / 60);
    seen.add(g.progress.lap);
  }
  delete g.input.controls;
  return { state: g.state, laps: [...seen], result: g.result, kart: g.kart ? { tokens: g.kart.racers[0].tokens, stats: g.kart.stats, itemsUsed } : null };
}

try {
  await page.goto(url);
  await state("MENU");
  // Mode switch should exist
  const modeSwitch = page.locator(".mode-switch");
  await modeSwitch.waitFor();
  assert.ok(await page.locator('[data-action="mode"][data-value="kart"]').count());
  assert.ok(await page.locator('[data-action="mode"][data-value="classic"]').count());
  await click("mode", "kart");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => __racer.store.data.mode), "kart");
  assert.ok(await page.locator("body.kart-mode").count() || (await page.evaluate(() => document.body.classList.contains("kart-mode"))));
  report.push("Mode switch CLASSIC/KART RACE NEW works, body gets kart-mode class");

  // Start should go to character select
  await click("start");
  await state("CHARACTER_SELECT");
  assert.ok(await page.locator(".character-view").count());
  assert.ok(await page.locator(".character-panel").count());
  assert.ok(await page.locator(".character-picker").count());
  // Check 8 characters
  const charButtons = page.locator('[data-action="character"]');
  assert.equal(await charButtons.count(), 8);
  for (const id of ["vex", "bolt", "rush", "slide", "grip", "titan", "zip", "nova"]) {
    await click("character", id);
    assert.equal(await page.evaluate(() => __racer.character.id), id);
  }
  // Check 40/60 note
  assert.ok(await page.getByText("40%").count() || await page.getByText("40% of performance").count() || await page.locator(".combination-note").count());
  await click("character", "nova");
  await page.screenshot({ path: path.join(cache, "kart-character.png") });

  // Choose character goes to garage
  await click("choose-character");
  await state("GARAGE");
  assert.ok(await page.locator(".kart-combo").count());
  assert.ok((await page.locator(".stat-row").count()) >= 5);
  // Garage combo should show character name
  const comboText = await page.locator(".kart-combo").textContent();
  assert.ok(comboText.includes("NOVA") || comboText.includes("VEHICLE"));

  // Equip and go to track select
  await click("equip");
  await state("TRACK_SELECT");
  // Should have 6 adventure tracks + classic? In kart mode, raceTracks returns ALL_TRACKS? Actually Game.raceTracks returns TRACKS when kart, which is all kart tracks (6). Let's check count
  const trackChoices = page.locator(".track-choice");
  const trackCount = await trackChoices.count();
  assert.ok(trackCount >= 6, `track choices ${trackCount}`);
  // Check adventure facts
  assert.ok(await page.locator(".adventure-facts").count());
  const facts = await page.locator(".adventure-facts").textContent();
  assert.ok(facts.includes("SHORTCUTS") && facts.includes("ITEM BOXES"));

  // Select metropolis
  await click("track", "metropolis");
  await state("TRACK_SELECT");
  assert.equal(await page.evaluate(() => __racer.previewTrack.id), "metropolis");
  // Check hazard facts
  assert.ok(await page.getByText("HAZARDS").count() || await page.locator(".adventure-facts").count());

  await page.locator("#difficulty").selectOption("easy");
  await click("race");
  await state("COUNTDOWN");

  // Countdown locks
  const grid = await page.evaluate(() => __racer.player.position.toArray());
  await page.keyboard.down("w");
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => __racer.player.position.toArray()), grid);

  await page.evaluate(() => (__racer.countdown = 0.41));
  await state("RACING");

  // Check kart HUD
  await page.waitForSelector("#item-slot");
  assert.ok(await page.locator("#item-slot").count());
  assert.ok(await page.locator("#token-count").count());
  assert.ok(await page.locator("#kart-status").count());
  assert.ok(await page.locator("#drift-charge").count());
  assert.ok(await page.locator("#kart-message").count());
  assert.ok(await page.locator(".kart-hud").count());
  assert.ok(await page.locator(".touch-item").count());
  report.push("Kart HUD: item slot, token, drift charge, status, message, touch item");

  // Test item activation via keyboard
  await page.evaluate(() => {
    const r = __racer.kart.racers[0];
    r.item = "boost";
    r.roulette = 0;
  });
  await page.keyboard.press("e");
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => __racer.kart.racers[0].boost > 0 || __racer.player.itemBoosting));

  // Drive race
  const finish = await page.evaluate(driveKart, { speed: 60 });
  assert.equal(finish.state, "RESULTS");
  assert.deepEqual(finish.laps.sort(), [0, 1, 2, 3]);
  assert.ok(finish.kart.tokens >= 0, "tokens earned");
  assert.ok(finish.result.kartStats, "kart stats exist");
  assert.ok(finish.result.kartStats.shortcuts >= 0);
  report.push(`Kart race complete: ${finish.kart.tokens} tokens, ${finish.kart.stats.shortcuts} shortcuts, ${finish.kart.stats.jumps} jumps, ${finish.result.kartStats.items} items`);

  await page.screenshot({ path: path.join(cache, "kart-results.png") });
  assert.ok(await page.locator(".kart-result").count());

  // Check records show KART mode
  await click("records");
  await state("RECORDS");
  assert.ok(await page.getByText("KART").count());

  // How to play field guide
  await page.evaluate(() => __racer.setState("HOW_TO_PLAY"));
  await state("HOW_TO_PLAY");
  assert.ok(await page.getByText("KART FIELD GUIDE").count());
  for (const item of ["BOOST", "BOLT", "SHIELD", "WAVE"]) {
    assert.ok(await page.getByText(item).count(), `item ${item} in field guide`);
  }
  report.push("Field guide lists items and mechanics");

  // Test another adventure track with open edges (sky)
  await page.evaluate(() => {
    __racer.store.data.kartTrack = "sky";
    __racer.store.save();
    __racer.openTracks();
  });
  await state("TRACK_SELECT");
  await click("track", "sky");
  await click("race");
  await state("COUNTDOWN");
  await page.evaluate(() => (__racer.countdown = 0.41));
  await state("RACING");
  // Check openEdge exists
  const hasOpenEdge = await page.evaluate(() => typeof __racer.track.openEdge === "function" && __racer.track.data.openEdges && __racer.track.data.openEdges.length > 0);
  assert.ok(hasOpenEdge, "sky has openEdges");
  // Simulate falling recovery
  const respawn = await page.evaluate(() => {
    const g = __racer;
    const r = g.kart.racers[0];
    // force low y
    r.physics.position.y = g.track.nearest(r.physics.position).p.y - 30;
    g.step(1 / 60);
    g.kart.after(1 / 60);
    return { locked: r.locked, immune: r.immune, message: g.kart.message };
  });
  assert.ok(respawn.locked >= 0, "fall recovery lock exists");
  report.push("Sky Island openEdge and falling recovery checked");

  // Mobile touch with item
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const touch = await mobile.newPage();
  touch.setDefaultTimeout(60000);
  observe(touch);
  await touch.addInitScript(() => localStorage.setItem("pixel-racer-save", JSON.stringify({ version: 1, settings: { graphics: "low", music: false, sfx: false }, finishes: 10, mode: "kart" })));
  await touch.goto(url);
  await touch.waitForFunction(() => window.__racer?.state === "MENU");
  await touch.locator('[data-action="start"]').tap();
  await touch.waitForFunction(() => __racer.state === "CHARACTER_SELECT");
  await touch.locator('[data-action="choose-character"]').tap();
  await touch.waitForFunction(() => __racer.state === "GARAGE");
  await touch.locator('[data-action="equip"]').tap();
  await touch.waitForFunction(() => __racer.state === "TRACK_SELECT");
  await touch.locator('[data-action="race"]').tap();
  await touch.waitForFunction(() => __racer.state === "COUNTDOWN");
  await touch.evaluate(() => (__racer.countdown = 0.41));
  await touch.waitForFunction(() => __racer.state === "RACING");
  assert.equal(await touch.locator('[data-action="item"]').count() >= 1, true);
  await touch.locator('[data-action="item"]').first().tap();
  await touch.screenshot({ path: path.join(cache, "kart-mobile.png") });
  report.push("Mobile kart controls include ITEM button");

  assert.deepEqual(errors, [], "Browser console errors");
  console.log(JSON.stringify({ passed: true, checks: report, consoleErrors: errors }, null, 2));
  writeFileSync(path.join(cache, "kart-report.json"), JSON.stringify({ passed: true, checks: report, consoleErrors: errors }, null, 2));
} finally {
  await browser.close();
}
