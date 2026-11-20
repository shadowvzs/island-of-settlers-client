import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { launchBrowser, startDevServer } from "./browser";
import { installFrameProfiler, sampleHotFunctions, stageStartupSave } from "./frame-profile";

/**
 * VARIANT-WORKER: frame cost of building model work when buildings appear or change level. On the
 * live owner save, the building layer's `update` is wrapped: every HOLD_MS one synthetic finished
 * building of a (type, level) the island does not show yet is added (placement, a cold recipe),
 * then the previous synthetic building is upgraded one level. Every frame records its rAF interval
 * and the `buildings.update` CPU. The save is only read; the simulation never sees the extras.
 *
 *   OWNER_SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [EVENTS=16] [HOLD_MS=1200]
 *   [REPORT_TAG=run] [UNCAPPED=1] [PROFILE=1] [ZOOM=<camera zoom>]
 *   npx tsx tools/bench/building-placement-hitch.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const events = Number(process.env.EVENTS ?? 16);
const holdMs = Number(process.env.HOLD_MS ?? 1200);
const tag = process.env.REPORT_TAG ?? "run";
mkdirSync(outputDir, { recursive: true });

type Sample = { buildings: number; cpu: number; dt: number };

const exposeRenderer = (source: string) => source.replace("const passNames",
  "window.__r16a = { renderer, buildings }; const passNames");

/** Appends the synthetic frames and level overrides to every `buildings.update` call. */
const installFrameInjection = (page: Page) => page.evaluate(async () => {
  const root = window as any;
  const catalog = await import(/* @vite-ignore */ String("/src/render-common/buildings/building-catalog.ts"));
  const { buildings } = root.__r16a;
  const update = buildings.update;
  root.__vwExtra = [];
  root.__vwLevels = new Map();
  root.__vwTypes = catalog.BUILDING_CATALOG.map((definition: any) => definition.id);
  buildings.update = (frames: any[], ...rest: unknown[]) => {
    root.__vwLast = frames;
    const levelled = frames.map(frame => root.__vwLevels.has(frame.id)
      ? { ...frame, level: root.__vwLevels.get(frame.id) } : frame);
    return update([...levelled, ...root.__vwExtra], ...rest);
  };
});

/** Cold (type, level) pairs: player building types at levels the island does not show yet. */
const planEvents = (page: Page, count: number) => page.evaluate(count => {
  const root = window as any;
  const frames = root.__vwLast as any[];
  const own = frames.filter(frame => (frame.owner ?? 0) === 0 && frame.construction === 1 && frame.type !== 7);
  const template = own[0];
  const shown = new Set(frames.map(frame => `${frame.type}:${frame.level ?? 1}`));
  const skipped = new Set([7, 16]);
  const plan: { level: number; type: number }[] = [];
  for (const level of [3, 2, 4, 5, 1]) for (const type of root.__vwTypes as number[]) {
    if (plan.length >= count || skipped.has(type) || shown.has(`${type}:${level}`)) continue;
    plan.push({ level, type });
  }
  return { nation: template.nation, plan, template };
}, count);

const startRecorder = (page: Page) => page.evaluate(() => {
  const root = window as any;
  root.__vwSamples = [];
  root.__vwMarks = [];
  let last = performance.now();
  const tick = (now: number) => {
    const timings = root.__ownerTimings ?? {};
    root.__vwSamples.push({ buildings: timings.buildings ?? 0, cpu: timings.cpu ?? 0, dt: now - last });
    last = now;
    if (root.__vwRecording) requestAnimationFrame(tick);
  };
  root.__vwRecording = true;
  requestAnimationFrame(tick);
});

const stopRecorder = (page: Page) => page.evaluate(() => {
  const root = window as any;
  root.__vwRecording = false;
  return { marks: root.__vwMarks as { kind: string; at: number }[], samples: root.__vwSamples as Sample[] };
});

