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
  setIsoView,
  stageReviewSave
} from "./water-review-page";

/**
 * RAINBOW review: frozen owner-save frames (water-review-page.ts) in the late afternoon after rain.
 * Possessed eyes look away from the sun over open sea and over hills; the environment carries the
 * real post-rain moisture (no review override) for the stills, and the actual environment
 * controller drives the fade strip from the end of a shower. Every still also writes a crop at
 * native resolution around the bow's top and an amplified on/off difference (where the bow adds
 * light: never on near ground). Iso and Minimal must show none. The source save is only read.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,medium,minimal] [STRIP=1] [COST=1] [PAIRS=40]
 *   [AA=1] (with COST: the A/A noise floor, both halves without the bow)
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const qualities = (process.env.QUALITIES ?? "high,medium,minimal").split(",");
const stripMode = process.env.STRIP === "1";
const costMode = process.env.COST === "1";
const PAIRS = Number(process.env.PAIRS ?? 40);
/** A/A noise floor: both halves of every cost pair draw without the bow. */
const noiseFloor = process.env.AA === "1";
/** Seconds after the shower's end of the fade strip (rain takes about 43 s to fade). */
const STRIP_SECONDS = [0, 20, 30, 35, 40, 60, 110, 130, 150, 170, 190, 210];
const CROP = { height: 540, width: 960 };
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(outputDir, { recursive: true });
const report: Record<string, any> = { cost: [], pages: [], shots: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
const save = (name: string, dataUrl: string) =>
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));

/** Late-afternoon clock (sun about 17 degrees high) and the eye sites over sea and over hills. */
const prepareRainbowSites = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
  const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
  const world = debug.world;
  let hour = 15;
  for (let candidate = 13; candidate < 18.5; candidate += 0.05) {
    const sun = computeEnvironment(world.sun, candidate, 0, 0, 0.45, 0).sun;
    if (Math.abs(sun.elevation - 0.3) < Math.abs(computeEnvironment(world.sun, hour, 0, 0, 0.45, 0)
      .sun.elevation - 0.3)) hour = candidate;
  }
  const sun = computeEnvironment(world.sun, hour, 0, 0, 0.45, 0).sun;
  const awayX = -sun.azimuthX, awayZ = -sun.azimuthZ;
  const heightAt = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  const inside = (x: number, z: number) => x > 2 && z > 2 && x < world.cellsX - 2 && z < world.cellsZ - 2;
  /** Sea share and highest rise over the eye along the antisolar ray, 20-240 units out. */
  const survey = (x: number, z: number) => {
    const eye = heightAt(x, z) + 1.7;
    let sea = 0, rise = -Infinity, samples = 0;
    for (let distance = 20; distance <= 240; distance += 5) {
      const px = x + awayX * distance, pz = z + awayZ * distance;
      samples++;
      if (!inside(px, pz) || heightAt(px, pz) < world.seaLevel) { sea++; continue; }
      if (distance >= 60) rise = Math.max(rise, heightAt(px, pz) - eye);
    }
    return { rise, sea: sea / samples };
  };
  let seaSite = null as null | { score: number; x: number; z: number };
  let hillSite = null as null | { score: number; x: number; z: number };
  // The settlement's surroundings are explored: far land elsewhere sits under the concealment veil.
  const { centerX, centerZ } = debug.isoFrame.camera;
  for (let z = 8; z < world.cellsZ - 8; z += 4) for (let x = 8; x < world.cellsX - 8; x += 4) {
    if (heightAt(x, z) < world.seaLevel + 0.6 || Math.hypot(x - centerX, z - centerZ) > 90) continue;
    const { rise, sea } = survey(x, z);
    if (sea > 0.9 && (!seaSite || sea > seaSite.score)) seaSite = { score: sea, x, z };
    // Most land with the highest rise in front of the eye (the island's own far slopes).
    const hills = sea < 0.7 ? (1 - sea) * 10 + Math.min(rise, 30) : -Infinity;
    if (hills > -Infinity && (!hillSite || hills > hillSite.score)) hillSite = { score: hills, x, z };
  }
  if (!seaSite || !hillSite) throw new Error(`No rainbow sites: sea ${!!seaSite} hills ${!!hillSite}`);
  debug.rainbow = { hillSite, hour, seaSite, sun };
  return debug.rainbow;
});

