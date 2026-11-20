import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { launchBrowser, startDevServer } from "../bench/browser";
import { OFFLINE_REPLAY_MODES, type OfflineReplayMode, replayFlags } from "./offline-modes";

/**
 * Browser module-worker timing of the real offline catch-up (client `advanceOfflineGame` through
 * the shipped game-session worker). The fixture is the developed `continued-0.json`, replayed for
 * one hour by default. Reports wall time, game seconds, actual mode, fallback reason and the cost
 * of resuming 60 s on the caught-up save. `--seconds` is capped at 6 h by validation.
 *
 *   npx tsx tools/acceptance/offline-browser-worker.ts --mode measured
 *   npx tsx tools/acceptance/offline-browser-worker.ts --mode exact --seconds 21600 --memory
 *
 * `--memory` adds a coarse page-renderer JS heap sample (Chrome `performance.memory`, quantized; not
 * the worker isolate or RSS). Every report records host load at the start and end so a contended
 * run is not mistaken for an isolated budget.
 *
 * Not a phone or calibrated isolated benchmark: same workstation, dedicated page, real Chrome.
 */
const { values } = parseArgs({
  options: {
    memory: { default: false, type: "boolean" },
    mode: { default: "measured", type: "string" },
    out: { type: "string" },
    port: { default: "5299", type: "string" },
    seconds: { default: "3600", type: "string" }
  }
});
const mode = values.mode as OfflineReplayMode;
if (!OFFLINE_REPLAY_MODES.includes(mode))
  throw new Error(`Unknown mode ${mode}; use ${OFFLINE_REPLAY_MODES.join(", ")}`);
const seconds = Number(values.seconds), port = Number(values.port);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 6 * 3600)
  throw new Error("--seconds must be positive and at most 6 hours (bounded; no 24 h run)");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
  throw new Error("--port must be a valid port");

const client = resolve(import.meta.dirname, "../..");
const fixturePath = resolve(client, "public/demo/continued-0.json");
const defaultOutput = resolve(client, "../resources/offline-acceptance-current/browser-worker-1h.json");
const output = resolve(values.out ?? defaultOutput);
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
  map?: unknown;
  savedAt: number;
  settlement: { actors: unknown[]; buildings: unknown[] };
};

/** Host load at both ends: the timings are only meaningful next to the machine's contention. */
const hostSnapshot = () => ({
  cpuCount: cpus().length,
  freeMemoryBytes: freemem(),
  loadAverage: loadavg(),
  totalMemoryBytes: totalmem()
});
const hostStart = hostSnapshot();

