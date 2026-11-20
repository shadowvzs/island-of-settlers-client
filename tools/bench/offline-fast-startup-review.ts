import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: offline-fast-startup-review.ts <original-save> <report>");
const bytes = await readFile(resolve(input)), hash = createHash("sha256").update(bytes).digest("hex");
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage(); page.setDefaultTimeout(60_000);
  const workers: string[] = []; page.on("worker", worker => workers.push(worker.url()));
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/fast-startup.html", route => route.fulfill({ body: "<body>Fast startup worker proof</body>", contentType: "text/html" }));
  await page.route("**/fast-startup-save.json", route => route.fulfill({ body: bytes.toString(), contentType: "application/json" }));
  await page.goto(`${url}fast-startup.html`);
  const result = await page.evaluate(async () => {
    const path = "/src/app/settlement/game-session-worker.ts";
    const worker = await import(/* @vite-ignore */ path);
    const source = await (await fetch("/fast-startup-save.json")).json(), before = JSON.stringify(source);
    const runs = [];
    try {
      for (const seconds of [180, 60]) {
        const now = source.savedAt + seconds * 1000, started = performance.now();
        // Deliberately omit replay flags: this is the actual normal default path, not a forced probe.
        const run = await worker.advanceOfflineGameInWorkerMeasured(source, now, () => {});
        const replayMs = performance.now() - started, stageAt = performance.now();
        const staged = await worker.stageGameSessionInWorker(run.save);
        const stageMs = performance.now() - stageAt;
        runs.push({ seconds, cold: seconds === 180, replayMs, stageMs, totalMs: replayMs + stageMs,
          workerMs: run.workerWallMs, cursorCorrect: run.save.savedAt === now,
          nativeIslandMetrics: run.metrics.length, calibrationSeconds: run.economy.map((entry: any) => entry.calibrationSeconds),
          economyEvents: run.economy.reduce((sum: number, entry: any) => sum + entry.events, 0),
          valid: true, actors: staged.settlement.actors.length, buildings: staged.settlement.buildings.length });
      }
      return { runs, sourceObjectUnchanged: before === JSON.stringify(source), workerAvailable: typeof Worker !== "undefined" };
    } finally { worker.disposeGameSessionWorker?.(); }
  });
  assert.deepEqual(errors, []); assert(result.workerAvailable); assert(result.sourceObjectUnchanged);
  assert(workers.length > 0, "Expected an actual module worker");
  for (const run of result.runs) {
    assert(run.cursorCorrect); assert.equal(run.nativeIslandMetrics, 0); assert.deepEqual(run.calibrationSeconds, [0]);
  }
  assert.equal(createHash("sha256").update(await readFile(resolve(input))).digest("hex"), hash);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify({ ...result, workers, sourceHash: hash, sourceFileUnchanged: true,
    withinFiveSeconds: result.runs.every(run => run.totalMs <= 5000), errors,
    scope: "Real Chrome module worker, first default request cold, original supplied save unchanged. Includes catch-up and final save/world validation; excludes renderer/assets/network/full UI boot. No native reference resume." }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await server.close(); }
