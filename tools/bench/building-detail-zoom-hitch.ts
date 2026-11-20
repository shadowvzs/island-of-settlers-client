import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { launchBrowser, startDevServer } from "./browser";
import { installFrameProfiler, sampleHotFunctions, stageStartupSave } from "./frame-profile";

/**
 * R16a: frame cost of the building detail threshold (camera zoom 1.5). On the live owner save the
 * camera zoom alternates between ZOOM_LOW and ZOOM_HIGH (one crossing each way per cycle); every
 * frame records its rAF interval and the render loop's CPU stages. A control pass alternates two
 * zooms on the same side of the threshold. The save is only read.
 *
 *   OWNER_SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [CYCLES=8] [HOLD_MS=1500]
 *   [ZOOM_LOW=1.4] [ZOOM_HIGH=1.6] [CONTROL=1.6,1.8] [REPORT_TAG=before] [UNCAPPED=1]
 *   [PROFILE_ZOOMS=1.6,1.8] (the CPU-profiled pair; default: the crossing pair)
 *   [PROBES=__probeNoBuildingBatch,...] (diagnostic globals set to true before the page loads)
 *   [DETAIL_ZOOM=9] (diagnostic: moves the building detail threshold, so the same zooms cross nothing)
 *   [SWAP_ONLY=1] (the camera stays at ZOOM_HIGH; each "zoom" moves the threshold instead, so only the
 *   detail switch runs: no view change, vegetation or shadow refit. The control pass then changes nothing)
 *   npx tsx tools/bench/building-detail-zoom-hitch.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const cycles = Number(process.env.CYCLES ?? 8);
const holdMs = Number(process.env.HOLD_MS ?? 1500);
const crossing = [Number(process.env.ZOOM_LOW ?? 1.4), Number(process.env.ZOOM_HIGH ?? 1.6)] as const;
const control = (process.env.CONTROL ?? "1.6,1.8").split(",").map(Number) as [number, number];
const tag = process.env.REPORT_TAG ?? "run";
const swapOnly = process.env.SWAP_ONLY === "1";
const profiled = process.env.PROFILE_ZOOMS?.split(",").map(Number) ?? crossing;
mkdirSync(outputDir, { recursive: true });

/** Exposes the renderer and the building layer's scene to the page for memory accounting. */
const exposeRenderer = (source: string) => source.replace("const passNames",
  "window.__r16a = { renderer, buildings }; const passNames");
/**
 * Diagnostic threshold: DETAIL_ZOOM moves it (the same camera motion without a detail switch);
 * SWAP_ONLY reads it from `__r16aDetailZoom`, which the bench moves while the camera stays still.
 */
const patchDetailThreshold = async (page: Page, zoom: string) => page.route("**/buildings/building-detail.ts",
  async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("BUILDING_DETAIL_ZOOM = 1.5", `BUILDING_DETAIL_ZOOM = ${zoom}`)
      .replace("zoom >= BUILDING_DETAIL_ZOOM", "zoom >= (globalThis.__r16aDetailZoom ?? BUILDING_DETAIL_ZOOM)");
    await route.fulfill({ body, response });
  });
const exposeBuildingScene = async (page: Page) => page.route("**/buildings/three-buildings.ts", async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace("const scene = new Scene();",
    "const scene = new Scene(); window.__r16aBuildingScene = scene;");
  await route.fulfill({ body, response });
});

/** Records every rAF interval with the render loop's CPU stages of the frame just drawn. */
const startRecorder = (page: Page) => page.evaluate(() => {
  const root = window as any;
  root.__r16aSamples = [];
  root.__r16aMarks = [];
  let last = performance.now();
  const tick = (now: number) => {
    const timings = root.__ownerTimings ?? {};
    root.__r16aSamples.push({ buildings: timings.buildings ?? 0, cpu: timings.cpu ?? 0, dt: now - last,
      render: timings.render ?? 0 });
    last = now;
    if (root.__r16aRecording) requestAnimationFrame(tick);
  };
  root.__r16aRecording = true;
  requestAnimationFrame(tick);
});

const stopRecorder = (page: Page) => page.evaluate(() => {
  const root = window as any;
  root.__r16aRecording = false;
  return { marks: root.__r16aMarks as number[], samples: root.__r16aSamples as Sample[] };
});

type Sample = { buildings: number; cpu: number; dt: number; render: number };

const setZoom = (page: Page, zoom: number) => page.evaluate(({ only, value }) => {
  const root = window as any;
  if (only) root.__r16aDetailZoom = value >= 1.5 ? 0 : 99;
  else root.__ownerCamera.zoom = value;
  root.__r16aMarks?.push(root.__r16aSamples?.length ?? 0);
}, { only: swapOnly, value: zoom });