/** Adds one synthetic building (placement) or raises the previous one's level (upgrade). */
const applyEvent = (page: Page, event: { index: number; kind: "place" | "upgrade"; level: number; type: number },
  template: unknown) => page.evaluate(({ event, template }) => {
  const root = window as any;
  const id = `vw-${event.index}`;
  root.__vwMarks.push({ at: root.__vwSamples.length, kind: event.kind });
  if (event.kind === "upgrade") {
    root.__vwExtra = root.__vwExtra.map((frame: any) => frame.id === id ? { ...frame, level: event.level } : frame);
    return;
  }
  const base = template as any;
  root.__vwExtra = [...root.__vwExtra, { ...base, construction: 1, id, level: event.level, type: event.type,
    upgradeProgress: undefined, upgradeStock: undefined,
    x: base.x + (event.index % 4) * 3 - 4.5, z: base.z + Math.floor(event.index / 4) * 3 + 4 }];
}, { event, template });

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

/** Worst `buildings.update` per event window (the frames until the next event) and overall. */
const summarize = (samples: Sample[], marks: { kind: string; at: number }[]) => {
  const round = (value: number) => Number(value.toFixed(1));
  const windows = marks.map((mark, index) => ({ kind: mark.kind,
    frames: samples.slice(mark.at, marks[index + 1]?.at ?? samples.length) }));
  const worst = (kind: string, key: keyof Sample) => windows.filter(window => window.kind === kind)
    .map(window => round(Math.max(0, ...window.frames.map(sample => sample[key]))));
  const all = samples.slice(1);
  const buildings = all.map(sample => sample.buildings);
  return {
    frames: all.length,
    framesOver16Buildings: buildings.filter(value => value > 16).length,
    p50Buildings: round(percentile(buildings, .5)), p99Buildings: round(percentile(buildings, .99)),
    p99Dt: round(percentile(all.map(sample => sample.dt), .99)),
    worstBuildings: round(Math.max(...buildings)),
    worstBuildingsPerPlacement: worst("place", "buildings"), worstBuildingsPerUpgrade: worst("upgrade", "buildings"),
    worstDtPerPlacement: worst("place", "dt"), worstDtPerUpgrade: worst("upgrade", "dt")
  };
};

const runEvents = async (page: Page) => {
  const { nation, plan, template } = await planEvents(page, events);
  await startRecorder(page);
  await page.waitForTimeout(holdMs);
  for (const [index, { level, type }] of plan.entries()) {
    await applyEvent(page, { index, kind: "place", level, type }, template);
    await page.waitForTimeout(holdMs);
    if (level >= 5) continue;
    await applyEvent(page, { index, kind: "upgrade", level: level + 1, type }, template);
    await page.waitForTimeout(holdMs);
  }
  const recorded = await stopRecorder(page);
  return { nation, plan, ...recorded };
};

const loadPage = async (url: string, quality: string) => {
  const browser = await launchBrowser(process.env.UNCAPPED === "1");
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 900, width: 1600 } });
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.text().includes("Building recipe worker")) warnings.push(message.text());
  });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value");
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY, value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, saveText);
  await installFrameProfiler(page, exposeRenderer);
  const loadStart = Date.now();
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&profile=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  return { browser, errors, loadMs: Date.now() - loadStart, page, warnings };
};

const measureQuality = async (url: string, quality: string) => {
  const { browser, errors, loadMs, page, warnings } = await loadPage(url, quality);
  if (process.env.ZOOM) await page.evaluate(zoom => { (window as any).__ownerCamera.zoom = zoom; },
    Number(process.env.ZOOM));
  await installFrameInjection(page);
  await page.waitForTimeout(8000);
  const sampling = process.env.PROFILE === "1" ? sampleHotFunctions(page, events * holdMs * 2, 40) : undefined;
  const run = await runEvents(page);
  const profiled = await sampling;
  const stats = await page.evaluate(() => (window as any).__r16a.buildings.assetStats());
  const report = { errors, events: run.plan, loadMs, nation: run.nation, quality, stats,
    summary: summarize(run.samples, run.marks), tag, warnings };
  writeFileSync(resolve(outputDir, `${quality}-${tag}.json`), JSON.stringify({ ...report, marks: run.marks,
    samples: run.samples }, null, 2));
  if (profiled) writeFileSync(resolve(outputDir, `${quality}-${tag}.cpuprofile`), JSON.stringify(profiled.profile));
  console.log(JSON.stringify(report, null, 1));
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
