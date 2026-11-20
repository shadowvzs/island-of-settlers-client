import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  aimPossessed,
  captureFrame,
  differenceStats,
  enterPossessed,
  freezeIso,
  openFrozenPage,
  pinScene,
  type PossessedEye,
  type RawShot,
  setFrame,
  stackHorizontally,
  stageFrozenSave
} from "./frozen-frame-review";

/**
 * GLARE-SLIDER review: frozen owner-save frames of the three owner situations (2026-11-09) — a
 * wildflower clump close up, the surf on the nearest beach and a large rock against the sun — at
 * every Highlights / glare level (`api.setHighlights`, live, same frame). Iso and possessed views.
 * Sheets `<view>-levels.png` (levels left to right) and `<view>-crop.png` (the centre at 2x).
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITY=high] [SCENE=day] [VIEWPORT=1600x900]
 *   [LEVELS=1,0.6,0.3,0] [SETTLE_MS=3000] [PLAIN=1] (one frame per view: the cross-build pixel parity
 *   against master) [PLAIN_LEVEL=1] (sets that strength first; master has no setting) [WARMUP=40]
 *
 * The source save is only read. Browsers run through captures/browser-slot.sh.
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1600x900").split("x").map(Number);
const quality = process.env.QUALITY ?? "high";
const scene = process.env.SCENE ?? "day";
const plain = process.env.PLAIN === "1";
/** PLAIN only: the strength set before the plain frames (unset: the page's own setting). */
const plainLevel = process.env.PLAIN_LEVEL === undefined ? null : Number(process.env.PLAIN_LEVEL);
const levels = (process.env.LEVELS ?? "1,0.6,0.3,0").split(",").map(Number);
const warmUpDraws = Number(process.env.WARMUP ?? 40);
/** Asynchronous impostor bakes pop in after an aim: wait before the first level. */
const settleMs = Number(process.env.SETTLE_MS ?? 3000);
const CROP = { height: 300, width: 400 };
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(resolve(outputDir, "sheets"), { recursive: true });
const report: Record<string, any> = { pages: [], shots: [], sites: null, stability: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

interface GlareSites {
  coast: { seaX: number; seaZ: number; x: number; z: number };
  flowers: { x: number; z: number };
  rock: { x: number; z: number };
  sun: [number, number, number];
}

/** The flower clump and large rock nearest to the save's camera, the nearest beach and the sun. */
const findSites = (page: Page): Promise<GlareSites> => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { sampleBilinear, sampleSmooth } = await load("/src/shared/world/grid-geometry.ts");
  const { getSunVector } = await load("/src/render-common/environment.ts");
  const { PROP } = await load("/src/shared/world/world-data.ts");
  const world = debug.world, { centerX, centerZ } = debug.isoFrame.camera;
  const nearestProp = (type: number) => {
    let best = { distance: Infinity, x: centerX, z: centerZ };
    for (let index = 0; index < world.props.count; index++) {
      if (world.props.types[index] !== type) continue;
      const x = world.props.x[index], z = world.props.z[index];
      const distance = Math.hypot(x - centerX, z - centerZ);
      if (distance < best.distance) best = { distance, x, z };
    }
    if (best.distance === Infinity) throw new Error(`No prop of type ${type}`);
    return { x: best.x, z: best.z };
  };
  const depthAt = (x: number, z: number) =>
    sampleBilinear(world, world.waterSurface, x, z) - sampleSmooth(world, world.heights, x, z);
  let coast = null as null | { distance: number; x: number; z: number };
  for (let z = 4; z < world.cellsZ - 4; z += 1) for (let x = 4; x < world.cellsX - 4; x += 1) {
    const depth = depthAt(x, z);
    if (depth > 0 || depth < -0.25 || depthAt(x + 6, z) < 1 && depthAt(x - 6, z) < 1 &&
      depthAt(x, z + 6) < 1 && depthAt(x, z - 6) < 1) continue;
    const distance = Math.hypot(x - centerX, z - centerZ);
    if (!coast || distance < coast.distance) coast = { distance, x, z };
  }
  if (!coast) throw new Error("No beach");
  const seaward = [[6, 0], [-6, 0], [0, 6], [0, -6]].find(([dx, dz]) => depthAt(coast!.x + dx!, coast!.z + dz!) >= 1)!;
  return {
    coast: { seaX: coast.x + seaward[0]!, seaZ: coast.z + seaward[1]!, x: coast.x, z: coast.z },
    flowers: nearestProp(PROP.flowers),
    rock: nearestProp(PROP.largeRock),
    sun: getSunVector(debug.pinned.sun)
  };
});

/** An eye `distance` from the target along the horizontal `direction`, looking at it. */
const eyeFacing = (target: { x: number; z: number }, direction: [number, number], distance: number,
  pitch: number, height = 1.6): PossessedEye => {
  const length = Math.hypot(direction[0], direction[1]) || 1;
  const x = target.x + direction[0] / length * distance, z = target.z + direction[1] / length * distance;
  return { height, pitch, x, yaw: Math.atan2(target.x - x, target.z - z), z };
};

