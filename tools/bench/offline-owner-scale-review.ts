import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { dirname, resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const input = resolve(process.argv[2] ?? "../resources/project-reviews/offline-owner-scale-2026-11-05/fixture.json");
const output = resolve(process.argv[3] ?? resolve(dirname(input), "browser-review.json"));
const bytes = await readFile(input), source = JSON.parse(bytes.toString());
const sourceHash = createHash("sha256").update(bytes).digest("hex"), hostLoad = loadavg();
await mkdir(dirname(output), { recursive: true });
const { server, url } = await startDevServer({ unlockAll: false, port: 5298 });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const context = await browser.newContext(), page = await context.newPage();
  const errors: string[] = [], workers: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("worker", worker => workers.push(worker.url()));
  page.setDefaultTimeout(120_000);
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/offline-scale-seed.html", route => route.fulfill({
    body: "<body>Legal coupled offline worker measurement</body>", contentType: "text/html" }));
  await page.goto(`${url}offline-scale-seed.html`);
  const worker = await page.evaluate(async source => {
    const path = "/src/app/settlement/game-session-worker.ts";
    const module = await import(/* @vite-ignore */ path) as typeof import("../../src/app/settlement/game-session-worker");
    const before = JSON.stringify(source), started = performance.now();
    let heartbeats = 0;
    const heartbeat = setInterval(() => heartbeats++, 10);
    try {
      // The normal default is deliberate: no diagnostic replay flags or native prefix.
      const result = await module.advanceOfflineGameInWorkerMeasured(source, source.savedAt + 86_400_000, () => {});
      const replayMs = performance.now() - started, stageAt = performance.now();
      const saves = [result.save, ...result.save.archipelago!.colonies.map(entry => entry.save!),
        ...result.save.archipelago!.adventures!.map(entry => entry.save!)];
      const stages = [];
      for (const save of saves) {
        const at = performance.now(), loaded = await module.stageGameSessionInWorker(save);
        stages.push({ ms: performance.now() - at, actors: loaded.settlement.actors.length,
          buildings: loaded.settlement.buildings.length });
      }
      const stageAllIslandsMs = performance.now() - stageAt;
      return { replayMs, workerMs: result.workerWallMs, stageAllIslandsMs,
        totalMs: replayMs + stageAllIslandsMs, within30Seconds: replayMs + stageAllIslandsMs <= 30_000,
        nativeIslandMetrics: result.metrics.length, calibration: result.economy!.map(entry => entry.calibrationSeconds),
        economyEvents: result.economy!.reduce((sum, entry) => sum + entry.events, 0),
        production: result.economy!.flatMap(entry => entry.production), stages, heartbeats,
        sourceObjectUnchanged: before === JSON.stringify(source), cursorCorrect: result.save.savedAt === source.savedAt + 86_400_000 };
    } finally { clearInterval(heartbeat); }
  }, source);
  assert(worker.sourceObjectUnchanged && worker.cursorCorrect && worker.heartbeats > 0);
  assert.equal(worker.nativeIslandMetrics, 0); assert.deepEqual(worker.calibration, [0]);
  assert(workers.some(path => path.includes("game-session-worker.ts")));
  await context.close();

  // Independent browser storage/asset cache: measure the actual local startup path to interactive HUD.
  const uiContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await uiContext.addInitScript(() => {
    (window as unknown as { __name: (value: unknown) => unknown }).__name = value => value;
    const now = Number(sessionStorage.getItem("offline-scale-now"));
    if (now) Date.now = () => now;
    localStorage.setItem("island-of-settlers.graphics.detail", "minimal");
    localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
  });
  const uiPage = await uiContext.newPage(); uiPage.setDefaultTimeout(120_000);
  uiPage.on("pageerror", error => errors.push(error.message));
  await uiPage.routeWebSocket("**/*", () => {});
  await uiPage.route("**/offline-scale-seed.html", route => route.fulfill({
    body: "<body>Preparing real offline startup</body>", contentType: "text/html" }));
  await uiPage.goto(`${url}offline-scale-seed.html`);
  await uiPage.evaluate(async save => {
    const path = "/src/app/save-store/local-save-store.ts";
    const module = await import(/* @vite-ignore */ path) as typeof import("../../src/app/save-store/local-save-store");
    sessionStorage.setItem("offline-scale-now", String(save.savedAt + 86_400_000));
    await (await module.openLocalSaveStore()).writeStartupGame(JSON.stringify(save));
  }, source);
  const started = performance.now();
  await uiPage.goto(`${url}?quality=minimal&cache=0&skipLogin=1&profile=1&unlockall=0`);
  await uiPage.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
  await uiPage.locator("#loading-screen").waitFor({ state: "detached" });
  await uiPage.getByRole("button", { name: "Build", exact: true }).click();
  await uiPage.getByRole("heading", { name: "Build your settlement", exact: true }).waitFor();
  const interactiveMs = performance.now() - started;
  await uiPage.keyboard.press("Escape");
  const ui = await uiPage.evaluate(() => {
    const app = (window as unknown as { __settlement: { simulation: {
      saveState: () => { buildings: unknown[]; actors: unknown[]; gameTick: number; world: { seed: number } };
      gameNow: () => number;
    } } }).__settlement;
    const state = app.simulation.saveState();
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return { ready: true, interactiveBuildPanel: true, gameNow: app.simulation.gameNow(),
      seed: state.world.seed, buildings: state.buildings.length, actors: state.actors.length,
      gameTick: state.gameTick, stages: window.__loadProfile,
      gpu: info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown" };
  });
  assert.equal(ui.seed, source.settlement.world.seed);
  assert.equal(ui.buildings, source.settlement.buildings.length);
  assert.equal(ui.gameNow >= source.savedAt + 86_400_000, true);
  await uiPage.screenshot({ path: resolve(dirname(output), "minimal-ready.png") });
  assert.deepEqual(errors, []);
  const report = { generatedAt: new Date().toISOString(), source: input, sourceHash,
    host: { startLoad: hostLoad, endLoad: loadavg() }, workers, worker,
    ui: { ...ui, interactiveMs, within30Seconds: interactiveMs <= 30_000,
      scope: "Actual Minimal local startup, first navigation-to-ready plus working Build panel. Fresh browser context; Vite/source modules warmed by separate worker proof. Includes restore/UI/renderer/assets; excludes browser/server launch and network/account login." }, errors,
    scope: "One legal supported five-island group, not five heavy owner saves or target-phone acceptance. Real Chrome module worker, zero automatic native prefix; no exact reference replay." };
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, worker: { totalMs: worker.totalMs, events: worker.economyEvents },
    ui: { interactiveMs, within30Seconds: interactiveMs <= 30_000, gpu: ui.gpu } }));
} finally {
  await browser?.close();
  await server.close();
  console.log("Offline scale browser and Vite server FULLY closed");
}
