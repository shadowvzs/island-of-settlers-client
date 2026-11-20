import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  enterPossessed,
  openReviewPage,
  pinLight,
  prepareScene,
  readFrame,
  setIsoView,
  setPossessedView,
  stageReviewSave
} from "./water-review-page";

/**
 * WHALES review: frozen owner-save frames (water-review-page.ts) with a whale event started at a
 * deep-water point through the development hook `__whales`, stepped at 30 frames per second.
 * Stills at authored moments of every event and species, iso (normal and close zoom) and possessed
 * from the coast, each full frame plus a crop around the whale. The source save is only read.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [EVENTS=roll,breach,tailSlap,blow]
 *   [SPECIES=humpback,orca] [VIEWS=iso,close,possessed]
 *   [CLIP=1] (instead of stills: every event as 15 fps PNG frames in OUTPUT_DIR/clip-<name>/)
 *   [COST=1] (instead of stills: ABBA GPU timer pairs, whale shown vs hidden, mid-breach)
 */
type Kind = "blow" | "breach" | "roll" | "tailSlap";
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const events = (process.env.EVENTS ?? "roll,breach,tailSlap,blow").split(",") as Kind[];
const speciesNames = (process.env.SPECIES ?? "humpback,orca").split(",");
const views = (process.env.VIEWS ?? "iso,close,possessed").split(",");
const clipMode = process.env.CLIP === "1";
const costMode = process.env.COST === "1";
const PAIRS = Number(process.env.PAIRS ?? 40);
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageReviewSave(saveText);
mkdirSync(outputDir, { recursive: true });
const report: Record<string, any> = { cost: [], pages: [], shots: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

/** Authored moments (humpback seconds; the orca runs at 0.72). */
const MOMENTS: Readonly<Record<Kind, readonly number[]>> = {
  blow: [2.95, 3.6, 7.95],
  breach: [2.3, 3.0, 3.7, 4.6, 5.4],
  roll: [3.9, 7.7, 8.45, 13.6, 16.3],
  tailSlap: [5.0, 5.62, 7.25]
};
const TIME_SCALE = { humpback: 1, orca: 0.72 } as Record<string, number>;
const CROP = { height: 540, width: 960 };

/** Starts an event at the review site: iso at the deep point, possessed in front of the eye. */
const startEvent = (page: Page, kind: Kind, species: number, possessed: boolean) =>
  page.evaluate(({ kind, possessed, species }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const whales = (window as any).__whales;
    const { deep } = debug.sites;
    const world = debug.world;
    const frame = debug.frozenFrame;
    frame.time = 100;
    debug.draw();
    let at = { x: deep.x, z: deep.z };
    if (possessed) {
      const pose = frame.exploration.camera.pose;
      const forwardX = Math.sin(pose.yaw), forwardZ = Math.cos(pose.yaw);
      for (let distance = 16; distance < 70; distance += 2) {
        const x = pose.x + forwardX * distance, z = pose.z + forwardZ * distance;
        const cell = Math.floor(z) * (world.cellsX + 1) + Math.floor(x);
        at = { x, z };
        if ((world.waterDepth[cell] ?? 0) > 2.6) break;
      }
    }
    // Centre the event's travel on the point (the director moves the whale along its heading).
    const yaw = whales.headingFor(kind);
    const travel = whales.travelFor(kind, species);
    const start = { x: at.x - Math.cos(yaw) * travel / 2, yaw, z: at.z + Math.sin(yaw) * travel / 2 };
    whales.scheduleIn(1e6);
    whales.reset();
    whales.trigger(kind, species, start);
    return start;
  }, { kind, possessed, species });

/** Steps the frozen frame to `seconds` after the start at 30 fps (one draw per step). */
const stepTo = (page: Page, seconds: number) => page.evaluate(async seconds => {
  const debug = (window as any).__atmosphereLiveDebug;
  const frame = debug.frozenFrame;
  const end = 100 + seconds;
  let steps = 0;
  while (frame.time < end - 1e-6) {
    frame.time = Math.min(end, frame.time + 1 / 30);
    debug.draw();
    if (++steps % 20 === 0) await new Promise(done => requestAnimationFrame(done));
  }
}, seconds);

/** Where the whale is on screen (drawing-buffer pixels, top left origin). */
const whaleOnScreen = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  const state = (window as any).__whales.state();
  const gl = debug.renderer.getContext();
  const point = debug.api.projectToViewport(state.x, state.y, state.z);
  const scale = gl.drawingBufferWidth / window.innerWidth;
  return { x: point.x * scale, y: point.y * scale };
});

