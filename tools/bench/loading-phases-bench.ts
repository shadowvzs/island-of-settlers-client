import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { preview } from "vite";

import { launchBrowser } from "./browser";
import { resourcesPath } from "./resources-path";
import { confirmImport, openMenuAction } from "./save-helpers";

/**
 * Loading phases bench (docs/archive/dated/loading-performance-2026-10-13.md): serves the production build
 * (`npx vite build` first) and times every load stage (window.__loadProfile) of
 *   - a new game's home island, the owner's saved home island (OWNER_SAVE),
 *   - a first colony visit and a first adventure visit (debug expeditions),
 * cold (fresh browser profile / island never generated) and warm (reload: HTTP cache and the
 * island cache filled), on High and Minimal. The startup slot is kept across reloads (an init
 * script ignores its delete) so a reload repeats the same island. Report: resources/loading-bench.
 * Env: QUALITIES=high,minimal  SCENARIOS=home,owner,colony,adventure  WARM_RUNS=2
 * REPORT=report (the report file name, so before/after runs sit side by side), DIST=dist (the
 * build folder served, so a copied baseline build can be measured while the code changes).
 */
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const scenarios = (process.env.SCENARIOS ?? "home,owner,colony,adventure").split(",");
const warmRuns = Number(process.env.WARM_RUNS ?? 2);
const ownerSave = process.env.OWNER_SAVE ?? "/home/shadowvzs/Downloads/island-settlers-2026-10-11.json";
const output = resourcesPath("loading-bench");
const reportFile = `${process.env.REPORT ?? "report"}.json`;
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;
const LOAD_TIMEOUT = 300_000;

const KEEP_STARTUP_SLOT = `(() => {
  const remove = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (key) {
    if (typeof key === "string" && key.endsWith("/startup")) return this.get(key);
    return remove.call(this, key);
  };
})();`;

interface StageRow { stage: string; "start ms": number; ms: number }
interface LoadSample {
  bytes: number;
  heapMB: number | null;
  idbMB: number | null;
  loadingScreenMs: number;
  readyMs: number;
  requests: number;
  urls?: string[];
  stages: StageRow[];
}

const startPreview = async () => {
  const server = await preview({
    build: { outDir: process.env.DIST ?? "dist" },
    logLevel: "error",
    preview: { port: 5299, strictPort: false }
  });
  return { close: () => server.close(), url: server.resolvedUrls!.local[0]! };
};

/** Bytes over the wire per load (CDP encoded lengths; 0 for HTTP-cache hits). */
const trackNetwork = async (session: CDPSession) => {
  const totals = { bytes: 0, requests: 0 };
  let urls = new Set<string>();
  await session.send("Network.enable");
  session.on("Network.requestWillBeSent", event => urls.add(event.request.url));
  session.on("Network.loadingFinished", (event) => {
    totals.bytes += event.encodedDataLength;
    totals.requests += 1;
  });
  return {
    take: () => {
      const taken = { ...totals, urls: [...urls] };
      urls = new Set();
      totals.bytes = 0;
      totals.requests = 0;
      return taken;
    }
  };
};

const waitReady = async (page: Page) => {
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: LOAD_TIMEOUT });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: LOAD_TIMEOUT });
  return page.evaluate(() => performance.now());
};

const collect = async (page: Page, loadingScreenMs: number, network: { bytes: number; requests: number }) => {
  const measured = await page.evaluate(async () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const estimate = await navigator.storage?.estimate?.();
    return {
      heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
      idbMB: estimate?.usage ? Math.round(estimate.usage / 1048576) : null,
      stages: (window.__loadProfile ?? []) as unknown as StageRow[]
    };
  });
  const ready = measured.stages.find(row => row.stage.startsWith("ready"));
  return { ...measured, ...network, loadingScreenMs: Math.round(loadingScreenMs),
    readyMs: ready?.ms ?? 0 } satisfies LoadSample;
};

/** One measured load: `navigate` triggers it (goto, reload or an in-game click). */
const measureLoad = async (page: Page, network: Awaited<ReturnType<typeof trackNetwork>>,
  navigate: () => Promise<unknown>) => {
  network.take();
  await Promise.all([page.waitForEvent("load", { timeout: LOAD_TIMEOUT }), navigate()]);
  const loadingScreenMs = await waitReady(page);
  await page.waitForTimeout(process.env.GC_AFTER_LOAD ? 5000 : 500);
  if (process.env.GC_AFTER_LOAD) {
    const session = await page.context().newCDPSession(page);
    await session.send("HeapProfiler.collectGarbage");
    await session.detach();
  }
  return collect(page, loadingScreenMs, network.take());
};

