import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import type { ActiveAmbientOcclusion } from "../../src/render-common/quality";
import { AO_LEVEL_TUNING } from "../../src/render-common/shaders/frame-ao-glsl";
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
  stageFrozenSave,
  writeDiffImage
} from "./frozen-frame-review";

/**
 * R12b ambient occlusion review: frozen owner-save frames (pinned light, weather, camera, clock and
 * no moving actors). For every view the same frame is captured with `__ao(false)` (before), with
 * `__ao(true)` (after) and with `__aoTuning({ view: 1 })` (occlusion only); a second "before" proves
 * the frame was stable. Sheets are before | after | AO-only at full capture size.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITY=high] [SCENE=day] [VIEWPORT=1600x900] [WARMUP=40]
 *   [SPOTS='[{"name":"village","x":172,"z":75,"zoom":2.5}]'] (iso views; "save" keeps the save's camera;
 *   `"auto":"forest"` finds a forest edge near x, z)
 *   [POSSESSED='{"x":170,"z":60,"yaw":3.1,"pitch":-0.1}'] (one possessed eye; omitted: no possessed view)
 *   [TUNING='{"strength":0.7}'] (live `__aoTuning` patch for every view) [PLAIN=1] (no toggles: one
 *   plain frame per view, for cross-build parity of the Off path; pair with QUERY=&ao=off)
 *   [QUERY=&ao=soft] [LEVELS=soft,strong] (the shipped choices as variants plus an Off | Soft |
 *   Strong | Strong AO-only sheet per view) [TUNES='[{"name":"strong","strength":1,"power":1.5}]'] (variants, see `variants`)
 *   [PAN='{"spot":"village","step":0.005,"count":5}'] (shimmer check: that spot again at sub-pixel
 *   camera steps; frame-to-frame change of the AO-only image next to the shaded one's)
 *
 * The source save is only read. Browsers run through captures/browser-slot.sh.
 */
/** `auto: "forest"` centres on a dense tree bin beside an open one, nearest to (x, z). */
interface IsoSpot { auto?: "forest"; name: string; x?: number; z?: number; zoom?: number }

const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1600x900").split("x").map(Number);
const quality = process.env.QUALITY ?? "high";
const scene = process.env.SCENE ?? "day";
const query = process.env.QUERY ?? "";
const plain = process.env.PLAIN === "1";
const spots: IsoSpot[] = JSON.parse(process.env.SPOTS ?? '[{"name":"save"}]');
const possessedEye: PossessedEye | null = process.env.POSSESSED ? JSON.parse(process.env.POSSESSED) : null;
const tuning: Record<string, unknown> = JSON.parse(process.env.TUNING ?? "{}");
/**
 * Live tuning variants: each view keeps one "before" and gets an after + AO-only pair per variant
 * (`-after-<name>`, `-ao-<name>`, sheet `<view>-<name>.png`); one unnamed variant by default.
 */
const levels = (process.env.LEVELS?.split(",") ?? []) as ActiveAmbientOcclusion[];
const variants: ({ name: string } & Record<string, unknown>)[] = levels.length
  ? levels.map(level => ({ name: level, ...AO_LEVEL_TUNING[level] }))
  : JSON.parse(process.env.TUNES ?? "null") ?? [{ name: "", ...tuning }];
const pan: { count: number; spot: string; step: number } | null =
  process.env.PAN ? JSON.parse(process.env.PAN) : null;
const warmUpDraws = Number(process.env.WARMUP ?? 40);
const settleMs = Number(process.env.SETTLE_MS ?? 3000);
/** A leaf edge may differ by a few pixels between draws; a popped tree differs by thousands. */
const STABLE_DRIFT_PIXELS = 2000;
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageFrozenSave(saveText);
mkdirSync(resolve(outputDir, "diff"), { recursive: true });
mkdirSync(resolve(outputDir, "sheets"), { recursive: true });
const report: Record<string, any> = { pages: [], pairs: [], shots: [], tuning };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

const capture = async (page: Page, name: string) => {
  const shot = await captureFrame(page, outputDir, name, warmUpDraws);
  report.shots.push({ height: shot.height, name, width: shot.width });
  saveReport();
  return shot;
};

/** Switches the pass and the occlusion-only view; false when the page has no AO compositor. */
/** Every variant starts from the preset values (kept from the first call), not from the last one. */
const setAo = (page: Page, active: boolean, view: number, patch: Record<string, unknown> = tuning) =>
  page.evaluate(({ active, patch, view }) => {
    const hook = (window as any).__ao, tune = (window as any).__aoTuning;
    if (!hook || !tune) return false;
    const defaults = (window as any).__aoTuningDefaults ??= structuredClone(tune());
    tune({ ...structuredClone(defaults), ...patch, view });
    hook(active);
    return true;
  }, { active, patch, view });

const suffix = (variant: { name: string }) => (variant.name ? `-${variant.name}` : "");

/**
 * Before, after and AO-only frames of every variant, their sheets and statistics. Each variant takes
 * its own "before" right before its "after": clouds and wind move between variants, so an earlier
 * "before" would count their drift as occlusion.
 */
const captureVariants = async (page: Page, name: string, drift: number, pose: unknown) => {
  for (const { name: variantName, ...patch } of variants) {
    const tag = suffix({ name: variantName });
    await setAo(page, false, 0, patch);
    const before = await capture(page, `${name}-before${tag}`);
    await setAo(page, true, 0, patch);
    const after = await capture(page, `${name}-after${tag}`);
    await setAo(page, true, 1, patch);
    await capture(page, `${name}-ao${tag}`);
    writeDiffImage(outputDir, `${name}${tag}`, before, after, after.width, after.height);
    stackHorizontally(resolve(outputDir, "sheets", `${name}${tag}-before-after-ao.png`),
      [`${name}-before${tag}`, `${name}-after${tag}`, `${name}-ao${tag}`].map(file => resolve(outputDir, `${file}.png`)));
    report.pairs.push({ diff: differenceStats(before, after), drift, name: `${name}${tag}`, patch, pose });
    saveReport();
  }
  await setAo(page, false, 0);
  writeLevelSheet(name);
};

