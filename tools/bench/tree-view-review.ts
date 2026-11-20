import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  aimPossessed,
  captureFrame,
  differenceStats,
  enterPossessed,
  openFrozenPage,
  pinScene,
  type PossessedEye,
  type RawShot,
  stackHorizontally,
  stageFrozenSave,
  warmUp
} from "./frozen-frame-review";

/**
 * R15a possessed far trees, old (iso-angle sprites, `__treeViews = "off"`) against new (view
 * impostors) on the same frozen frame: eye-height shots near / at the transition / far, a walk
 * across the near-mesh <-> impostor boundary (consecutive-frame change = pop), a dusk shot, GPU ms
 * of the whole frame by timer query (A/B alternated on one page) and the atlas ledger. The forest
 * and the eye poses are picked from the save's world (densest tree bin, open land in front of it).
 *
 * Usage (browser via captures/browser-slot.sh):
 *   OWNER_SAVE=<save> OUTPUT_DIR=<dir> [QUALITIES=high,medium,minimal] [ROUNDS=6] [WALK=1] [TURN=1]
 *   [QUERY=&reveal=1]
 *   npx tsx --env-file=<env> tools/bench/tree-view-review.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const qualities = (process.env.QUALITIES ?? "high,medium,minimal").split(",");
const rounds = Number(process.env.ROUNDS ?? 6);
const walk = process.env.WALK !== "0";
const turn = process.env.TURN !== "0";
/** Extra page query; the default reveals the map so the fog of war does not hide the forest. */
const query = process.env.QUERY ?? "&reveal=1";
const EYE_HEIGHT = 0.97;
const MODES = ["off", "on"] as const;
const POSE_DISTANCES = { far: 110, near: 38, transition: 60 } as const;
const WALK_FROM = 76;
const WALK_TO = 36;
const WALK_STEP = 2;
/** Small yaw steps at the far pose (about half a pixel each at 1080p): alpha-test shimmer check. */
const TURN_STEP = 0.0005;
const TURN_STEPS = 8;
/** Rows (top-down, 1080p) of the far horizon band the turn check compares; the far trees stand in it. */
const HORIZON_ROWS = [480, 620] as const;
mkdirSync(resolve(outputDir, "walk"), { recursive: true });

type Mode = (typeof MODES)[number];

const setMode = (page: Page, mode: Mode) =>
  page.evaluate(value => { (globalThis as any).__treeViews = value; }, mode);

/** Densest tree bin and the open, dry approach direction to it (world units). */
const findForest = (page: Page) => page.evaluate(async distances => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { TREE_KINDS } = await load("/src/render-common/props/island-trees.ts");
  const { sampleSmooth } = await load("/src/shared/world/grid-geometry.ts");
  const world = debug.world, kinds = new Set<number>(TREE_KINDS), bin = 16;
  const bins = new Map<number, number>();
  const trees: [number, number][] = [];
  for (let id = 0; id < world.props.count; id++) {
    if (!kinds.has(world.props.types[id])) continue;
    const x = world.props.x[id], z = world.props.z[id];
    trees.push([x, z]);
    const key = Math.floor(z / bin) * 10000 + Math.floor(x / bin);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  const ordered = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const isLand = (x: number, z: number) => x > 2 && z > 2 && x < world.cellsX - 2 && z < world.cellsZ - 2 &&
    sampleSmooth(world, world.heights, x, z) > world.seaLevel + 0.2;
  const treesNear = (x: number, z: number, radius: number) =>
    trees.filter(([tx, tz]) => Math.hypot(tx - x, tz - z) < radius).length;
  const height = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  /** No ridge between the farthest eye and the forest's near edge (line of sight at eye height). */
  const seesForest = (centerX: number, centerZ: number, dx: number, dz: number) => {
    const far = Math.max(...Object.values(distances));
    const eyeY = height(centerX + dx * far, centerZ + dz * far) + 1;
    for (let distance = far; distance > 8; distance -= 2) {
      const lineY = eyeY + (height(centerX, centerZ) + 1 - eyeY) * (1 - distance / far);
      if (height(centerX + dx * distance, centerZ + dz * distance) > lineY + 0.3) return false;
    }
    return true;
  };
  for (const [key] of ordered.slice(0, 40)) {
    const centerX = (key % 10000 + 0.5) * bin, centerZ = (Math.floor(key / 10000) + 0.5) * bin;
    for (let step = 0; step < 24; step++) {
      const angle = step / 24 * Math.PI * 2, dx = Math.sin(angle), dz = Math.cos(angle);
      const along = Object.values(distances).every(distance =>
        isLand(centerX + dx * distance, centerZ + dz * distance));
      const open = Object.values(distances).every(distance =>
        treesNear(centerX + dx * distance, centerZ + dz * distance, 6) <= 1);
      if (along && open && seesForest(centerX, centerZ, dx, dz))
        return { centerX, centerZ, dx, dz, trees: bins.get(key) };
    }
  }
  throw new Error("No open approach to a forest found");
}, POSE_DISTANCES);

