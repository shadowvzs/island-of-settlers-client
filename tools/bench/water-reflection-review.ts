import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { differenceStats, readFrame, stackHorizontally, warmUp, writeDiffImage } from "./frozen-frame-review";
import {
  enterPossessed,
  openReviewPage,
  pinLight,
  prepareScene,
  sailShip,
  setIsoView,
  setPossessedView,
  stageReviewSave
} from "./water-review-page";

/**
 * R18b water reflection review on frozen owner-save frames (pinned light, clear weather, clock and
 * camera). Every view is one frame captured `__ssr(false)` | `__ssr(true)` | `__ssr(false)` again
 * (drift), with a ×16 difference image, a before|after sheet and a 2× centre crop sheet. Views: a
 * bay with moored ships (day, dusk), the building with the most water on its camera side, inland water
 * if the island has any, the save's own camera, the sailing ship's open water, two possessed views.
 * The source save is only read. Browsers run through captures/browser-slot.sh.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080]
 *   [QUERY=&ssr=off] [PLAIN=1] (one plain shot per view, no toggling: Off-path parity runs, also
 *   from a base worktree's client directory as the working directory)
 *   [ONLY=<regexp of view names>]
 *   [LAND=1] (land-object cases, R18b-land: the leaning shore palms in iso and possessed views, each
 *   captured reflections off | on | the mirror-share debug view | on without the water's sun-shadow
 *   lookup, so both the reflection and the shadow on the water are isolated)
 *   [SSR_TUNING=<json>] (live `__ssrTuning` values for probe runs)
 *   [CLIP=1] (3 s at 30 fps of a panning camera and the sailing ship, reflections on and off, iso
 *   and possessed: PNG frames, mp4 clips and the frame-to-frame difference of the water)
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number) as [number, number];
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const plainMode = process.env.PLAIN === "1";
const clipMode = process.env.CLIP === "1";
const landMode = process.env.LAND === "1";
/** SSR_TUNING=<json>: live reflection tuning applied after load (`__ssrTuning`, probe runs). */
const ssrTuning = process.env.SSR_TUNING ? JSON.parse(process.env.SSR_TUNING) : null;
const query = process.env.QUERY ?? "";
/** ONLY=<regexp>: capture just the matching views (iteration runs). */
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const CLIP_FRAMES = 90;
const WARM_DRAWS = 6;
const FIRST_WARM_DRAWS = 60;
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageReviewSave(saveText);
for (const folder of ["diff", "sheets", "crops"]) mkdirSync(resolve(outputDir, folder), { recursive: true });
const report: Record<string, any> = { pages: [], shots: [], sites: null };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

type Point = { x: number; z: number };
interface ReflectionSites {
  /** A shore point with open water on the camera side and two ships moored in that water. */
  bay: (Point & { ships: { x: number; yaw: number; z: number }[] }) | null;
  lake: Point | null;
  /** The building with the most water on its camera side (its reflection is in view). */
  shore: (Point & { water: number }) | null;
}

/**
 * Review sites around the frozen iso frame. A reflection shows below its object on screen, so every
 * site needs water between the object and the iso camera (towards +x +z at yaw 0): the shore point
 * nearest the save camera with that water and two ships moored in it, the building with the most
 * of it, and the nearest inland water above sea level.
 */
