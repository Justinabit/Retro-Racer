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
const url = process.env.TEST_URL || "http://localhost:5173";
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
function observe(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
}
observe(page);
await page.addInitScript(() => {
  localStorage.setItem("pixel-racer-username", "TestDriver");
  if (!localStorage.getItem("pixel-racer-save"))
    localStorage.setItem(
      "pixel-racer-save",
      JSON.stringify({
        version: 1,
        settings: { graphics: "low", music: false, sfx: false },
      }),
    );
});
const state = async (expected) =>
  page.waitForFunction((s) => window.__racer?.state === s, expected);
const click = async (action, value) =>
  page
    .locator(
      `[data-action="${action}"]${value ? `[data-value="${value}"]` : ""}`,
    )
    .first()
    .click();
function driveRace(options) {
  const g = __racer;
  let controls = {};
  Object.defineProperty(g.input, "controls", {
    get: () => controls,
    configurable: true,
  });
  let steps = 0;
  const seen = new Set();
  while (g.state === "RACING" && steps++ < 22000) {
    const p = g.player,
      t = g.track,
      s = t.nearest(p.position).s;
    const look = t.at(s + (10 + Math.abs(p.speed) * 0.42) / t.length);
    const angle = Math.atan2(look.p.x - p.position.x, look.p.z - p.position.z);
    const error = Math.atan2(Math.sin(angle - p.yaw), Math.cos(angle - p.yaw));
    const dot = t.at(s).dir.dot(t.at(s + 30 / t.length).dir);
    const bend = Math.acos(Math.max(-1, Math.min(1, dot)));
    const target = options.speed / (1 + bend * 2.4);
    controls = {
      throttle: p.speed < target ? 1 : 0,
      brake: p.speed > target + 4 ? 1 : 0,
      steer: Math.max(-1, Math.min(1, error * 3)),
      drift: false,
      boost: options.boost && bend < 0.15,
    };
    g.step(1 / 60);
    seen.add(g.progress.lap);
  }
  delete g.input.controls;
  return {
    state: g.state,
    laps: [...seen],
    result: g.result,
    finishes: g.store.data.finishes,
    records: g.store.data.records.length,
  };
}

