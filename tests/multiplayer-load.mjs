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
// Synthetic peers measure the actual renderer/snapshot pipeline at 2–8 cars.
// This does NOT claim to measure eight human devices or Supabase WAN throughput.
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem("pixel-racer-username", "LoadDriver");
  localStorage.setItem(
    "mock-supabase-user",
    JSON.stringify({ id: "load-local", isMock: true }),
  );
  localStorage.setItem(
    "pixel-racer-save",
    JSON.stringify({
      version: 1,
      settings: { graphics: "low", music: false, sfx: false },
    }),
  );
});
const report = [];
try {
  await page.goto(process.env.TEST_URL || "http://localhost:5173");
  await page.waitForFunction(() => __racer?.state === "MENU");
  for (let count = 2; count <= 8; count++) {
    await page.evaluate((count) => {
      const g = __racer;
      g.clearRace();
      g.state = "MULTIPLAYER_LOBBY";
      g.lobby = {
        id: "load-lobby",
        code: "123456",
        host_id: "load-local",
        mode: "classic",
        map_id: "coast",
        race_id: `load-${count}`,
        race_start_at: new Date(Date.now() - 1000).toISOString(),
      };
      g.lobbyPlayers = Array.from({ length: count }, (_, i) => ({
        player_id: i ? `load-${i}` : "load-local",
        selected_car: "gt",
        profiles: { username: `Load ${i}` },
      }));
      g.startMultiplayerRace();
    }, count);
    await page.waitForFunction(() => __racer.state === "RACING");
    const result = await page.evaluate(async (count) => {
      const g = __racer,
        race = g.multiplayerRace;
      const bus = new BroadcastChannel(`pixel-race:${race.raceId}`);
      let seq = 0;
      const publish = () => {
        const stamp = performance.now();
        for (let i = 1; i < count; i++) {
          const s = 0.04 + i * 0.006 + seq * 0.0004;
          const loc = g.track.at(s, i % 2 ? -3 : 3);
          const state = {
            type: "player_state",
            playerId: `load-${i}`,
            raceId: race.raceId,
            timestamp: stamp,
            sequence: seq,
            x: loc.p.x,
            y: loc.p.y,
            z: loc.p.z,
            yaw: loc.yaw,
            pitch: 0,
            roll: 0,
            vx: Math.sin(loc.yaw) * 20,
            vy: 0,
            vz: Math.cos(loc.yaw) * 20,
            speed: 20,
            steer: 0,
            accelerating: true,
            braking: false,
            drifting: false,
            boosting: false,
            lap: 0,
            checkpoint: 1,
            progress: s,
            finishTime: null,
          };
          bus.postMessage({ playerId: state.playerId, payload: state });
        }
        seq++;
      };
      const timer = setInterval(publish, 50);
      const times = [];
      let previous = performance.now();
      const start = previous;
      await new Promise((resolve) => {
        function measure(now) {
          times.push(now - previous);
          previous = now;
          if (now - start > 3000 && times.length >= 10) resolve();
          else requestAnimationFrame(measure);
        }
        requestAnimationFrame(measure);
      });
      clearInterval(timer);
      bus.close();
      times.shift();
      times.sort((a, b) => a - b);
      return {
        players: count,
        remoteObjects: race.remotePlayers.size,
        ai: g.ai.length,
        fps: +(
          1000 /
          (times.reduce((a, b) => a + b, 0) / times.length)
        ).toFixed(1),
        p95FrameMs: +times[Math.floor(times.length * 0.95)].toFixed(1),
        receivedPerSec: +(
          (race.transport.received * 1000) /
          (performance.now() - start)
        ).toFixed(1),
        invalidPackets: race.invalidPackets,
        geometries: g.renderer.info.memory.geometries,
        heapMB: performance.memory
          ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)
          : null,
        snapshotCounts: [...race.remotePlayers.values()].map(
          (r) => r.buffer.states.length,
        ),
      };
    }, count);
    assert.equal(result.remoteObjects, count - 1);
    assert.equal(result.ai, 0);
    assert.equal(result.invalidPackets, 0);
    assert.ok(result.snapshotCounts.every((n) => n > 0 && n <= 32));
    report.push(result);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        environment:
          "Headless Chromium / SwiftShader, 800x600 low graphics, synthetic BroadcastChannel peers (not WAN)",
        measurements: report,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(cache, "multiplayer-load.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