type Forest = Awaited<ReturnType<typeof findForest>>;

const poseAt = (forest: Forest, distance: number): PossessedEye => ({
  height: EYE_HEIGHT,
  pitch: 0.02,
  x: forest.centerX + forest.dx * distance,
  yaw: Math.atan2(-forest.dx, -forest.dz),
  z: forest.centerZ + forest.dz * distance
});

const capturePair = async (page: Page, name: string) => {
  const shots: Record<string, Awaited<ReturnType<typeof captureFrame>>> = {};
  for (const mode of MODES) {
    await setMode(page, mode);
    shots[mode] = await captureFrame(page, outputDir, `${name}-${mode}`, 4);
  }
  stackHorizontally(resolve(outputDir, `${name}-pair.png`),
    MODES.map(mode => resolve(outputDir, `${name}-${mode}.png`)));
  return differenceStats(shots.off!, shots.on!);
};

/** Whole-frame GPU time (timer query) and CPU time of one draw, the modes alternated per round. */
const measureFrames = (page: Page, roundCount: number) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const nextFrame = () => new Promise(done => requestAnimationFrame(done));
  const sample = async () => {
    const query = gl.createQuery();
    const start = performance.now();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    debug.draw();
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    const cpu = performance.now() - start;
    while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) await nextFrame();
    const gpu = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(query);
    return { cpu, draws: debug.lastDraw.draws, gpu, triangles: debug.lastDraw.triangles };
  };
  const results: Record<string, { cpu: number[]; draws: number[]; gpu: number[]; triangles: number[] }> = {};
  for (let round = 0; round < count; round++) {
    for (const mode of ["off", "on"]) {
      (globalThis as any).__treeViews = mode;
      for (let warm = 0; warm < 3; warm++) { debug.draw(); await nextFrame(); }
      const entry = results[mode] ??= { cpu: [], draws: [], gpu: [], triangles: [] };
      for (let index = 0; index < 8; index++) {
        const { cpu, draws, gpu, triangles } = await sample();
        entry.cpu.push(cpu); entry.gpu.push(gpu); entry.draws.push(draws); entry.triangles.push(triangles);
      }
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return Object.fromEntries(Object.entries(results).map(([mode, entry]) => [mode, {
    cpuMedianMs: median(entry.cpu), draws: [...new Set(entry.draws)], gpuMedianMs: median(entry.gpu),
    gpuSpreadMs: [Math.min(...entry.gpu), Math.max(...entry.gpu)],
    triangles: [Math.min(...entry.triangles), Math.max(...entry.triangles)]
  }]));
}, roundCount);

/** Steps toward the forest across the 3D <-> impostor boundary; consecutive-frame change per mode. */
const walkAcross = async (page: Page, forest: Forest, quality: string) => {
  const steps: { distance: number; off: number; on: number }[] = [];
  const previous: Partial<Record<Mode, { pixels: Uint8Array }>> = {};
  for (let distance = WALK_FROM; distance >= WALK_TO; distance -= WALK_STEP) {
    await aimPossessed(page, poseAt(forest, distance));
    const row = { distance, off: 0, on: 0 };
    for (const mode of MODES) {
      await setMode(page, mode);
      const shot = await captureFrame(page, resolve(outputDir, "walk"), `${quality}-${mode}-${distance}`, 3);
      if (previous[mode]) row[mode] = differenceStats(previous[mode]!, shot).over8;
      previous[mode] = shot;
    }
    steps.push(row);
  }
  return steps;
};

