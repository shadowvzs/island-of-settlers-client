import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, relative, resolve } from "node:path";
import { build } from "esbuild";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { launchBrowser } from "./browser";

/** Real built files only: no Vite dev server, source-module routes or development globals. */
const [distArgument, outputArgument, ...inputs] = process.argv.slice(2);
if (!distArgument || !outputArgument || !inputs.length)
  throw new Error("Usage: offline-cold-production-review.ts <dist> <report> <save> [...]");
const dist = resolve(distArgument), output = resolve(outputArgument);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const workers = (await readdir(resolve(dist, "assets"))).filter(name => /^game-session-worker-[\w-]+\.js$/.test(name));
assert.equal(workers.length, 1, "Use one clean production build with one game-session worker");
const workerPath = `/assets/${workers[0]}`;
const workerHash = digest(await readFile(resolve(dist, `.${workerPath}`)));
const manifestHash = digest(await readFile(resolve(dist, ".vite/manifest.json")));
const schema = resolve("src/app/settlement/game-database-schema.ts");
const bootstrap = await build({ bundle: true, format: "iife", platform: "browser", write: false,
  stdin: { loader: "ts", resolveDir: process.cwd(), contents: `
    import { DATABASE, VERSION, upgradeGameDatabase } from ${JSON.stringify(schema)};
    globalThis.__offlineSeed = async save => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, VERSION);
        request.onupgradeneeded = event => upgradeGameDatabase(request.result, request.transaction, event.oldVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("boot", "readwrite");
        transaction.objectStore("boot").put(JSON.stringify(save), "guest/startup");
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    };` } });
const mime: Record<string, string> = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/offline-seed.html") {
    response.setHeader("Content-Type", "text/html"); response.end("<body>Preparing offline startup</body>"); return;
  }
  const file = resolve(dist, `.${path === "/" ? "/index.html" : path}`);
  if (relative(dist, file).startsWith("..")) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store"); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const reports: unknown[] = [];
try {
  for (const input of inputs) {
    const bytes = await readFile(resolve(input)), source = JSON.parse(bytes.toString()) as GameSaveV1;
    const now = source.savedAt + 86_400_000, errors: string[] = [], requested: string[] = [];
    const browser = await launchBrowser();
    let ui;
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => requested.push(new URL(request.url()).pathname));
      await page.addInitScript(now => {
        (window as unknown as { __name: (value: unknown) => unknown }).__name = value => value;
        Date.now = () => now;
        localStorage.setItem("island-of-settlers.graphics.detail", "minimal");
        localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
      }, now);
      await page.goto(`${origin}/offline-seed.html`);
      await page.addScriptTag({ content: bootstrap.outputFiles[0]!.text });
      await page.evaluate(save => (window as unknown as {
        __offlineSeed: (save: unknown) => Promise<void> }).__offlineSeed(save), source);
      const started = performance.now();
      await page.goto(`${origin}/?quality=minimal&cache=0&skipLogin=1&profile=1`);
      await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 120_000 });
      await page.locator(".settlement-ui__bar").waitFor({ state: "visible", timeout: 120_000 });
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await page.getByRole("heading", { name: "Build your settlement", exact: true }).waitFor();
      const interactiveMs = performance.now() - started;
      await page.keyboard.press("Escape");
      ui = await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("island-settlers-db");
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const rows = await new Promise<Array<{ id: string; save: GameSaveV1 }>>((resolve, reject) => {
          const request = database.transaction("islands").objectStore("islands").getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        database.close();
        const gl = document.createElement("canvas").getContext("webgl2"), info = gl?.getExtension("WEBGL_debug_renderer_info");
        return { ready: true, buildPanelUsable: true,
          gpu: info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown",
          measures: performance.getEntriesByType("measure").map(entry => ({ name: entry.name,
            startMs: entry.startTime, durationMs: entry.duration })),
          saved: rows.map(row => ({ id: row.id, savedAt: row.save.savedAt,
            world: row.save.settlement.world, buildings: row.save.settlement.buildings.length,
            actors: row.save.settlement.actors.length })) };
      });
      assert(ui.saved.length > 0, "Actual startup did not commit the caught-up save");
      assert(ui.saved.every(save => save.savedAt === now));
      assert.equal(ui.saved.find(save => save.id === "home")?.world.seed, source.settlement.world.seed);
      assert.equal(requested.some(path => path.startsWith("/src/") || path.startsWith("/@vite/")), false);
      await page.screenshot({ path: resolve(dirname(output), `cold-${reports.length}-ready.png`) });
      ui = { ...ui, interactiveMs, within30Seconds: interactiveMs <= 30_000 };
    } finally { await browser.close(); }
    // New browser process as well as a new worker: the production worker is independently cold.
    const workerBrowser = await launchBrowser();
    let worker;
    try {
      const page = await workerBrowser.newPage();
      await page.addInitScript("window.__name=value=>value;");
      await page.goto(`${origin}/offline-seed.html`);
      worker = await page.evaluate(async ({ now, source, workerPath }) => {
        const started = performance.now(), worker = new Worker(workerPath, { type: "module" });
        let id = 0, heartbeats = 0;
        const timer = setInterval(() => heartbeats++, 10);
        const send = (payload: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
          const requestId = id++;
          worker.onmessage = ({ data }) => {
            if (data.id !== requestId || "progress" in data) return;
            if (data.error) reject(new Error(data.error)); else resolve(data.value);
          };
          worker.onerror = () => reject(new Error("Production worker failed"));
          worker.postMessage({ ...payload, id: requestId });
        });
        try {
          const run = await send({ kind: "offline", value: source, now, metrics: true }) as
            import("../../src/app/settlement/game-session-worker").OfflineWorkerRun;
          const replayMs = performance.now() - started, stageAt = performance.now();
          const saves = [run.save, ...run.save.archipelago?.colonies.flatMap(row => row.save ? [row.save] : []) ?? [],
            ...run.save.archipelago?.adventures?.flatMap(row => row.save ? [row.save] : []) ?? []];
          for (const save of saves) await send({ kind: "load", value: save });
          const stageAllMs = performance.now() - stageAt;
          return { replayMs, stageAllMs, totalMs: replayMs + stageAllMs,
            within30Seconds: replayMs + stageAllMs <= 30_000, workerMs: run.workerWallMs,
            strictStages: saves.length, nativeMetrics: run.metrics.length,
            calibration: run.economy!.map(entry => entry.calibrationSeconds),
            events: run.economy!.reduce((sum, entry) => sum + entry.events, 0), heartbeats,
            cursorCorrect: run.save.savedAt === now };
        } finally { clearInterval(timer); worker.terminate(); }
      }, { now, source, workerPath });
      assert.equal(worker.nativeMetrics, 0); assert.deepEqual(worker.calibration, [0]);
      assert(worker.cursorCorrect && worker.heartbeats > 0);
    } finally { await workerBrowser.close(); }
    assert.deepEqual(errors, []); assert.equal(digest(await readFile(resolve(input))), digest(bytes));
    reports.push({ input: resolve(input), sha256: digest(bytes), ui, worker, errors,
      productionAssetsOnly: true, freshBrowserProcesses: true, inputUnchanged: true });
    await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), dist,
      manifestHash, workerPath, workerHash, reports,
      scope: "Actual cold production static preview: fresh Chrome processes for UI and matching built worker, no Vite/source modules. UI includes catch-up, persistence, renderer/assets, first frame and usable Build panel. Excludes browser/server launch, external network/account login; local RTX workstation only." }, null, 2));
    console.log(JSON.stringify(reports.at(-1)));
  }
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  console.log("All cold-production Chrome processes and static server FULLY closed");
}
