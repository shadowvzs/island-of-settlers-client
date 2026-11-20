import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  aimPossessed,
  captureFrame,
  enterPossessed,
  freezeIso,
  openFrozenPage,
  pinScene,
  type PossessedEye,
  setFrame,
  stageFrozenSave
} from "./frozen-frame-review";

/**
 * OWNER-SMALL review (2026-11-09): frozen owner-save frames of the mushrooms (iso and possessed
 * close-ups at day, dusk and night) and of the possessed rain splashes on open ground and at the
 * shore. The source save is only read; the browser runs through captures/browser-slot.sh.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITY=high] [VIEWPORT=1280x720] [SCENES=day,dusk,night]
 *   [RAIN=1] (adds the rain views) [WARMUP=40]
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1280x720").split("x").map(Number);
const quality = process.env.QUALITY ?? "high";
const scenes = (process.env.SCENES ?? "day,dusk,night").split(",");
const rainViews = process.env.RAIN === "1";
const warmUpDraws = Number(process.env.WARMUP ?? 40);
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(outputDir, { recursive: true });
const report: Record<string, unknown> = { quality, shots: [] as string[] };
/** The staged save with the whole map explored, so the nearest mushroom clump is drawn. */
const stageExploredSave = () => {
  const save = JSON.parse(stageFrozenSave(saveText));
  const { length } = save.progress.fog;
  save.progress.fog.packed = Buffer.alloc(Math.ceil(length / 4), 0xaa).toString("base64");
  return JSON.stringify(save);
};
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

interface ReviewSites {
  coast: { x: number; z: number };
  mushrooms: { x: number; z: number };
}

/** The mushroom clump nearest to the save's camera and the nearest shallow shore point. */
const findSites = (page: Page): Promise<ReviewSites> => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { sampleBilinear } = await load("/src/shared/world/grid-geometry.ts");
  const { PROP } = await load("/src/shared/world/world-data.ts");
  const world = debug.world, { centerX, centerZ } = debug.isoFrame.camera;
  let mushrooms = { distance: Infinity, x: centerX, z: centerZ };
  for (let index = 0; index < world.props.count; index++) {
    if (world.props.types[index] !== PROP.mushrooms) continue;
    const x = world.props.x[index], z = world.props.z[index];
    const distance = Math.hypot(x - centerX, z - centerZ);
    if (distance < mushrooms.distance) mushrooms = { distance, x, z };
  }
  let coast = { distance: Infinity, x: centerX, z: centerZ };
  for (let z = 4; z < world.cellsZ - 4; z++) for (let x = 4; x < world.cellsX - 4; x++) {
    const depth = sampleBilinear(world, world.waterDepth, x, z);
    if (depth < 0.08 || depth > 0.2) continue;
    const distance = Math.hypot(x - centerX, z - centerZ);
    if (distance < coast.distance) coast = { distance, x, z };
  }
  return { coast, mushrooms };
});

const eyeFacing = (target: { x: number; z: number }, direction: [number, number], distance: number,
  pitch: number, eyeHeight: number): PossessedEye => {
  const length = Math.hypot(direction[0], direction[1]) || 1;
  const x = target.x + direction[0] / length * distance, z = target.z + direction[1] / length * distance;
  return { height: eyeHeight, pitch, x, yaw: Math.atan2(target.x - x, target.z - z), z };
};

const aimIso = (page: Page, view: { x: number; z: number; zoom: number }) => page.evaluate(target => {
  const debug = (window as any).__atmosphereLiveDebug;
  const frame = debug.snapshotFrame(debug.isoFrame);
  Object.assign(frame.camera, { centerX: target.x, centerZ: target.z, zoom: target.zoom });
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.frozenFrame = frame;
  debug.draw();
}, view);

/** Re-pins the scene light with rain (computeEnvironment's rain argument). */
const pinRain = (page: Page, rain: number) => page.evaluate(async amount => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { computeEnvironment, TIME_PRESETS } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
  debug.pinned = computeEnvironment(debug.world.sun, TIME_PRESETS.day, amount, 0, undefined, 0);
}, rain);

/** Pins a named scene, or an exact hour for a token like `h18.6` (late dusk). */
const pinView = async (page: Page, scene: string) => {
  await pinScene(page, scene.startsWith("h") ? "dusk" : scene, true);
  if (!scene.startsWith("h")) return;
  await page.evaluate(async hour => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
    debug.pinned = computeEnvironment(debug.world.sun, hour, 0, 0, 0.45, 0);
  }, Number(scene.slice(1)));
};

const shoot = async (page: Page, name: string) => {
  await captureFrame(page, outputDir, `${quality}-${name}`, warmUpDraws);
  (report.shots as string[]).push(`${quality}-${name}`);
  saveReport();
};

const captureMushrooms = async (page: Page, sites: ReviewSites, scene: string) => {
  await pinView(page, scene);
  await aimIso(page, { ...sites.mushrooms, zoom: 7 });
  await shoot(page, `${scene}-iso-mushrooms`);
};

const capturePossessed = async (page: Page, sites: ReviewSites) => {
  await enterPossessed(page);
  for (const scene of scenes) {
    await pinView(page, scene);
    report[`${scene}-eye`] = await aimPossessed(page,
      eyeFacing(sites.mushrooms, [0.6, 0.8], 0.6, -0.62, 0.36));
    await setFrame(page, "possessedFrame");
    await shoot(page, `${scene}-possessed-mushrooms`);
  }
  if (!rainViews) return;
  await pinRain(page, 1);
  await aimPossessed(page, eyeFacing(sites.mushrooms, [0.6, 0.8], 3, -0.35, 1));
  await shoot(page, "rain-possessed-ground");
  await aimPossessed(page, eyeFacing(sites.coast, [1, 0], 2.5, -0.3, 1));
  await shoot(page, "rain-possessed-shore");
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const { errors, page, stats } = await openFrozenPage(browser, url, {
    query: "", quality, stagedSave: stageExploredSave(), viewport: { height: height!, width: width! }
  });
  report.page = { errors, stats };
  if (errors.length) throw new Error(errors.join(" | "));
  await pinView(page, scenes[0]!);
  await freezeIso(page);
  const sites = await findSites(page);
  report.sites = sites;
  for (const scene of scenes) await captureMushrooms(page, sites, scene);
  await capturePossessed(page, sites);
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", (report.shots as string[]).length, "shots");