/** Changed pixels (> 8 levels) of the horizon band between two shots (bottom-up rows) of one size. */
const horizonChange = (before: RawShot, after: RawShot) => {
  const from = (after.height - HORIZON_ROWS[1]) * after.width * 4;
  const to = (after.height - HORIZON_ROWS[0]) * after.width * 4;
  return differenceStats({ pixels: before.pixels.subarray(from, to) }, { pixels: after.pixels.subarray(from, to) })
    .over8;
};

/**
 * Turns the far eye by TURN_STEP per shot; consecutive-frame change of the horizon band per mode.
 * The scene shifts the same way in both modes, so "on" above "off" is the impostors' extra shimmer.
 */
const turnAcross = async (page: Page, forest: Forest, quality: string) => {
  const sums: Record<Mode, number> = { off: 0, on: 0 };
  const base = poseAt(forest, POSE_DISTANCES.far);
  for (const mode of MODES) {
    await setMode(page, mode);
    let previous: RawShot | null = null;
    for (let step = 0; step <= TURN_STEPS; step++) {
      await aimPossessed(page, { ...base, yaw: base.yaw + step * TURN_STEP });
      const shot = await captureFrame(page, resolve(outputDir, "walk"), `${quality}-turn-${mode}-${step}`, 3);
      if (previous) sums[mode] += horizonChange(previous, shot);
      previous = shot;
    }
  }
  return { meanChangedPixels: { off: sums.off / TURN_STEPS, on: sums.on / TURN_STEPS }, step: TURN_STEP };
};

/**
 * Draws until the view layer is drawn. That needs its own atlas and the iso sprite layer: on a
 * frozen page their warm-up bands advance only with these draws, so a slow poll would capture 3D
 * trees in both modes.
 */
const waitForTreeViews = (page: Page) => page.waitForFunction(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.draw();
  return Boolean((globalThis as any).__treeViewStats) && (globalThis as any).__treeViewsDrawn === true;
}, null, { polling: 50, timeout: 180_000 }).then(() => true, () => false);

const reviewQuality = async (url: string, quality: string) => {
  const browser = await browserPromise;
  const { errors, page, stats } = await openFrozenPage(browser, url, {
    query, quality, stagedSave: stageFrozenSave(saveText), viewport: { height: 1080, width: 1920 }
  });
  await pinScene(page, "day", true);
  await enterPossessed(page);
  const forest = await findForest(page);
  await aimPossessed(page, poseAt(forest, POSE_DISTANCES.transition));
  const built = await waitForTreeViews(page);
  const atlas = await page.evaluate(() => (globalThis as any).__treeViewStats ?? null);
  const shots: Record<string, unknown> = {};
  for (const [name, distance] of Object.entries(POSE_DISTANCES)) {
    await aimPossessed(page, poseAt(forest, distance));
    shots[name] = await capturePair(page, `${quality}-${name}`);
  }
  await aimPossessed(page, poseAt(forest, POSE_DISTANCES.transition));
  await warmUp(page, 4);
  const timing = await measureFrames(page, rounds);
  const walkSteps = walk ? await walkAcross(page, forest, quality) : [];
  const turnChange = turn ? await turnAcross(page, forest, quality) : null;
  await pinScene(page, "dusk", true);
  await aimPossessed(page, poseAt(forest, POSE_DISTANCES.transition));
  shots.dusk = await capturePair(page, `${quality}-dusk`);
  await page.close();
  const row = { atlas, built, errors, forest, quality, shots, stats, timing, turn: turnChange, walk: walkSteps };
  console.log(JSON.stringify({ atlas, built, quality, timing, turn: turnChange }));
  return row;
};

const { server, url } = await startDevServer();
const browserPromise = launchBrowser();
try {
  const rows = [];
  for (const quality of qualities) rows.push(await reviewQuality(url, quality));
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(rows, null, 2));
  assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
} finally {
  await (await browserPromise).close();
  await server.close();
}