/** The frame environment `seconds` after a shower ended (the real controller, 0.1 s steps). */
const setShowerEnd = (page: Page, seconds: number | null) => page.evaluate(async seconds => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { createEnvironmentController } = await import(
    /* @vite-ignore */ String("/src/app/environment-controller.ts"));
  const { hour } = debug.rainbow;
  const controller = createEnvironmentController(debug.world.sun, { hour, rain: true, snow: false });
  let environment = controller.update(0);
  controller.toggleRain();
  // Stills (null): 75 s after the shower, the rain gone and the drops still in the air.
  for (let step = 0; step < (seconds ?? 75) * 10; step++) environment = controller.update(0.1);
  if (debug.possessedFrame) debug.possessedFrame.environment = environment;
  debug.isoFrame.environment = structuredClone(environment);
  return { afterRain: environment.afterRain, rain: environment.rain };
}, seconds);

/** Eye 1.7 above the site, looking away from the sun, slightly up so the whole arc is in view. */
const setRainbowEye = (page: Page, site: "hillSite" | "seaSite") => page.evaluate(site => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { sun } = debug.rainbow, at = debug.rainbow[site];
  const frame = debug.possessedFrame, pose = frame.exploration.camera.pose;
  pose.x = at.x; pose.z = at.z;
  pose.y = Math.max(debug.sites.seaLevel, debug.heightAt(at.x, at.z)) + 1.7;
  pose.yaw = Math.atan2(-sun.azimuthX, -sun.azimuthZ);
  pose.pitch = 0.1;
  frame.time = 100;
  debug.frozenFrame = frame;
}, site);

/**
 * Draws the frame with the bow and without it (strength forced to 0 through the DEV hook): the
 * full frame, a native-resolution crop at the bow's top, an 8x difference and the brightest
 * display value the bow touches (the bloom threshold is about 0.8).
 */
const captureStill = (page: Page) => page.evaluate(crop => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const review = (window as any).__rainbow;
  const read = () => {
    // Temporal state (shadow cascades, exposure, history) settles over a few identical draws.
    for (let warm = 0; warm < 4; warm++) debug.draw();
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const image = new Uint8ClampedArray(pixels.length), row = width * 4;
    for (let y = 0; y < height; y++) image.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    for (let index = 3; index < image.length; index += 4) image[index] = 255;
    return { height, image, width };
  };
  type Area = typeof crop & { x: number; y: number };
  const toUrl = (image: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, area?: Area) => {
    const full = document.createElement("canvas");
    full.width = width; full.height = height;
    full.getContext("2d")!.putImageData(new ImageData(image, width, height), 0, 0);
    if (!area) return full.toDataURL("image/png");
    const canvas = document.createElement("canvas");
    canvas.width = area.width; canvas.height = area.height;
    canvas.getContext("2d")!.drawImage(full, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    return canvas.toDataURL("image/png");
  };
  review.force = null;
  const on = read();
  const strength = debug.inspect().uniforms.uAtmosphereRainbow;
  review.force = 0;
  const off = read();
  review.force = null;
  const difference = new Uint8ClampedArray(on.image.length);
  let changed = 0, brightest = 0, largest = 0, nearChanged = 0;
  for (let index = 0; index < on.image.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) {
      const value = Math.abs(on.image[index + channel]! - off.image[index + channel]!);
      difference[index + channel] = Math.min(255, value * 8);
      delta = Math.max(delta, value);
    }
    difference[index + 3] = 255;
    if (delta < 2) continue;
    changed++;
    largest = Math.max(largest, delta);
    if (index / 4 / on.width > on.height * 0.8) nearChanged++;
    brightest = Math.max(brightest, on.image[index]!, on.image[index + 1]!, on.image[index + 2]!);
  }
  // The bow's top: the antisolar direction raised by 41.5 degrees, projected through the live camera.
  const { sun } = debug.rainbow, camera = debug.camera;
  const elevation = 41.5 * Math.PI / 180 - sun.elevation;
  const projected = camera.position.clone().add({ x: -sun.azimuthX * Math.cos(elevation) * 500,
    y: Math.sin(elevation) * 500, z: -sun.azimuthZ * Math.cos(elevation) * 500 }).project(camera);
  const x = Math.round((projected.x * 0.5 + 0.5) * on.width - crop.width / 2);
  const y = Math.round((0.5 - projected.y * 0.5) * on.height - crop.height / 2);
  const area = { ...crop, x: Math.max(0, Math.min(on.width - crop.width, x)),
    y: Math.max(0, Math.min(on.height - crop.height, y)) };
  return { brightest: brightest / 255, changedShare: changed / (on.width * on.height),
    crop: toUrl(on.image, on.width, on.height, area), difference: toUrl(difference, on.width, on.height),
    full: toUrl(on.image, on.width, on.height), largestDelta: largest, nearRowsChanged: nearChanged,
    off: toUrl(off.image, on.width, on.height), strength };
}, CROP);

