import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { readFrame, warmUp } from "./frozen-frame-review";
import { routeReviewRow } from "./shore-shells-review-row";
import {
  enterPossessed,
  openReviewPage,
  pinLight,
  prepareScene,
  setIsoView,
  stageReviewSave
} from "./water-review-page";

/**
 * Shore shells review (SHORE-SHELLS 2026-11-10) on a frozen owner-save frame: the densest beach
 * cluster of render-only shore details and the densest grassy-bank (snail shell) cluster near the
 * save camera (or the SPOTS given), each in iso at normal zoom, a close possessed view and a
 * macro possessed view, with one settler copy standing beside the cluster for scale. Browsers run
 * through captures/browser-slot.sh.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080] [ZOOM=2.6]
 *   [SPOTS={"beach":{"x":1,"z":2},"bank":{"x":3,"z":4}}] [ROW=x,z] [QUERY=&bloom=off]
 *   [VIEWS=iso,possessed,macro,low]
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number) as [number, number];
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const isoZoom = Number(process.env.ZOOM ?? 2.6);
/** ROW=x,z: review-only row of every shell kind and variant along the beach from that point. */
const rowStart = process.env.ROW
  ? (([x, z]) => ({ x: x!, z: z! }))(process.env.ROW.split(",").map(Number))
  : null;
const forcedSpots = process.env.SPOTS ? JSON.parse(process.env.SPOTS) as Record<string, Point> : null;
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(outputDir, { recursive: true });
const report: Record<string, unknown>[] = [];

type Point = { x: number; z: number };
/**
 * Possessed eye distance from the spot and height above the ground, aimed at the spot; the macro
 * view narrows the field of view (radians) for a telephoto close-up.
 */
type CloseView = { distance: number; fov?: number; lift: number; name: string };
const ALL_CLOSE_VIEWS: CloseView[] = [
  { distance: 1.7, lift: 1.05, name: "possessed" },
  { distance: 1.7, fov: 0.22, lift: 1.05, name: "macro" },
  { distance: 2.4, fov: 0.16, lift: 0.45, name: "low" }
];
/** VIEWS=iso,macro,low: the views to shoot per spot (default all); a row then gets one iso overview. */
const views = new Set((process.env.VIEWS ?? "iso,possessed,macro,low").split(","));
const CLOSE_VIEWS = ALL_CLOSE_VIEWS.filter(({ name }) => views.has(name));

/** Keeps a settler copy of the live frame before prepareScene strips the actors. */
const keepWorkerTemplate = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.workerTemplate = structuredClone((debug.lastFrame?.workers ?? [])[0] ?? null);
});

/** Explored by the save: world.fog per cell is 0 hidden, 1 discovered, 2 visible. */
const EXPLORED_FOG = 1;

/**
 * Every shore detail with its kind and variant, the totals per kind, and per kind-variant the
 * explored instance nearest the save camera (unexplored ones are hidden by the fog of war).
 */
const findShellSpots = (page: Page) => page.evaluate(async (exploredFog) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { collectShoreDetails } = await import(
    /* @vite-ignore */ String("/src/render-common/props/shore-details.ts"));
  const { COVER, getMeshKind, getMeshVariant, getVariantCount } = await import(
    /* @vite-ignore */ String("/src/render-common/props/prop-meshes.ts"));
  const world = debug.world;
  const names = Object.fromEntries(Object.entries(COVER).map(([name, kind]) => [kind, name]));
  type Shell = { explored: boolean; kind: string; x: number; z: number };
  const shells: Shell[] = collectShoreDetails(world).map((shell: any) => ({
    explored: world.fog[Math.floor(shell.z) * world.cellsX + Math.floor(shell.x)] >= exploredFog,
    kind: `${names[getMeshKind(shell.meshId)]}-${getMeshVariant(shell.meshId)}`, x: shell.x, z: shell.z }));
  const { centerX, centerZ } = debug.isoFrame.camera;
  const spots: Record<string, { x: number; z: number }> = {};
  const distance = (shell: Shell) => Math.hypot(shell.x - centerX, shell.z - centerZ);
  for (const shell of shells) {
    if (!shell.explored) continue;
    const found = spots[shell.kind];
    if (!found || distance(shell) < Math.hypot(found.x - centerX, found.z - centerZ)) spots[shell.kind] = shell;
  }
  const totals: Record<string, number> = {};
  for (const shell of shells) totals[shell.kind.split("-")[0]!] = (totals[shell.kind.split("-")[0]!] ?? 0) + 1;
  const explored = shells.filter(shell => shell.explored).length;
  const rowKinds = [COVER.seashell, COVER.openShell, COVER.seaStar, COVER.seaSnailShell, COVER.snailShell];
  const rowLength = rowKinds.reduce((total, kind) => total + getVariantCount(kind), 0);
  return { explored, rowLength, shells, spots, totals };
}, EXPLORED_FOG);