const findReflectionSites = (page: Page): Promise<ReflectionSites> => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { VIEW_DIRECTION } = await import(/* @vite-ignore */ String("/src/render-common/iso-projection.ts"));
  const { sampleBilinear, sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
  const world = debug.world, frame = debug.isoFrame;
  if (frame.camera.yaw !== 0) throw new Error("The site finder assumes the default camera yaw");
  const horizontal = Math.hypot(VIEW_DIRECTION.x, VIEW_DIRECTION.z);
  const toward = { x: VIEW_DIRECTION.x / horizontal, z: VIEW_DIRECTION.z / horizontal };
  const surfaceAt = (x: number, z: number) => sampleBilinear(world, world.waterSurface, x, z);
  const depthAt = (x: number, z: number) => surfaceAt(x, z) - sampleSmooth(world, world.heights, x, z);
  const inside = (x: number, z: number) => x > 4 && z > 4 && x < world.cellsX - 4 && z < world.cellsZ - 4;
  const along = (point: Point, distance: number) => ({ x: point.x + toward.x * distance, z: point.z + toward.z * distance });
  const facingWater = (point: Point) => Array.from({ length: 10 }, (_, step) => along(point, step + 3))
    .filter(sample => inside(sample.x, sample.z) && depthAt(sample.x, sample.z) > 0.4).length;
  const centre = { x: frame.camera.centerX, z: frame.camera.centerZ };
  const distance = (point: Point) => Math.hypot(point.x - centre.x, point.z - centre.z);
  let bay = null as Point | null;
  for (let z = 6; z < world.cellsZ - 6; z += 1) for (let x = 6; x < world.cellsX - 6; x += 1) {
    const depth = depthAt(x, z);
    if (depth > -0.05 || depth < -0.8 || facingWater({ x, z }) < 9) continue;
    if (!bay || distance({ x, z }) < distance(bay)) bay = { x, z };
  }
  // Two ships broadside to the camera, 9 units out and 7 to either side: the bay between them and
  // their own mirror images below them stay in view.
  const mooring = (point: Point) => [0, 1].map(() => along(point, 9))
    .map((sample, index) => ({ x: sample.x + toward.z * (index ? 7 : -7), yaw: Math.atan2(toward.z, -toward.x),
      z: sample.z - toward.x * (index ? 7 : -7) }))
    .filter(ship => depthAt(ship.x, ship.z) > 1.4);
  const buildings: Point[] = frame.buildings ?? [];
  const shore = buildings.map(building => ({ water: facingWater(building), x: building.x, z: building.z }))
    .filter(building => building.water >= 3)
    .sort((left, right) => right.water - left.water || distance(left) - distance(right))[0] ?? null;
  let lake = null as Point | null;
  for (let z = 4; z < world.cellsZ - 4; z += 2) for (let x = 4; x < world.cellsX - 4; x += 2) {
    if (surfaceAt(x, z) - world.seaLevel < 0.3 || depthAt(x, z) < 0.3) continue;
    if (!lake || distance({ x, z }) < distance(lake)) lake = { x, z };
  }
  return { bay: bay && { ...bay, ships: mooring(bay) }, lake, shore };
});

/** Moored ships (render-only copies of the save's ship template) in the frozen frame. */
const mooredShips = (page: Page, ships: { x: number; yaw: number; z: number }[]) => page.evaluate(ships => {
  const debug = (window as any).__atmosphereLiveDebug;
  const template = debug.shipTemplate;
  debug.frozenFrame.ships = template ? ships.map((ship, index) => ({ ...template, id: 9000 + index,
    phase: "idle", x: ship.x, y: debug.sites.water, yaw: ship.yaw, z: ship.z })) : [];
}, ships);

const setReflections = (page: Page, active: boolean) =>
  page.evaluate(next => (window as any).__ssr?.(next) ?? false, active);

const writeShot = (name: string, shot: { dataUrl: string }) =>
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(shot.dataUrl.split(",")[1]!, "base64"));

/** 2× centre crop of a shot (the review site sits in the middle of every iso view). */
const cropCentre = (input: string, output: string) => execFileSync("ffmpeg", ["-y", "-loglevel", "error",
  "-i", input, "-vf", `crop=${width / 3}:${height / 3},scale=${Math.round(width * 2 / 3)}:-1:flags=neighbor`,
  output]);

/** before (off) | after (on) | before again, the difference image and the sheets. */
const captureAb = async (page: Page, name: string) => {
  if (only && !only.test(name)) return;
  // The first view after loading still settles streamed content (far props, impostors).
  await warmUp(page, report.shots.length === 0 ? FIRST_WARM_DRAWS : WARM_DRAWS);
  if (plainMode) {
    writeShot(name, await readFrame(page));
    report.shots.push({ name });
    return;
  }
  const hasPass = await setReflections(page, false);
  const before = await readFrame(page);
  await setReflections(page, true);
  await warmUp(page, 2);
  const after = await readFrame(page);
  await setReflections(page, false);
  const again = await readFrame(page);
  await setReflections(page, true);
  for (const [suffix, shot] of [["before", before], ["after", after], ["before2", again]] as const)
    writeShot(`${name}-${suffix}`, shot);
  writeDiffImage(outputDir, name, before, after, before.width, before.height);
  const paths = (suffix: string) => resolve(outputDir, `${name}-${suffix}.png`);
  stackHorizontally(resolve(outputDir, "sheets", `${name}-before-after.png`), [paths("before"), paths("after")]);
  for (const suffix of ["before", "after"]) cropCentre(paths(suffix), resolve(outputDir, "crops", `${name}-${suffix}.png`));
  stackHorizontally(resolve(outputDir, "sheets", `${name}-crop-before-after.png`),
    ["before", "after"].map(suffix => resolve(outputDir, "crops", `${name}-${suffix}.png`)));
  const change = differenceStats(before, after);
  const drift = differenceStats(before, again);
  report.shots.push({ change, drift: drift.over8, hasPass, name });
  console.log(`${name}: pass ${hasPass}, mean Δ ${change.mean.toFixed(3)}, >8 ${change.over8}, drift ${drift.over8}`);
};

