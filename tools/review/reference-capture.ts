import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { aimPossessed, enterPossessed, freezeIso, pinScene, readFrame, warmUp } from "../bench/frozen-frame-review";
import { type Landward, type Roi } from "./reference-image";

/**
 * Game side of the reference tuner (TOOL-8): the nearest beach of the staged save, the matching
 * views (possessed beach, iso beach, sky look-up) and timed frame strips. Strips step the frozen
 * frame's clock, which also drives the frozen page's weather clock (atmosphere-live-cost-patch), so
 * the surf and the cloud drift advance exactly `1 / fps` seconds per frame. Keep sky strips at 2+
 * fps: the cloud motion integrates at most 0.25 cloud-seconds per update.
 */

export type GameView = "iso-beach" | "possessed-beach" | "possessed-inland" | "sky-up";

export interface BeachSpot {
  /** Cells of sand behind the beach point. */
  depth: number;
  x: number;
  /** Eye yaw looking from the land out to sea. */
  yaw: number;
  z: number;
}

export interface CapturedFrame {
  /** Possessed auto-exposure (EV) after the frame, when the preset runs it. */
  ev?: number;
  file: string;
  seconds: number;
}

/** Possessed auto-exposure tuning overrides (EyeAdaptationTuning keys) applied through the dev hook. */
export type ExposureTuning = Record<string, number>;

export interface ViewGeometry {
  /** Horizontal field of view in degrees (perspective views; iso reports 0). */
  hfov: number;
  landward: Landward;
  /** Projected box around the beach in screen shares (the swash views' default analysis region). */
  roi: Roi;
}

/** Iso zoom of the beach view (close iso, like the swash receipts). */
const ISO_ZOOM = 5;
/** Cells of sand inland of the beach point tried in order (dry sand reference rows of the analysis). */
const BEACH_DEPTHS = [2, 1.5, 1, 0];
/** Possessed beach eye: height and pitch (sea at the top, dry sand below); it stands on the sand. */
const BEACH_EYE = { height: 1.6, pitch: -0.95, turn: 0 };
/** Looking inland from the beach: grass, trees, buildings and sky in one frame (exposure review). */
const INLAND_EYE = { height: 1.6, pitch: -0.08, turn: Math.PI };
/** Analysed area around the beach point (cells): seaward and along the shore each way (inland = sand depth). */
const ROI_CELLS = { lateral: 3, seaward: 3 };
const SKY_EYE = { height: 1.6, pitch: 0.95, turn: 0 };
const EYES = { "possessed-beach": BEACH_EYE, "possessed-inland": INLAND_EYE, "sky-up": SKY_EYE } as const;
/** Real seconds of drawing after aiming, so the possessed eye adaptation (1.2–1.8 s) settles. */
const ADAPTATION_SETTLE_SECONDS = 4;
const BASE_TIME = 12;
/** Warm-up draws per frame: the temporal passes converge on the frozen pose. */
const WARM_UP_DRAWS = 10;

/**
 * The sandy shore cell nearest the start whose sand reaches furthest inland (BEACH_DEPTHS, deepest
 * first, so the views show dry sand behind the swash), and the yaw from land to sea.
 */
export const findBeach = (page: Page): Promise<BeachSpot> => page.evaluate(depths => {
  const world = (window as any).__atmosphereLiveDebug.world;
  const columns = world.cellsX + 1, rows = world.cellsZ + 1, start = world.start;
  const coast = (x: number, z: number) => world.coastDistance[z * columns + x];
  const seaYaw = (x: number, z: number) =>
    Math.atan2(coast(x - 1, z) - coast(x + 1, z), coast(x, z - 1) - coast(x, z + 1));
  const sandy = (x: number, z: number) =>
    world.splat[(Math.round(z) * columns + Math.round(x)) * 9 + 4] / 255 > 0.5;
  const nearest = (depth: number) => {
    let best = { distance: Infinity, x: start.x, z: start.z };
    for (let z = 8; z < rows - 8; z++) for (let x = 8; x < columns - 8; x++) {
      const index = z * columns + x, yaw = seaYaw(x, z);
      if (world.heights[index] <= world.seaLevel + 0.05 || coast(x, z) <= 0.5 || coast(x, z) >= 1.5) continue;
      if (!sandy(x, z) || !sandy(x - Math.sin(yaw) * depth, z - Math.cos(yaw) * depth)) continue;
      const distance = Math.hypot(x - start.x, z - start.z);
      if (distance < best.distance) best = { distance, x, z };
    }
    return best;
  };
  const depth = depths.find(each => Number.isFinite(nearest(each).distance)) ?? 0;
  const found = nearest(depth);
  return { depth, x: found.x, yaw: seaYaw(found.x, found.z), z: found.z };
}, BEACH_DEPTHS);

/** The eye stands 60 % of the sand depth behind the beach point, looking out to sea (`turn` 0). */
const eyeAt = (spot: BeachSpot, eye: { height: number; pitch: number; turn: number }) => ({
  height: eye.height, pitch: eye.pitch, x: spot.x - Math.sin(spot.yaw) * spot.depth * 0.6, yaw: spot.yaw + eye.turn,
  z: spot.z - Math.cos(spot.yaw) * spot.depth * 0.6
});