/**
 * One settler copy standing 1.2 cells beside the spot across the view (`side`: a unit ground
 * direction), a scale reference that never hides the shells; none when the save has none.
 */
const placeSettler = (page: Page, spot: Point, side: Point) => page.evaluate(async ({ side, spot }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
  const template = debug.workerTemplate;
  const frame = debug.frozenFrame;
  if (!template || !frame) return;
  const x = spot.x + side.x * 1.2, z = spot.z + side.z * 1.2;
  frame.workers = [{ ...template, x, y: sampleSmooth(debug.world, debug.world.heights, x, z), z }];
}, { side, spot });

/**
 * Possessed eye on the spot's landward side (the direction farthest from the water), looking down
 * at it with the water behind; returns the ground direction across the view.
 */
const setCloseView = (page: Page, spot: Point, view: CloseView): Promise<Point> =>
  page.evaluate(async ({ spot, view }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { sampleBilinear, sampleSmooth } = await import(
      /* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
    const world = debug.world;
    let eye = { distance: -1, x: spot.x, z: spot.z };
    for (let step = 0; step < 16; step++) {
      const angle = step / 16 * Math.PI * 2;
      const x = spot.x + Math.cos(angle) * view.distance, z = spot.z + Math.sin(angle) * view.distance;
      const distance = sampleBilinear(world, world.coastDistance, x, z);
      if (distance > eye.distance) eye = { distance, x, z };
    }
    const frame = debug.possessedFrame, pose = frame.exploration.camera.pose;
    pose.x = eye.x;
    pose.z = eye.z;
    // A free eye (no "eye" mode): the pose height is used as given, above the 0.4 clearance.
    delete pose.mode;
    pose.y = sampleSmooth(world, world.heights, eye.x, eye.z) + view.lift;
    pose.yaw = Math.atan2(spot.x - eye.x, spot.z - eye.z);
    const target = sampleSmooth(world, world.heights, spot.x, spot.z) + 0.03;
    pose.pitch = -Math.atan2(pose.y - target, Math.hypot(spot.x - eye.x, spot.z - eye.z));
    if (view.fov) pose.fov = view.fov;
    debug.frozenFrame = frame;
    return { x: Math.cos(pose.yaw), z: -Math.sin(pose.yaw) };
  }, { spot, view });

const writeShot = async (page: Page, name: string) => {
  await warmUp(page, 8);
  const shot = await readFrame(page);
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(shot.dataUrl.split(",")[1]!, "base64"));
  console.log(`shot ${name}`);
};

const captureQuality = async (page: Page, quality: string) => {
  await keepWorkerTemplate(page);
  await prepareScene(page);
  await pinLight(page, "day");
  const { explored, rowLength, shells, spots, totals } = await findShellSpots(page);
  const row = rowStart ? Object.fromEntries(shells.slice(-rowLength).map(shell => [shell.kind, shell])) : null;
  const chosen = Object.entries(row ?? forcedSpots ?? spots)
    .filter((entry): entry is [string, Point] => entry[1] !== null);
  const nearby = chosen.map(([name, spot]) => ({ name, shells: shells
    .filter(shell => Math.hypot(shell.x - spot.x, shell.z - spot.z) < 3)
    .map(shell => `${shell.kind} ${shell.x.toFixed(2)} ${shell.z.toFixed(2)}`) }));
  report.push({ explored, nearby, quality, spots: Object.fromEntries(chosen), totals });
  console.log(quality, "shore details", JSON.stringify(totals));
  for (const [name, spot] of chosen) {
    if (!views.has("iso")) continue;
    await setIsoView(page, { centerX: spot.x, centerZ: spot.z, zoom: isoZoom });
    await placeSettler(page, spot, { x: Math.SQRT1_2, z: -Math.SQRT1_2 });
    await writeShot(page, `${quality}-iso-${name}`);
  }
  await enterPossessed(page);
  for (const [name, spot] of chosen) {
    for (const view of CLOSE_VIEWS) {
      await placeSettler(page, spot, await setCloseView(page, spot, view));
      await writeShot(page, `${quality}-${view.name}-${name}`);
    }
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const prepare = rowStart ? routeReviewRow(rowStart) : undefined;
    const { page } = await openReviewPage(browser, url, quality, stageReviewSave(saveText), { height, width },
      process.env.QUERY ?? "", prepare);
    await captureQuality(page, quality);
    await page.close();
  }
} finally {
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