const warmLoads = async (page: Page, network: Awaited<ReturnType<typeof trackNetwork>>) => {
  const samples: LoadSample[] = [];
  for (let run = 0; run < warmRuns; run += 1)
    samples.push(await measureLoad(page, network, () => page.reload()));
  return samples;
};

/** Starts a debug expedition, lands it and returns the visit button. */
const landExpedition = async (page: Page, kind: "adventure" | "colony") => {
  const status = await page.evaluate(async (expedition) => {
    const simulation = (window as any).__settlement.simulation;
    const started = simulation.startDebugExpedition(expedition);
    if (!started.ok) return started.reason as string;
    for (let second = 0; second < 3000 && simulation.colonyExpeditions()[0]?.status !== "arrived"; second++) {
      simulation.update(1);
      // Let the actual frame loop start voyage warming while the simulated ships sail.
      if (second % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return simulation.colonyExpeditions()[0]?.status as string;
  }, kind);
  if (status !== "arrived") throw new Error(`${kind} expedition did not land: ${status}`);
  const visit = page.locator(`[data-${kind}-visit]`).first();
  await visit.waitFor({ state: "visible", timeout: 20_000 });
  if (process.env.PREGEN_WAIT) await page.waitForTimeout(Number(process.env.PREGEN_WAIT));
  return visit;
};

const importSave = async (page: Page, path: string) => {
  const importButton = await openMenuAction(page, "Import game");
  const choosing = page.waitForEvent("filechooser");
  await importButton.click();
  await (await choosing).setFiles(path);
  await confirmImport(page);
};

interface Scenario { cold: LoadSample; first?: LoadSample; warm: LoadSample[];
  voyage?: { bytes: number; requests: number; urls: string[] } }

const runScenario = async (context: BrowserContext, url: string, scenario: string): Promise<Scenario> => {
  const page = await context.newPage();
  page.on("pageerror", error => console.log(`[pageerror ${scenario}]`, error.message));
  await page.routeWebSocket("**/*", () => {});
  const network = await trackNetwork(await context.newCDPSession(page));
  const home = await measureLoad(page, network, () => page.goto(url));
  if (scenario === "home") return { cold: home, warm: await warmLoads(page, network) };
  let first: LoadSample;
  let voyage: Scenario["voyage"];
  if (scenario === "owner") {
    first = await measureLoad(page, network, () => importSave(page, ownerSave));
  } else {
    const visit = await landExpedition(page, scenario as "adventure" | "colony");
    // Voyage warming belongs to the voyage, not the first-visit transfer measurement.
    voyage = network.take();
    first = await measureLoad(page, network, () => visit.click());
  }
  return { cold: home, first, voyage, warm: await warmLoads(page, network) };
};

const gpuName = async (context: BrowserContext, url: string) => {
  const page = await context.newPage();
  await page.goto(`${url}?nothing=1`, { waitUntil: "domcontentloaded" });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  await page.close();
  return gpu;
};

const main = async () => {
  mkdirSync(output, { recursive: true });
  const server = await startPreview();
  const browser = await launchBrowser();
  const report: Record<string, unknown> = {};
  try {
    for (const quality of qualities) {
      for (const scenario of scenarios) {
        const context = await browser.newContext({ viewport: { height: 850, width: 1200 } });
        await context.addInitScript(KEEP_STARTUP_SLOT);
        const url = `${server.url}?quality=${quality}&cache=1&profile=1`;
        const gpu = await gpuName(context, server.url);
        if (SOFTWARE_GL.test(gpu)) throw new Error(`software WebGL (${gpu}): numbers would be meaningless`);
        console.log(`== ${quality} ${scenario} (${gpu})`);
        report[`${quality}/${scenario}`] = { gpu, ...(await runScenario(context, url, scenario)) };
        writeFileSync(resolve(output, reportFile), JSON.stringify(report, null, 2));
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`report: ${resolve(output, reportFile)}`);
};

await main();