/** LEVELS only: Off (the first level's before) | every level's after | the last level's AO-only. */
const writeLevelSheet = (name: string) => {
  if (levels.length < 2) return;
  const files = [`${name}-before-${levels[0]}`, ...levels.map(level => `${name}-after-${level}`),
    `${name}-ao-${levels.at(-1)}`];
  stackHorizontally(resolve(outputDir, "sheets", `${name}-off-${levels.join("-")}-ao.png`),
    files.map(file => resolve(outputDir, `${file}.png`)));
};

/** Centres the frozen iso frame on a spot (the save's own camera for "save"). */
const aimIso = (page: Page, spot: IsoSpot) => page.evaluate(target => {
  const debug = (window as any).__atmosphereLiveDebug;
  /** Broadleaf and conifer props binned per 8 cells: a bin of 4+ trees with a treeless neighbour. */
  const findForestEdge = (world: any, nearX: number, nearZ: number) => {
    const bin = 8, columns = Math.ceil(world.cellsX / bin), counts = new Map<number, number>();
    const { props } = world;
    for (let index = 0; index < props.count; index++) {
      if (props.types[index] > 1) continue;
      const key = Math.floor(props.z[index] / bin) * columns + Math.floor(props.x[index] / bin);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = { distance: Infinity, x: nearX, z: nearZ };
    for (const [key, count] of counts) {
      if (count < 4) continue;
      const open = [1, -1, columns, -columns].some(step => (counts.get(key + step) ?? 0) === 0);
      const x = (key % columns + 1) * bin, z = (Math.floor(key / columns) + 1) * bin;
      const distance = Math.hypot(x - nearX, z - nearZ);
      if (open && distance < best.distance) best = { distance, x, z };
    }
    return { x: best.x, z: best.z };
  };
  if (target.auto === "forest") Object.assign(target, findForestEdge(debug.world, target.x ?? 0, target.z ?? 0));
  const frame = debug.snapshotFrame(debug.isoFrame);
  if (target.x !== undefined) frame.camera.centerX = target.x;
  if (target.z !== undefined) frame.camera.centerZ = target.z;
  if (target.zoom !== undefined) frame.camera.zoom = target.zoom;
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.frozenFrame = frame;
  debug.draw();
  return frame.camera;
}, spot);

/** before, after, occlusion only, then before again for the stability proof. */
const captureView = async (page: Page, name: string, pose: unknown) => {
  if (plain) {
    await capture(page, `${name}-plain`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert(await setAo(page, false, 0), "the page has no AO compositor (High or ?ao=soft needed)");
    const before = await capture(page, `${name}-before`);
    await setAo(page, true, 0);
    await capture(page, `${name}-after-probe`);
    await setAo(page, false, 0);
    const check = await capture(page, `${name}-before-check`);
    const drift = differenceStats(before, check).changed;
    if (drift > STABLE_DRIFT_PIXELS) {
      console.log(`${name}: frame drifted by ${drift} px, settling and retrying`);
      await page.waitForTimeout(settleMs);
      continue;
    }
    await captureVariants(page, name, drift, pose);
    return;
  }
  throw new Error(`${name}: the frame never settled for a valid A/B`);
};

/**
 * Sub-pixel pan: the after and AO-only frames at `count` camera steps. A stable effect changes
 * between steps about as much as the shaded image does; screen-fixed noise or aliasing (shimmer)
 * would change the AO-only image much more.
 */
const capturePan = async (page: Page, spot: IsoSpot) => {
  const frames: { after: RawShot; ao: RawShot }[] = [];
  for (let index = 0; index < pan!.count; index++) {
    await aimIso(page, { ...spot, x: (spot.x ?? 0) + index * pan!.step });
    await setAo(page, true, 0);
    const after = await capture(page, `pan-${spot.name}-${index}-after`);
    await setAo(page, true, 1);
    const ao = await capture(page, `pan-${spot.name}-${index}-ao`);
    frames.push({ after, ao });
  }
  report.pan = frames.slice(1).map((frame, index) => ({
    after: differenceStats(frames[index]!.after, frame.after),
    ao: differenceStats(frames[index]!.ao, frame.ao),
    step: index + 1
  }));
  await setAo(page, true, 0);
  saveReport();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const { errors, page, stats } = await openFrozenPage(browser, url, {
    query, quality, stagedSave, viewport: { height: height!, width: width! }
  });
  report.pages.push({ errors, quality, query, stats });
  saveReport();
  if (errors.length) throw new Error(errors.join(" | "));
  await pinScene(page, scene, true);
  await freezeIso(page);
  for (const spot of spots) {
    const camera = await aimIso(page, spot);
    await page.waitForTimeout(settleMs);
    await captureView(page, `${quality}-${scene}-iso-${spot.name}`, { camera });
    if (pan?.spot === spot.name) await capturePan(page, spot);
  }
  if (possessedEye) {
    await enterPossessed(page);
    const pose = await aimPossessed(page, possessedEye);
    await page.waitForTimeout(settleMs);
    await setFrame(page, "possessedFrame");
    await captureView(page, `${quality}-${scene}-possessed`, pose);
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots,", report.pairs.length, "pairs");