const writeStill = async (page: Page, name: string, withOff = false) => {
  const still = await captureStill(page);
  save(name, still.full);
  save(`${name}-crop`, still.crop);
  save(`${name}-difference`, still.difference);
  if (withOff) save(`${name}-off`, still.off);
  const { brightest, changedShare, largestDelta, nearRowsChanged, strength } = still;
  report.shots.push({ brightest, changedShare, largestDelta, name, nearRowsChanged, strength });
  saveReport();
  console.log("shot", name, JSON.stringify({ brightest, changedShare, largestDelta, nearRowsChanged }));
};

/** ABBA whole-frame GPU timer pairs: the bow off (force 0) and on (the post-rain weather). */
const measureCost = (page: Page) => page.evaluate(async ({ count, noise }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const review = (window as any).__rainbow;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!timer) throw new Error("No GPU timer query");
  const frame = () => new Promise(done => requestAnimationFrame(done));
  const timed = async (shown: boolean) => {
    review.force = shown && !noise ? null : 0;
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
  const deltas: number[] = [], off: number[] = [], on: number[] = [];
  for (let pair = 0; pair < count; pair++) {
    const order = pair % 2 === 0 ? [false, true] : [true, false];
    const times: number[] = [];
    for (const shown of order) times[shown ? 1 : 0] = await timed(shown);
    if (Number.isNaN(times[0]! + times[1]!)) continue;
    off.push(times[0]!); on.push(times[1]!); deltas.push(times[1]! - times[0]!);
  }
  review.force = null;
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? NaN;
  return { deltaMedian: median(deltas), offMedian: median(off), onMedian: median(on), samples: deltas.length };
}, { count: PAIRS, noise: noiseFloor });

const runPage = async (page: Page, quality: string) => {
  await prepareScene(page);
  await page.evaluate(async () => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
    debug.heightAt = (x: number, z: number) => sampleSmooth(debug.world, debug.world.heights, x, z);
  });
  await pinLight(page, "day");
  report.sites = await prepareRainbowSites(page);
  await setShowerEnd(page, null);
  const { seaSite } = report.sites;
  await setIsoView(page, { centerX: seaSite.x, centerZ: seaSite.z, zoom: 1.7 });
  if (!costMode && !stripMode) await writeStill(page, `${quality}-iso`);
  await enterPossessed(page);
  console.log("weather", JSON.stringify(await setShowerEnd(page, null)));
  if (costMode) {
    for (const site of ["hillSite", "seaSite"] as const) {
      await setRainbowEye(page, site);
      const cost = await measureCost(page);
      report.cost.push({ quality, site, ...cost });
      saveReport();
      console.log("cost", quality, site, JSON.stringify(cost));
    }
    return;
  }
  if (stripMode) {
    await setRainbowEye(page, "seaSite");
    for (const seconds of STRIP_SECONDS) {
      const weather = await setShowerEnd(page, seconds);
      console.log("strip", seconds, JSON.stringify(weather));
      await writeStill(page, `${quality}-strip-${String(seconds).padStart(3, "0")}s`);
    }
    return;
  }
  for (const site of ["seaSite", "hillSite"] as const) {
    await setRainbowEye(page, site);
    await writeStill(page, `${quality}-possessed-${site === "seaSite" ? "sea" : "hills"}`, true);
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { errors, page } = await openReviewPage(browser, url, quality, stageReviewSave(saveText),
      { height: 1080, width: 1920 });
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