const save = (name: string, dataUrl: string) =>
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));

const captureEvent = async (page: Page, name: string, kind: Kind, species: string, possessed: boolean) => {
  const index = species === "orca" ? 1 : 0;
  await startEvent(page, kind, index, possessed);
  for (const moment of MOMENTS[kind]) {
    await stepTo(page, moment * TIME_SCALE[species]!);
    const shot = `${name}-${kind}-${species}-${moment.toFixed(2)}`;
    save(shot, await readFrame(page));
    const at = await whaleOnScreen(page);
    save(`${shot}-crop`, await readFrame(page, { ...CROP, x: at.x - CROP.width / 2, y: at.y - CROP.height / 2 }));
    report.shots.push(shot);
    saveReport();
    console.log("shot", shot);
  }
};

const captureClip = async (page: Page, name: string, kind: Kind, species: string) => {
  const directory = resolve(outputDir, `clip-${name}-${kind}-${species}`);
  mkdirSync(directory, { recursive: true });
  await startEvent(page, kind, species === "orca" ? 1 : 0, name.includes("possessed"));
  const duration = { blow: 16, breach: 10, roll: 19.5, tailSlap: 13 }[kind] * TIME_SCALE[species]!;
  for (let frame = 0; frame * (1 / 15) <= duration; frame++) {
    await stepTo(page, frame / 15);
    const at = await whaleOnScreen(page);
    const dataUrl = await readFrame(page, { ...CROP, x: at.x - CROP.width / 2, y: at.y - CROP.height / 2 });
    writeFileSync(resolve(directory, `${String(frame).padStart(4, "0")}.png`),
      Buffer.from(dataUrl.split(",")[1]!, "base64"));
  }
  console.log("clip", name, kind, species);
};

/** ABBA whole-frame GPU timer pairs, the whale layers hidden (a) and shown (b), mid-breach. */
const measureCost = (page: Page) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!timer) throw new Error("No GPU timer query");
  const frame = () => new Promise(done => requestAnimationFrame(done));
  const timed = async (shown: boolean) => {
    (window as any).__whales.setHidden(!shown);
    debug.draw();
    gl.finish();
    const query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    debug.draw();
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    for (let wait = 0; wait < 60 && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE); wait++) await frame();
    const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(query);
    return gl.getParameter(timer.GPU_DISJOINT_EXT) ? NaN : ms;
  };
  for (const shown of [false, true, false, true]) await timed(shown);
  const deltas: number[] = [], hidden: number[] = [], shownTimes: number[] = [];
  for (let pair = 0; pair < count; pair++) {
    const order = pair % 2 === 0 ? [false, true] : [true, false];
    const times: number[] = [];
    for (const shown of order) times[shown ? 1 : 0] = await timed(shown);
    if (Number.isNaN(times[0]! + times[1]!)) continue;
    hidden.push(times[0]!);
    shownTimes.push(times[1]!);
    deltas.push(times[1]! - times[0]!);
  }
  (window as any).__whales.setHidden(false);
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? NaN;
  return { deltaMedian: median(deltas), hiddenMedian: median(hidden), samples: deltas.length,
    shownMedian: median(shownTimes) };
}, PAIRS);