try {
  await page.goto(url);
  await state("MENU");
  assert.equal(await page.title(), "Pixel Racer 3D — Retro Arcade Racing");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(cache, "menu.png") });
  await page.setViewportSize({ width: 1024, height: 768 });
  await click("start");
  await state("GARAGE");
  for (const id of ["gt", "demon", "drift", "muscle", "rally", "hyper"]) {
    await click("car", id);
    assert.equal(await page.evaluate(() => __racer.car.spec.id), id);
    if (id !== "gt")
      assert.equal(
        await page.locator('[data-action="equip"]').isDisabled(),
        true,
      );
  }
  await click("car", "gt");
  await click("paint", "#91aea2");
  await page.locator('[data-custom="wheels"]').selectOption("#242b2c");
  await page.locator('[data-custom="number"]').fill("42");
  await page.locator('[data-custom="number"]').press("Tab");
  await page.locator('[data-custom="decal"]').uncheck();
  await page.locator('[data-custom="spoiler"]').uncheck();
  await click("lights");
  await click("brakelights");
  assert.equal(await page.evaluate(() => __racer.car.spoiler.visible), false);
  assert.equal(await page.evaluate(() => __racer.car.stripes.visible), false);
  assert.equal(
    await page.evaluate(() => __racer.store.data.custom.gt.number),
    42,
  );
  const angle = await page.evaluate(() => __racer.garageAngle);
  await page.mouse.move(420, 420);
  await page.mouse.down();
  await page.mouse.move(510, 440, { steps: 3 });
  await page.mouse.up();
  assert.notEqual(await page.evaluate(() => __racer.garageAngle), angle);
  await page.mouse.wheel(0, 150);
  assert.ok(await page.evaluate(() => __racer.garageZoom > 13));
  report.push(
    "All six 3D car previews; paint, wheels, numbers, stripes, spoiler, lights, rotation and zoom.",
  );
  await click("equip");
  await state("TRACK_SELECT");
  for (const id of ["coast", "city", "desert", "forest", "circuit"]) {
    await click("track", id);
    await state("TRACK_SELECT");
    assert.equal(await page.evaluate(() => __racer.track.data.id), id);
  }
  await click("track", "coast");
  await state("TRACK_SELECT");
  await page.locator("#difficulty").selectOption("easy");
  await click("race");
  await state("COUNTDOWN");
  const grid = await page.evaluate(() => __racer.player.position.toArray());
  await page.keyboard.down("w");
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() => __racer.player.position.toArray()),
    grid,
  );
  await page.evaluate(() => (__racer.countdown = 0.41));
  await state("RACING");
  await page.evaluate(() => {
    for (let i = 0; i < 60; i++) __racer.step(1 / 60);
  });
  assert.ok(await page.evaluate(() => __racer.player.speed > 15));
  await page.keyboard.down("Space");
  await page.keyboard.down("d");
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) __racer.step(1 / 60);
  });
  assert.ok(await page.evaluate(() => __racer.player.driftScore > 0));
  await page.keyboard.up("Space");
  await page.keyboard.up("d");
  await page.keyboard.down("Shift");
  await page.evaluate(() => {
    for (let i = 0; i < 15; i++) __racer.step(1 / 60);
  });
  assert.ok(await page.evaluate(() => __racer.player.nitro < 1));
  await page.keyboard.up("Shift");
  await page.keyboard.up("w");
  const impact = await page.evaluate(() => {
    const g = __racer,
      rival = g.ai[0];
    const update = rival.update,
      tone = g.audio.tone;
    const sounds = [];
    rival.update = () => {};
    g.audio.tone = (...args) => {
      sounds.push(args[0]);
      tone.apply(g.audio, args);
    };
    g.collisionCooldown = 0;
    rival.car.group.position.copy(g.player.position);
    try {
      g.step(1 / 60);
      return {
        sound: sounds.includes(65),
        impact: g.player.collision,
        speed: g.player.speed,
      };
    } finally {
      rival.update = update;
      g.audio.tone = tone;
    }
  });
  assert.ok(impact.sound && impact.impact > 0 && Number.isFinite(impact.speed));
  await page.keyboard.press("p");
  await state("PAUSED");
  const frozen = await page.evaluate(() => [
    __racer.raceTime,
    __racer.ai[0].s,
    ...__racer.player.position.toArray(),
  ]);
  await page.waitForTimeout(200);
  assert.deepEqual(
    await page.evaluate(() => [
      __racer.raceTime,
      __racer.ai[0].s,
      ...__racer.player.position.toArray(),
    ]),
    frozen,
  );
  await click("settings");
  await state("SETTINGS");
  // Re-entering the active Settings tab must preserve the paused return state.
  await click("settings");
  await page.locator('[data-setting="crt"]').check();
  await page.locator('[data-setting="shake"]').uncheck();
  await page.locator('[data-setting="particles"]').uncheck();
  await page.locator('[data-setting="motion"]').uncheck();
  await page.locator("#player-name").fill("TEST DRIVER");
  await page.locator("#player-name").press("Tab");
  await click("back");
  await state("PAUSED");
  assert.deepEqual(
    await page.evaluate(() => [
      __racer.raceTime,
      __racer.ai[0].s,
      ...__racer.player.position.toArray(),
    ]),
    frozen,
  );
  await click("resume");
  await state("RACING");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("r");
    await state("COUNTDOWN");
    assert.equal(await page.evaluate(() => __racer.raceTime), 0);
  }
  report.push(
    "Countdown locks; keyboard gas, drift and nitro; rival collision response and sound; complete pause including repeated settings navigation; three restarts.",
  );
  await page.evaluate(() => {
    __racer.countdown = 0.41;
  });
  await state("RACING");
  // Fast-forward simulation, NOT positions/checkpoints: the driving controller
  // steers the same player physics used by keyboard and touch input.
  const finish = await page.evaluate(driveRace, { speed: 64, boost: true });
  assert.equal(finish.state, "RESULTS");
  assert.equal(finish.result.position, 1);
  assert.equal(finish.finishes, 1);
  assert.equal(finish.records, 1);
  assert.deepEqual(finish.laps, [0, 1, 2, 3]);
  assert.ok(finish.result.unlocks.includes("Speed Demon"));
  assert.ok(finish.result.unlocks.includes("Desert Rush"));
  await page.screenshot({ path: path.join(cache, "results.png") });
  await click("records");
  await state("RECORDS");
  assert.ok(await page.getByText("TEST DRIVER", { exact: false }).count());
  await page.reload();
  await state("MENU");
  assert.equal(await page.evaluate(() => __racer.store.data.finishes), 1);
  assert.equal(
    await page.evaluate(() => __racer.store.data.custom.gt.number),
    42,
  );
  await click("garage");
  await state("GARAGE");
  await click("car", "demon");
  assert.equal(await page.locator('[data-action="equip"]').isDisabled(), false);
  await click("equip");
  await state("MENU");
  assert.equal(await page.evaluate(() => __racer.store.data.car), "demon");
  report.push(
    `Complete physics-driven three-lap race → position ${finish.result.position} → results → saved record → two unlocks → refresh → equip unlocked car.`,
  );
  // Explicitly exercise all render quality settings and persisted switches.
  await click("settings");
  await state("SETTINGS");
  for (const quality of ["medium", "high", "low"])
    await page.locator('[data-setting="graphics"]').selectOption(quality);
  for (const key of ["music", "sfx"]) {
    await page.locator(`[data-setting="${key}"]`).check();
    await page.locator(`[data-setting="${key}"]`).uncheck();
  }
  for (const key of ["master", "musicVolume", "sfxVolume"])
    await page.locator(`[data-setting="${key}"]`).fill("0.35");
  await click("back");
  await state("MENU");
  await click("how");
  await state("HOW_TO_PLAY");
  await click("back");
  await state("MENU");
  for (const [width, height] of [
    [1920, 1080],
    [1600, 900],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [430, 932],
    [390, 844],
    [375, 812],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Horizontal overflow at ${width}x${height}: ${await page.evaluate(() => document.documentElement.scrollWidth)}`,
    );
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await click("fullscreen");
  await page.waitForFunction(
    () =>
      document.fullscreenElement ||
      document.getElementById("toast").classList.contains("visible"),
  );
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  report.push(
    "Graphics, audio and effect switches; help; fullscreen; all requested viewport sizes without horizontal overflow.",
  );
  // A second complete race verifies the non-winning finish and next-track flow.
  await page.evaluate(() => {
    __racer.store.data.difficulty = "expert";
    __racer.startRace();
  });
  await state("COUNTDOWN");
  await page.evaluate(() => {
    __racer.countdown = 0.41;
  });
  await state("RACING");
  const loss = await page.evaluate(driveRace, { speed: 38, boost: false });
  assert.equal(loss.state, "RESULTS");
  assert.equal(loss.result.position, 8);
  assert.equal(loss.records, 2);
  await click("next");
  await state("TRACK_SELECT");
  assert.equal(await page.evaluate(() => __racer.previewTrack.id), "city");
  await click("race");
  await state("COUNTDOWN");
  await page.evaluate(() => {
    __racer.countdown = 0.41;
  });
  await state("RACING");
  const recovered = await page.evaluate(() => {
    const g = __racer,
      rival = g.ai[0];
    rival.car.group.position.set(10000, 10000, 10000);
    rival.speed = 0;
    for (let i = 0; i < 120; i++) g.step(1 / 60);
    return {
      speed: rival.speed,
      distance: g.track.nearest(rival.car.group.position).distance,
    };
  });
  assert.ok(recovered.speed > 0 && recovered.distance < 8);
  await click("pause");
  await state("PAUSED");
  await click("menu");
  await state("MENU");
  report.push(
    "Complete last-place race, second saved record, Next Race into Neon City, displaced/stopped AI recovery and quit-to-menu.",
  );
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const touch = await mobile.newPage();
  touch.setDefaultTimeout(60000);
  observe(touch);
  await touch.addInitScript(() =>
    localStorage.setItem(
      "pixel-racer-save",
      JSON.stringify({
        version: 1,
        settings: { graphics: "low", music: false, sfx: false },
      }),
    ),
  );
  await touch.goto(url);
  await touch.waitForFunction(() => window.__racer?.state === "MENU");
  await touch.locator('[data-action="start"]').tap();
  await touch.locator('[data-action="equip"]').tap();
  await touch.waitForFunction(() => __racer.state === "TRACK_SELECT");
  await touch.locator('[data-action="race"]').tap();
  await touch.waitForFunction(() => __racer.state === "COUNTDOWN");
  await touch.evaluate(() => (__racer.countdown = 0.41));
  await touch.waitForFunction(() => __racer.state === "RACING");
  const gas = await touch.locator('[data-control="gas"]').boundingBox(),
    left = await touch.locator('[data-control="left"]').boundingBox();
  const session = await mobile.newCDPSession(touch);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: gas.x + gas.width / 2, y: gas.y + gas.height / 2, id: 1 },
      { x: left.x + left.width / 2, y: left.y + left.height / 2, id: 2 },
    ],
  });
  assert.deepEqual(
    await touch.evaluate(() => [...__racer.input.touch].sort()),
    ["gas", "left"],
  );
  await touch.evaluate(() => {
    for (let i = 0; i < 40; i++) __racer.step(1 / 60);
  });
  assert.ok(await touch.evaluate(() => __racer.player.speed > 0));
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal(await touch.evaluate(() => __racer.input.touch.size), 0);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: gas.x + 20, y: gas.y + 20, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  assert.equal(await touch.evaluate(() => __racer.input.touch.size), 0);
  await touch.locator('[data-action="pause"]').tap();
  await touch.waitForFunction(() => __racer.state === "PAUSED");
  await touch.setViewportSize({ width: 844, height: 390 });
  await touch.locator('[data-action="resume"]').tap();
  assert.equal(await touch.locator('[data-control="gas"]').isVisible(), true);
  await touch.screenshot({ path: path.join(cache, "mobile-landscape.png") });
  report.push(
    "Real multi-touch gas + steering, touchend, touchcancel, mobile pause/resume, portrait and landscape controls.",
  );
  assert.deepEqual(errors, [], "Browser console and runtime errors");
  console.log(
    JSON.stringify(
      { passed: true, checks: report, consoleErrors: errors },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(cache, "report.json"),
    JSON.stringify(
      { passed: true, checks: report, consoleErrors: errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