/** GPU-side geometry estimate: batch buffers plus every individually drawn building geometry. */
const memory = (page: Page) => page.evaluate(() => {
  const root = window as any;
  const { buildings, renderer } = root.__r16a;
  const scene = root.__r16aBuildingScene;
  const drawn = new Set<any>(), held = new Set<any>();
  const bytesOf = (geometry: any) => Object.values(geometry.attributes).reduce((sum: number, attribute: any) =>
    sum + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0);
  scene.traverse((object: any) => {
    if (!object.isMesh || object.isBatchedMesh) return;
    held.add(object.geometry);
    if (object.layers.mask & 1) drawn.add(object.geometry);
  });
  const sum = (set: Set<any>) => [...set].reduce((total, geometry) => total + bytesOf(geometry), 0);
  const stats = buildings.assetStats();
  return { drawnSourceBytes: sum(drawn), geometries: renderer.info.memory.geometries, heldGeometryBytes: sum(held),
    programs: renderer.info.programs?.length ?? 0,
    jsHeap: (performance as any).memory?.usedJSHeapSize ?? 0, ...stats };
});

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

/** Worst interval / CPU in the 20 frames after each zoom change, and overall percentiles. */
const summarize = (samples: Sample[], marks: number[]) => {
  const windows = marks.map(mark => samples.slice(mark, mark + 20));
  const worst = (key: keyof Sample) => windows.map(window => Math.max(0, ...window.map(sample => sample[key])));
  const round = (values: number[]) => values.map(value => Number(value.toFixed(1)));
  const all = samples.slice(1);
  return {
    frames: all.length,
    p50Dt: percentile(all.map(sample => sample.dt), .5), p99Dt: percentile(all.map(sample => sample.dt), .99),
    p99Cpu: percentile(all.map(sample => sample.cpu), .99),
    worstBuildingsPerCrossing: round(worst("buildings")), worstCpuPerCrossing: round(worst("cpu")),
    worstDtPerCrossing: round(worst("dt")),
    worstDt: Math.max(...all.map(sample => sample.dt)), worstCpu: Math.max(...all.map(sample => sample.cpu))
  };
};

const holdAt = async (page: Page, zoom: number) => {
  await setZoom(page, zoom);
  await page.waitForTimeout(holdMs);
};

const alternate = async (page: Page, [low, high]: readonly [number, number]) => {
  await setZoom(page, low);
  await page.waitForTimeout(holdMs * 2);
  await startRecorder(page);
  for (let cycle = 0; cycle < cycles; cycle++) {
    await holdAt(page, high);
    await holdAt(page, low);
  }
  const { marks, samples } = await stopRecorder(page);
  const slowFrames = await page.evaluate(() => ((window as any).__ownerFrames as any[])
    .filter(frame => frame.timings.cpu > 40).slice(-6));
  return { marks, samples, slowFrames, summary: summarize(samples, marks) };
};

/** CPU profile of one zoom pair (by default the first crossing, before any recipe was rebuilt). */
const profileFirstCrossing = async (page: Page) => {
  await setZoom(page, profiled[0]!);
  await page.waitForTimeout(holdMs);
  const sampling = sampleHotFunctions(page, holdMs * 2, 40);
  await setZoom(page, profiled[1]!);
  await page.waitForTimeout(holdMs);
  await setZoom(page, profiled[0]!);
  return sampling;
};

const measureQuality = async (url: string, quality: string) => {
  const browser = await launchBrowser(process.env.UNCAPPED === "1");
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 900, width: 1600 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value");
  for (const probe of process.env.PROBES?.split(",") ?? [])
    await page.addInitScript(name => { (globalThis as any)[name] = true; }, probe);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY, value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, saveText);
  await installFrameProfiler(page, exposeRenderer);
  await exposeBuildingScene(page);
  if (process.env.DETAIL_ZOOM || swapOnly) await patchDetailThreshold(page, process.env.DETAIL_ZOOM ?? "1.5");
  const loadStart = Date.now();
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&profile=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  const loadMs = Date.now() - loadStart;
  const savedZoom = await page.evaluate(only => {
    const camera = (window as any).__ownerCamera, saved = camera.zoom;
    if (only) camera.zoom = only;
    return saved;
  }, swapOnly && crossing[1]);
  await setZoom(page, crossing[1]);
  await page.waitForTimeout(8000);
  const memoryDetailed = await memory(page);
  await setZoom(page, crossing[0]);
  await page.waitForTimeout(8000);
  const memoryBefore = await memory(page);
  const { hot, profile } = await profileFirstCrossing(page);
  await page.waitForTimeout(holdMs);
  const crossings = await alternate(page, crossing);
  const memoryAfter = await memory(page);
  const controlRun = await alternate(page, control);
  const report = { control: controlRun.summary, crossing: crossings.summary, errors, hot: hot.slice(0, 25), loadMs,
    memoryAfter, memoryBefore, memoryDetailed, quality, savedZoom, tag, zooms: { control, crossing } };
  writeFileSync(resolve(outputDir, `${quality}-${tag}.json`), JSON.stringify({ ...report,
    marks: { control: controlRun.marks, crossing: crossings.marks },
    samples: { control: controlRun.samples, crossing: crossings.samples }, slowFrames: crossings.slowFrames },
  null, 2));
  writeFileSync(resolve(outputDir, `${quality}-${tag}.cpuprofile`), JSON.stringify(profile));
  console.log(JSON.stringify({ ...report, hot: hot.slice(0, 12) }, null, 1));
  await browser.close();
  assert.deepEqual(errors, []);
};

const { server, url } = await startDevServer();
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) await measureQuality(url, quality);
} finally {
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