/**
 * The real spawn path through the renderer's view adapter: the next event is due now and the
 * camera looks at the deep point; true when the director placed a whale on its own.
 */
const checkSpawn = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  const whales = (window as any).__whales;
  whales.reset();
  whales.scheduleIn(0);
  const frame = debug.frozenFrame;
  for (let step = 0; step < 30 && !whales.state().active; step++) {
    frame.time += 1 / 30;
    debug.draw();
  }
  const state = whales.state();
  const sites = whales.siteReport();
  whales.reset();
  whales.scheduleIn(1e6);
  return { active: state.active, kind: state.kind, sites, species: state.species, x: state.x, z: state.z };
});

/** CPU ms of the whale update (director, spray, upload packing) per frame over a whole event at 30 fps. */
const measureCpu = (page: Page, seconds: number) => page.evaluate(async seconds => {
  const debug = (window as any).__atmosphereLiveDebug;
  const whales = (window as any).__whales;
  const frame = debug.frozenFrame;
  const times: number[] = [];
  for (let step = 0; step < seconds * 30; step++) {
    frame.time += 1 / 30;
    debug.draw();
    times.push(whales.lastUpdateMs());
    if (step % 30 === 0) await new Promise(done => requestAnimationFrame(done));
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { cpuMax: sorted[sorted.length - 1], cpuMean: times.reduce((sum, value) => sum + value, 0) / times.length,
    cpuP95: sorted[Math.floor(sorted.length * 0.95)] };
}, seconds);

/** GPU A/B mid-breach and the CPU over a whole breach, in the current view. */
const measureView = async (page: Page, quality: string, view: string, possessed: boolean) => {
  await startEvent(page, "breach", 0, possessed);
  const cpu = await measureCpu(page, 10.5);
  await startEvent(page, "breach", 0, possessed);
  await stepTo(page, 3.2);
  const gpu = await measureCost(page);
  report.cost.push({ quality, view, ...cpu, ...gpu });
  saveReport();
  console.log(quality, view, JSON.stringify({ ...cpu, ...gpu }));
};

const runPage = async (page: Page, quality: string) => {
  report.sites = (await prepareScene(page)).sites;
  await pinLight(page, "day");
  const { deep } = report.sites;
  await setIsoView(page, { centerX: deep.x, centerZ: deep.z, zoom: 1.7 });
  report.spawn = { ...report.spawn, [quality]: await checkSpawn(page) };
  console.log("spawn check", quality, JSON.stringify(report.spawn[quality]));
  const isoViews = { close: 3, iso: 1.7 } as Record<string, number>;
  for (const view of views.filter(view => view !== "possessed")) {
    await setIsoView(page, { centerX: deep.x, centerZ: deep.z, zoom: isoViews[view] });
    if (costMode) {
      await measureView(page, quality, view, false);
      continue;
    }
    for (const kind of events) for (const species of speciesNames) {
      if (clipMode) await captureClip(page, `${quality}-${view}`, kind, species);
      else await captureEvent(page, `${quality}-${view}`, kind, species, false);
    }
  }
  if (!views.includes("possessed")) return;
  await enterPossessed(page);
  await setPossessedView(page, "ship");
  report.spawnPossessed = { ...report.spawnPossessed, [quality]: await checkSpawn(page) };
  console.log("spawn check possessed", quality, JSON.stringify(report.spawnPossessed[quality]));
  if (costMode) return measureView(page, quality, "possessed", true);
  for (const kind of events) for (const species of speciesNames) {
    if (clipMode) await captureClip(page, `${quality}-possessed`, kind, species);
    else await captureEvent(page, `${quality}-possessed`, kind, species, true);
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { errors, page } = await openReviewPage(browser, url, quality, stagedSave, { height: 1080, width: 1920 });
    report.pages.push({ errors, quality });
    await runPage(page, quality);
    await page.close();
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots");