const { server, url } = await startDevServer({ port, unlockAll: false });
const browser = await launchBrowser();
const pageErrors: string[] = [];
try {
  const context = await browser.newContext({ viewport: { height: 800, width: 1280 } });
  const page = await context.newPage();
  page.setDefaultTimeout(600_000);
  // Playwright/esbuild wraps named callbacks; the page must provide the helper (as the e2e session does).
  await page.addInitScript("window.__name = value => value;");
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/offline-harness.html", route => route.fulfill({
    body: "<!doctype html><html><body>offline acceptance harness</body></html>",
    contentType: "text/html"
  }));
  await page.goto(`${url}offline-harness.html`, { waitUntil: "domcontentloaded" });
  // Optional and deliberately coarse: Chrome's `performance.memory` is quantized and lives in the
  // page renderer, not in the game-session worker's isolate. It is a trend signal, not an RSS budget.
  const pageMemory = () => page.evaluate(() => {
    const memory = (performance as Performance & {
      memory?: { jsHeapSizeLimit: number; totalJSHeapSize: number; usedJSHeapSize: number };
    }).memory;
    return memory ? {
      jsHeapSizeLimitBytes: memory.jsHeapSizeLimit,
      totalJSHeapSizeBytes: memory.totalJSHeapSize,
      usedJSHeapSizeBytes: memory.usedJSHeapSize
    } : null;
  });
  const memoryBefore = values.memory ? await pageMemory() : null;
  const measured = await page.evaluate(async ({ fixtureUrl, flags, horizon }) => {
    interface Metrics {
      fallbackReason?: string;
      fixedTicks: number;
      gameSeconds: number;
      islandId: number | null;
      mode: string;
      requestedMode: string;
      skippedSeconds: number;
    }
    interface Run {
      economy?: { gameSeconds: number; calibrationSeconds: number; events: number }[];
      metrics: Metrics[];
      save: { savedAt: number };
      wallMs: number;
      workerWallMs: number;
    }
    const modulePath = "/src/app/settlement/game-session-worker.ts";
    const worker = await import(/* @vite-ignore */ modulePath) as {
      advanceOfflineGameInWorkerMeasured: (
        value: unknown, now: number, progress: (progress: unknown) => void, options: unknown
      ) => Promise<Run>;
    };
    const response = await fetch(fixtureUrl);
    if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
    const source = await response.json() as { savedAt: number };
    const savedAt = Date.now() - horizon * 1000;
    source.savedAt = savedAt;
    const now = savedAt + horizon * 1000;
    const catchUp = await worker.advanceOfflineGameInWorkerMeasured(source, now, () => {}, flags);
    const resume = await worker.advanceOfflineGameInWorkerMeasured(catchUp.save, catchUp.save.savedAt + 60_000,
      () => {}, flags);
    const summarize = (run: Run) => ({
      fallbackReasons: [...new Set(run.metrics.map(entry => entry.fallbackReason).filter(Boolean))],
      fixedTicks: run.metrics.reduce((sum, entry) => sum + entry.fixedTicks, 0),
      gameSeconds: run.economy?.length ? run.economy.reduce((sum, entry) => sum + entry.gameSeconds, 0)
        : run.metrics.reduce((sum, entry) => sum + entry.gameSeconds, 0),
      islands: run.metrics,
      modes: [...new Set([...run.metrics.map(entry => entry.mode), ...(run.economy?.length ? ["economy"] : [])])],
      requestedModes: run.economy?.length ? ["economy"] : [...new Set(run.metrics.map(entry => entry.requestedMode))],
      skippedSeconds: run.economy?.length ? run.economy.reduce((sum, entry) =>
        sum + entry.gameSeconds - entry.calibrationSeconds, 0)
        : run.metrics.reduce((sum, entry) => sum + entry.skippedSeconds, 0),
      ...(run.economy?.length ? { economy: run.economy } : {}),
      wallMs: run.wallMs,
      workerWallMs: run.workerWallMs
    });
    return { catchUp: summarize(catchUp), resume: summarize(resume),
      userAgent: navigator.userAgent, workerAvailable: typeof Worker !== "undefined" };
  }, { fixtureUrl: "/demo/continued-0.json", flags: replayFlags(mode), horizon: seconds });
  const memoryAfter = values.memory ? await pageMemory() : null;
  const workerUrls = page.workers().map(worker => worker.url());
  const memory = values.memory ? {
    after: memoryAfter,
    available: memoryBefore !== null && memoryAfter !== null,
    before: memoryBefore,
    deltaUsedBytes: memoryBefore && memoryAfter
      ? memoryAfter.usedJSHeapSizeBytes - memoryBefore.usedJSHeapSizeBytes : null,
    note: "Chrome window.performance.memory (quantized): page renderer JS heap only; " +
      "does not include the game-session worker isolate and is not process RSS.",
    workerUrls
  } : undefined;

  const report = {
    browser: { userAgent: measured.userAgent, workerAvailable: measured.workerAvailable },
    host: { end: hostSnapshot(), start: hostStart },
    fixture: {
      actors: fixture.settlement.actors.length,
      buildings: fixture.settlement.buildings.length,
      bytes: fixtureBytes.byteLength,
      mapPresent: Boolean(fixture.map),
      path: "island-of-settlers-client/public/demo/continued-0.json",
      sha256: createHash("sha256").update(fixtureBytes).digest("hex")
    },
    generatedAt: new Date().toISOString(),
    horizonSeconds: seconds,
    requestedMode: mode,
    ...measured,
    ...(memory ? { memory } : {}),
    scope: "Real Chrome module Web Worker running the real advanceOfflineGame on the developed fixture. " +
      "Dedicated page, same workstation; not a phone or calibrated isolated benchmark.",
    workers: workerUrls
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    catchUp: { fallback: report.catchUp.fallbackReasons, gameSeconds: report.catchUp.gameSeconds,
      modes: report.catchUp.modes, wallMs: Math.round(report.catchUp.wallMs),
      workerWallMs: Math.round(report.catchUp.workerWallMs) },
    hostLoad: { end: report.host.end.loadAverage, start: report.host.start.loadAverage },
    memory: values.memory ? { available: memory?.available, deltaUsedBytes: memory?.deltaUsedBytes } : "off",
    output,
    requestedMode: mode,
    resume: { gameSeconds: report.resume.gameSeconds, wallMs: Math.round(report.resume.wallMs) },
    worker: report.browser.workerAvailable,
    workerUrls
  }));
  if (!measured.workerAvailable) throw new Error("The harness did not run in a Web Worker environment");
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
} finally {
  await browser.close();
  await server.close();
}