const isoView = async (page: Page, name: string, point: Point, zoom: number) => {
  await setIsoView(page, { centerX: point.x, centerZ: point.z, zoom });
  await captureAb(page, name);
};

const captureViews = async (page: Page, quality: string) => {
  report.sites = await prepareScene(page);
  const sites = await findReflectionSites(page);
  report.reflectionSites = sites;
  const { camera, sites: { deep } } = report.sites;
  for (const scene of ["day", "dusk"] as const) {
    await pinLight(page, scene);
    if (sites.bay) {
      await setIsoView(page, { centerX: sites.bay.x + 4, centerZ: sites.bay.z + 4, zoom: 1.8 });
      await mooredShips(page, sites.bay.ships);
      await captureAb(page, `${quality}-${scene}-bay-ships`);
    }
    await isoView(page, `${quality}-${scene}-save-camera`, { x: camera.centerX, z: camera.centerZ }, camera.zoom);
  }
  await pinLight(page, "day");
  if (sites.shore) await isoView(page, `${quality}-day-shore-buildings`, sites.shore, 2.6);
  if (sites.lake) await isoView(page, `${quality}-day-inland-water`, sites.lake, 2.4);
  await setIsoView(page, { centerX: deep.x, centerZ: deep.z, zoom: 1.6 });
  await sailShip(page, 8);
  await captureAb(page, `${quality}-day-open-water-ship`);
  await enterPossessed(page);
  for (const target of ["coast", "ship"] as const) {
    await setPossessedView(page, target);
    await sailShip(page, 8);
    await captureAb(page, `${quality}-day-possessed-${target}`);
  }
};

/** Shows the mirror share (`__ssrTuning({ debugView })`) instead of the reflected colour. */
const setDebugView = (page: Page, on: boolean) =>
  page.evaluate(next => (window as any).__ssrTuning?.({ debugView: next ? 1 : 0 }), on);

/**
 * Switches the water material's sun-shadow lookup off (true) or back: the live water programs with
 * `sampleSunShadow(vWorld)` replaced by 1.0 (development A/B; the materials are found on the next draw).
 */
const setWaterShadowOff = (page: Page, off: boolean) => page.evaluate(next => {
  const debug = (window as any).__atmosphereLiveDebug, renderer = debug.renderer;
  if (!debug.waterMaterials) {
    const found = new Set<any>();
    const native = renderer.render;
    renderer.render = function(scene: any, camera: any) {
      scene.traverse((object: any) => {
        const material = object.material;
        if (material?.uniforms?.uRefraction && material.vertexShader?.includes("getSwell")) found.add(material);
      });
      return native.call(this, scene, camera);
    };
    debug.draw();
    renderer.render = native;
    debug.waterMaterials = [...found].map(material => ({ material, source: material.fragmentShader }));
  }
  for (const { material, source } of debug.waterMaterials) {
    material.fragmentShader = next ? source.replace("sampleSunShadow(vWorld)", "1.0") : source;
    material.needsUpdate = true;
  }
  return debug.waterMaterials.length;
}, off);

/** One land case: off | on | debug | on without water shadows, a sheet and the diffs. */
const captureLandCase = async (page: Page, name: string) => {
  if (only && !only.test(name)) return;
  await warmUp(page, report.shots.length === 0 ? FIRST_WARM_DRAWS : WARM_DRAWS);
  const shots: Record<string, Awaited<ReturnType<typeof readFrame>>> = {};
  await setReflections(page, false);
  shots.off = await readFrame(page);
  await setReflections(page, true);
  await warmUp(page, 2);
  shots.on = await readFrame(page);
  await setDebugView(page, true);
  shots.debug = await readFrame(page);
  await setDebugView(page, false);
  const waterMaterials = await setWaterShadowOff(page, true);
  await warmUp(page, 3);
  shots.noWaterShadow = await readFrame(page);
  await setWaterShadowOff(page, false);
  await warmUp(page, 2);
  for (const [suffix, shot] of Object.entries(shots)) writeShot(`${name}-${suffix}`, shot);
  writeDiffImage(outputDir, `${name}-reflection`, shots.off!, shots.on!, shots.on!.width, shots.on!.height);
  writeDiffImage(outputDir, `${name}-water-shadow`, shots.noWaterShadow!, shots.on!, shots.on!.width, shots.on!.height);
  stackHorizontally(resolve(outputDir, "sheets", `${name}-off-on-debug.png`),
    ["off", "on", "debug"].map(suffix => resolve(outputDir, `${name}-${suffix}.png`)));
  const reflection = differenceStats(shots.off!, shots.on!);
  const waterShadow = differenceStats(shots.noWaterShadow!, shots.on!);
  report.shots.push({ name, reflection, waterMaterials, waterShadow });
  console.log(`${name}: reflection mean Δ ${reflection.mean.toFixed(3)} (>8 ${reflection.over8}), ` +
    `water shadow mean Δ ${waterShadow.mean.toFixed(3)} (>8 ${waterShadow.over8}), water materials ${waterMaterials}`);
};