const aimIso = (page: Page, spot: BeachSpot) => page.evaluate(({ spot, zoom }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const frame = debug.snapshotFrame(debug.isoFrame);
  Object.assign(frame.camera, { centerX: spot.x, centerZ: spot.z, zoom });
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.frozenFrame = frame;
  debug.draw();
}, { spot, zoom: ISO_ZOOM });

/**
 * Screen direction of the land at the beach (projected inland step), the analysed region (projected
 * box around the beach, in screen shares) and the camera's horizontal FOV.
 */
const viewGeometry = (page: Page, spot: BeachSpot): Promise<ViewGeometry> => page.evaluate(({ cells, spot }) => {
  const debug = (window as any).__atmosphereLiveDebug, camera = debug.camera;
  const seaX = Math.sin(spot.yaw), seaZ = Math.cos(spot.yaw);
  const project = (along: number, across: number) => camera.position.clone()
    .set(spot.x + seaX * along + seaZ * across, debug.world.seaLevel, spot.z + seaZ * along - seaX * across)
    .project(camera);
  const sea = project(0, 0), land = project(-2, 0);
  const dx = land.x - sea.x, dy = sea.y - land.y;
  const vertical = dy > 0 ? "down" : "up";
  const sideways = dx > 0 ? "right" : "left";
  const corners = [project(cells.seaward, -cells.lateral), project(cells.seaward, cells.lateral),
    project(-spot.depth, -cells.lateral), project(-spot.depth, cells.lateral)];
  const share = (value: number) => Math.min(1, Math.max(0, value));
  const xs = corners.map(point => share((point.x + 1) / 2)), ys = corners.map(point => share((1 - point.y) / 2));
  const left = Math.min(...xs), top = Math.min(...ys);
  const hfov = camera.isPerspectiveCamera
    ? (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI : 0;
  return { hfov, landward: Math.abs(dx) > Math.abs(dy) ? sideways : vertical,
    roi: { height: Math.max(...ys) - top, left, top, width: Math.max(...xs) - left } };
}, { cells: ROI_CELLS, spot }) as Promise<ViewGeometry>;

const writeShot = (file: string, dataUrl: string) =>
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1]!, "base64"));

/**
 * Sets the possessed auto-exposure tuning to the page's defaults plus `patch` (dev hook of
 * frame-eye-adaptation.ts; no-op where the preset has no auto-exposure).
 */
const applyExposureTuning = (page: Page, patch: ExposureTuning) => page.evaluate(patch => {
  const hooks = window as any;
  if (!hooks.__exposureTuning) return;
  hooks.__exposureDefaults ??= { ...hooks.__exposureTuning() };
  hooks.__exposureTuning({ ...hooks.__exposureDefaults, ...patch });
}, patch);

/** Draws in real time until the live eye adaptation has settled on the frozen pose. */
const settleAdaptation = async (page: Page) => {
  const started = Date.now();
  while (Date.now() - started < ADAPTATION_SETTLE_SECONDS * 1000) await warmUp(page, 20);
};

const readExposure = (page: Page) => page.evaluate(() =>
  (window as any).__exposureProbe?.()?.ev as number | undefined);

/**
 * Points the frozen page at `view` (iso or possessed; possession is entered on first use). Possessed
 * views run the live eye adaptation (with `exposure` tuning overrides) until it settles.
 */
export const aimView = async (page: Page, spot: BeachSpot, view: GameView, scene: string,
  exposure: ExposureTuning = {}) => {
  await pinScene(page, scene, true);
  await applyExposureTuning(page, exposure);
  if (view === "iso-beach") {
    await freezeIso(page);
    await aimIso(page, spot);
    await warmUp(page, WARM_UP_DRAWS);
    return viewGeometry(page, spot);
  }
  const possessed = await page.evaluate(() => Boolean((window as any).__atmosphereLiveDebug.possessedFrame));
  if (!possessed) await enterPossessed(page);
  await aimPossessed(page, eyeAt(spot, EYES[view]));
  await settleAdaptation(page);
  return viewGeometry(page, spot);
};

/**
 * Clock of the strip's first frame. The sky's cloud motion ignores a clock that runs backwards, so
 * sky strips start just after the page's real clock (which drove the sky before the freeze).
 */
const stripStart = async (page: Page, view: GameView) => {
  if (view !== "sky-up") return BASE_TIME;
  return Math.ceil(await page.evaluate(() => performance.now() / 1000)) + 5;
};

/** `count` frames of the frozen view, the clock advancing `1 / fps` seconds per frame. */
export const captureClockStrip = async (page: Page, view: GameView, directory: string, count: number,
  fps: number, draws = WARM_UP_DRAWS) => {
  mkdirSync(directory, { recursive: true });
  const frames: CapturedFrame[] = [], start = await stripStart(page, view);
  for (let index = 0; index < count; index++) {
    const seconds = index / fps;
    await page.evaluate(time => { (window as any).__atmosphereLiveDebug.frozenFrame.time = time; },
      start + seconds);
    await warmUp(page, draws);
    const file = resolve(directory, `${String(index).padStart(4, "0")}.png`);
    writeShot(file, (await readFrame(page)).dataUrl);
    frames.push({ ev: await readExposure(page), file, seconds });
  }
  return frames;
};