/** Centres the frozen iso frame on a point at `zoom`. */
const aimIso = (page: Page, view: { x: number; z: number; zoom: number }) => page.evaluate(target => {
  const debug = (window as any).__atmosphereLiveDebug;
  const frame = debug.snapshotFrame(debug.isoFrame);
  Object.assign(frame.camera, { centerX: target.x, centerZ: target.z, zoom: target.zoom });
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.frozenFrame = frame;
  debug.draw();
}, view);

const setHighlights = (page: Page, strength: number) => page.evaluate(value => {
  (window as any).__atmosphereLiveDebug.api.setHighlights(value);
}, strength);

const levelTag = (level: number) => `${Math.round(level * 100)}`;

/** The centre CROP of a capture at 2x (ffmpeg), for the close look. */
const cropCentre = (name: string) => {
  const output = resolve(outputDir, "crops", `${name}.png`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", resolve(outputDir, `${name}.png`), "-vf",
    `crop=${CROP.width}:${CROP.height}:(iw-${CROP.width})/2:(ih-${CROP.height})/2,scale=iw*2:ih*2:flags=neighbor`,
    output]);
  return output;
};

/** Every level of one view, its sheets and a repeat of the first level as the stability proof. */
const captureLevels = async (page: Page, view: string) => {
  const name = `${quality}-${scene}-${view}`;
  await page.waitForTimeout(settleMs);
  if (plain) {
    if (plainLevel !== null) await setHighlights(page, plainLevel);
    await captureFrame(page, outputDir, `${name}-plain`, warmUpDraws);
    report.shots.push(`${name}-plain`);
    return;
  }
  const shots: RawShot[] = [];
  for (const level of levels) {
    await setHighlights(page, level);
    shots.push(await captureFrame(page, outputDir, `${name}-${levelTag(level)}`, warmUpDraws));
    report.shots.push(`${name}-${levelTag(level)}`);
  }
  await setHighlights(page, levels[0]!);
  const repeat = await captureFrame(page, outputDir, `${name}-${levelTag(levels[0]!)}-repeat`, warmUpDraws);
  report.stability.push({ drift: differenceStats(shots[0]!, repeat).changed, view: name });
  report[name] = shots.slice(1).map((shot, index) =>
    ({ level: levels[index + 1], ...differenceStats(shots[0]!, shot) }));
  const files = levels.map(level => `${name}-${levelTag(level)}`);
  stackHorizontally(resolve(outputDir, "sheets", `${name}-levels.png`),
    files.map(file => resolve(outputDir, `${file}.png`)));
  stackHorizontally(resolve(outputDir, "sheets", `${name}-crop.png`), files.map(cropCentre));
  await setHighlights(page, 1);
  saveReport();
};

const captureIsoViews = async (page: Page, sites: GlareSites) => {
  await aimIso(page, { x: sites.coast.x, z: sites.coast.z, zoom: 3.2 });
  await captureLevels(page, "iso-surf");
  await aimIso(page, { x: sites.flowers.x, z: sites.flowers.z, zoom: 6 });
  await captureLevels(page, "iso-flowers");
  await aimIso(page, { x: sites.rock.x, z: sites.rock.z, zoom: 4 });
  await captureLevels(page, "iso-rock");
};

/**
 * Flowers front-lit (sun behind the eye, low and close), the rock against the sun (rim light) and
 * the surf seen from the beach.
 */
const capturePossessedViews = async (page: Page, sites: GlareSites) => {
  const [sunX, , sunZ] = sites.sun;
  const eyes: [string, PossessedEye][] = [
    ["possessed-flowers", eyeFacing(sites.flowers, [sunX, sunZ], 1.1, -0.75, 0.9)],
    ["possessed-rock", eyeFacing(sites.rock, [-sunX, -sunZ], 4, -0.12)],
    ["possessed-surf", eyeFacing({ x: sites.coast.seaX, z: sites.coast.seaZ },
      [sites.coast.x - sites.coast.seaX, sites.coast.z - sites.coast.seaZ], 9, -0.3)]
  ];
  await enterPossessed(page);
  for (const [view, eye] of eyes) {
    report.sites[view] = await aimPossessed(page, eye);
    await setFrame(page, "possessedFrame");
    await captureLevels(page, view);
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  mkdirSync(resolve(outputDir, "crops"), { recursive: true });
  const { errors, page, stats } = await openFrozenPage(browser, url, {
    query: "", quality, stagedSave: stageFrozenSave(saveText), viewport: { height: height!, width: width! }
  });
  report.pages.push({ errors, quality, stats });
  if (errors.length) throw new Error(errors.join(" | "));
  await pinScene(page, scene, true);
  await freezeIso(page);
  const sites = await findSites(page);
  report.sites = { ...sites };
  saveReport();
  await captureIsoViews(page, sites);
  await capturePossessedViews(page, sites);
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots");