/** The leaning shore palms (R18b-land): iso at two zooms, the owner's bank view and a waterline view. */
const captureLandCases = async (page: Page, quality: string) => {
  report.sites = await prepareScene(page);
  const { coast } = report.sites.sites;
  await pinLight(page, "day");
  for (const zoom of [1.6, 2.6]) {
    await setIsoView(page, { centerX: coast.x, centerZ: coast.z, zoom });
    await captureLandCase(page, `${quality}-iso-shore-${zoom}`);
  }
  await enterPossessed(page);
  await setPossessedView(page, "coast");
  await captureLandCase(page, `${quality}-possessed-bank`);
  await setPossessedView(page, "waterline");
  await captureLandCase(page, `${quality}-possessed-waterline`);
};

/** Mean absolute frame-to-frame channel difference (the shimmer measure of a clip). */
const temporalDifference = (frames: Uint8Array[]) => {
  const means = frames.slice(1).map((frame, index) => {
    const previous = frames[index]!;
    let total = 0;
    for (let pixel = 0; pixel < frame.length; pixel += 4)
      for (let channel = 0; channel < 3; channel++) total += Math.abs(frame[pixel + channel]! - previous[pixel + channel]!);
    return total / (frame.length / 4 * 3);
  });
  return { max: Math.max(...means), mean: means.reduce((sum, value) => sum + value, 0) / means.length };
};

/** 3 s of the sailing ship while `move(frame)` pans the camera; frames, mp4 and the temporal difference. */
const captureClip = async (page: Page, name: string, move: (frame: number) => Promise<void>) => {
  const directory = resolve(outputDir, `clip-${name}`);
  mkdirSync(directory, { recursive: true });
  await warmUp(page, WARM_DRAWS);
  const frames: Uint8Array[] = [];
  for (let frame = 1; frame <= CLIP_FRAMES; frame++) {
    await move(frame);
    await sailShip(page, 0, 12 + frame / 30);
    const shot = await readFrame(page);
    frames.push(shot.pixels);
    writeShot(`clip-${name}/${String(frame).padStart(3, "0")}`, shot);
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", resolve(directory, "%03d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", resolve(outputDir, `${name}.mp4`)]);
  const temporal = temporalDifference(frames);
  report.shots.push({ name, temporal });
  console.log(`clip ${name}: frame-to-frame mean ${temporal.mean.toFixed(3)}, max ${temporal.max.toFixed(3)}`);
};

const panIso = (page: Page, deep: Point) => (frame: number) =>
  setIsoView(page, { centerX: deep.x - 3 + frame * 0.06, centerZ: deep.z + 1 - frame * 0.03, zoom: 1.6 });

const turnPossessed = (page: Page) => (frame: number) => page.evaluate(step => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.possessedFrame.exploration.camera.pose.yaw += step === 1 ? -0.15 : 0.0033;
}, frame);

const captureClips = async (page: Page, quality: string) => {
  report.sites = await prepareScene(page);
  const { deep } = report.sites.sites;
  await pinLight(page, "day");
  await sailShip(page, 8);
  for (const active of [true, false]) {
    await setReflections(page, active);
    await captureClip(page, `${quality}-iso-${active ? "on" : "off"}`, panIso(page, deep));
  }
  await enterPossessed(page);
  await setPossessedView(page, "ship");
  await sailShip(page, 8);
  for (const active of [true, false]) {
    await setPossessedView(page, "ship");
    await setReflections(page, active);
    await captureClip(page, `${quality}-possessed-${active ? "on" : "off"}`, turnPossessed(page));
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { errors, page } = await openReviewPage(browser, url, quality, stagedSave, { height, width }, query);
    report.pages.push({ errors, quality });
    if (ssrTuning) await page.evaluate(patch => (window as any).__ssrTuning?.(patch), ssrTuning);
    const capturePage = landMode ? captureLandCases : captureViews;
    await (clipMode ? captureClips : capturePage)(page, quality);
    await page.close();
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots");
