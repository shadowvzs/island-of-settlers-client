import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { hazeStats } from "./bloom-haze";
import { launchBrowser, startDevServer } from "./browser";
import {
  aimPossessed,
  captureFrame,
  differenceStats,
  enterPossessed,
  freezeIso,
  openFrozenPage,
  pinScene,
  setFrame,
  stackHorizontally,
  stageFrozenSave,
  writeDiffImage
} from "./frozen-frame-review";

/**
 * R11b bloom review: frozen owner-save frames (pinned light, weather, camera, actors and clock),
 * High and Minimal, iso and possessed, day / dusk / night. On a page whose preset runs bloom the
 * same frame is captured with `__bloom(false)` and `__bloom(true)`: only the bloom chain differs,
 * so the pair is an exact A/B. Every pair gets raw RGBA dumps, amplified difference statistics and
 * an hstack side-by-side PNG.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [SCENES=day,dusk,night] [QUALITIES=high,minimal]
 *   [VIEWS=iso,possessed,water] [VIEWPORT=1600x900] [WARMUP=40] [STRIP=1]
 *   SCENES also takes dawn and plain hours ("17.4": a time-lapse across dusk). The water view stands
 *   on the beach nearest the save's camera that faces the sun over open water and looks at the sun's
 *   reflection (sun glints); WATER_PITCH (default: follows the sun, -0.3 for a low sun, about -0.72 at
 *   noon, where the reflection lies steeply below the eye) and WATER_EYE (eye height, default 2.5).
 *   [BLOOM=off|low|on] (appends ?bloom=: a no-op where the level has no scene target)
 *   [MASTER_COMPOSITOR=1] (serves master's frame-compositor: bloom-off pixel parity)
 *   [REFERENCE=linear|plain] the Off frame of a pair: "linear" (default) keeps the R11a linear output
 *   pass with no glow, so the pair differs only by the bloom (the linear pass applies R12b AO in linear
 *   radiance, stronger than the plain pass); "plain" is the player's Off path (parity runs).
 *   [DIFF_DIR=<earlier output dir>] [DIFF_ONLY=1]
 *   [TUNES='[{"name":"a","intensity":0.3},...]'] (live `__bloomTuning` variants: one Off frame and
 *   one frame per variant for every view, instead of the Off/On pair)
 *
 * The source save is only read. Browsers run through captures/browser-slot.sh.
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1600x900").split("x").map(Number);
const scenes = (process.env.SCENES ?? "day,dusk,night").split(",");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const views = (process.env.VIEWS ?? "iso,possessed").split(",");
const VIEW_FRAMES: Record<string, string> = { iso: "isoFrame", possessed: "possessedFrame", water: "waterFrame" };
assert(views.every(view => view in VIEW_FRAMES), "VIEWS: iso,possessed,water");
const waterPitchOverride = process.env.WATER_PITCH ? Number(process.env.WATER_PITCH) : null;
const waterEye = Number(process.env.WATER_EYE ?? 2.5);
const bloomOverride = process.env.BLOOM ? `&bloom=${process.env.BLOOM}` : "";
const tunes: ({ name: string } & Record<string, any>)[] = JSON.parse(process.env.TUNES ?? "[]");
const diffDir = process.env.DIFF_DIR ? resolve(process.env.DIFF_DIR) : null;
const stripDynamic = process.env.STRIP !== "0";
const warmUpDraws = Number(process.env.WARMUP ?? 40);
/** Async vegetation/impostor bakes must finish before the A/B pair, or a popped tree fakes a diff. */
const settleMs = Number(process.env.SETTLE_MS ?? 3000);
const masterCompositor = process.env.MASTER_COMPOSITOR === "1";
const linearReference = (process.env.REFERENCE ?? "linear") === "linear";
assert(["linear", "plain"].includes(process.env.REFERENCE ?? "linear"), "REFERENCE: linear|plain");
const clientRoot = resolve(import.meta.dirname, "../..");
const masterModulePath = resolve(clientRoot, "src/renderers/three/r11b-master-frame-compositor.ts");
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageFrozenSave(saveText);
mkdirSync(resolve(outputDir, "diff"), { recursive: true });
const report: Record<string, any> = { diff: [], pairs: [], pages: [], shots: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

/** MASTER_COMPOSITOR=1: serves master's compositor module in place of the lane's. */
const masterCompositorRoute = (url: string) => async (page: Page) => {
  if (!masterCompositor) return;
  await page.route("**/src/renderers/three/frame-compositor.ts", async route => {
    const response = await route.fetch();
    const transformed = await fetch(`${url}src/renderers/three/r11b-master-frame-compositor.ts`);
    assert(transformed.ok, "staged master compositor module did not load");
    await route.fulfill({ body: await transformed.text(), response });
  });
};

const openPage = async (browser: Browser, url: string, quality: string) => {
  const { errors, page, stats } = await openFrozenPage(browser, url, {
    extraRoutes: masterCompositorRoute(url),
    query: bloomOverride,
    quality,
    stagedSave,
    viewport: { height: height!, width: width! }
  });
  report.pages.push({ bloomOverride, errors, masterCompositor, quality, stats });
  if (errors.length) throw new Error(`${quality}: ${errors.join(" | ")}`);
  return page;
};

/** Night review frames a lit building up close, where the window glow reads. */
const closeIsoOnLitBuilding = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  const buildings = debug.isoFrame.buildings ?? [];
  const building = buildings.find((candidate: any) => candidate.windowLit) ?? buildings[0];
  if (!building) return false;
  const close = debug.snapshotFrame(debug.isoFrame);
  Object.assign(close.camera, { centerX: building.x, centerZ: building.z, zoom: 2 });
  close.time = 12;
  debug.isoFrame = close;
  debug.frozenFrame = close;
  return { centerX: building.x, centerZ: building.z, windowLit: building.windowLit === true, zoom: 2 };
});

/** Aims the frozen eye at the nearest building (night windows) or at the pinned sun (day, dusk). */
const freezePossessed = (page: Page, aim: "sun" | "village", pitch: number) => page.evaluate(
  ({ aim, pitch }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.freeze();
    const frame = debug.frozenFrame, pose = frame.exploration.camera.pose;
    let targetX = pose.x + 20, targetZ = pose.z;
    if (aim === "sun") {
      const sun = debug.pinned.sun;
      targetX = pose.x + sun.azimuthX * 100;
      targetZ = pose.z + sun.azimuthZ * 100;
    } else {
      // Lit windows first, from a few steps in front of the facade so the glow reads at eye level.
      const byDistance = (frame.buildings ?? []).map((building: any) => ({
        distance: Math.hypot(building.x - pose.x, building.z - pose.z),
        lit: building.windowLit === true, x: building.x, y: building.y, z: building.z
      })).sort((left: any, right: any) => left.distance - right.distance);
      const nearest = byDistance.find((building: any) => building.lit) ?? byDistance[0];
      if (nearest) {
        pose.x = nearest.x;
        pose.z = nearest.z - 8;
        pose.y = (nearest.y ?? 0) + 1.6;
        targetX = nearest.x;
        targetZ = nearest.z;
      }
    }
    pose.yaw = Math.atan2(targetX - pose.x, targetZ - pose.z);
    pose.pitch = pitch;
    frame.time = 12;
    debug.stripDynamic(frame);
    debug.possessedFrame = frame;
    debug.frozenFrame = frame;
    debug.draw();
    if (aim === "village") faceLitSide(debug, pose, targetX, targetZ);
    return { aim, pitch, pose: { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw }, yawDeg: pose.yaw * 180 / Math.PI };

    /** Walks around the building and keeps the side showing the most warm lit pixels (windows, lanterns). */
    function faceLitSide(debug: any, pose: any, centerX: number, centerZ: number) {
      const gl = debug.renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      const warmLit = () => {
        debug.draw();
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4)
          if (pixels[index]! > 150 && pixels[index]! > pixels[index + 2]! + 40) count++;
        return count;
      };
      let best = { angle: 0, count: -1 };
      for (let side = 0; side < 8; side++) {
        const angle = side * Math.PI / 4;
        pose.x = centerX - Math.sin(angle) * 7;
        pose.z = centerZ - Math.cos(angle) * 7;
        pose.yaw = angle;
        const count = warmLit();
        if (count > best.count) best = { angle, count };
      }
      pose.x = centerX - Math.sin(best.angle) * 7;
      pose.z = centerZ - Math.cos(best.angle) * 7;
      pose.yaw = best.angle;
      debug.draw();
    }
  }, { aim, pitch });

/**
 * The beach point nearest the iso camera with open water (depth >= 1) all along the sun's horizontal
 * direction for 8..40 cells; the eye wades six cells out and looks towards the sun's reflection.
 */
const findSunWater = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { sampleBilinear, sampleSmooth } = await load("/src/shared/world/grid-geometry.ts");
  const { getSunVector } = await load("/src/render-common/environment.ts");
  const world = debug.world, { centerX, centerZ } = debug.isoFrame.camera;
  const [sunX, , sunZ] = getSunVector(debug.pinned.sun);
  const length = Math.hypot(sunX, sunZ) || 1;
  const towardX = sunX / length, towardZ = sunZ / length;
  const depthAt = (x: number, z: number) =>
    sampleBilinear(world, world.waterSurface, x, z) - sampleSmooth(world, world.heights, x, z);
  const openWaterAhead = (x: number, z: number) => {
    for (let step = 8; step <= 40; step += 4)
      if (depthAt(x + towardX * step, z + towardZ * step) < 1) return false;
    return true;
  };
  let best = null as null | { distance: number; x: number; z: number };
  for (let z = 4; z < world.cellsZ - 4; z++) for (let x = 4; x < world.cellsX - 4; x++) {
    const depth = depthAt(x, z);
    if (depth > 0 || depth < -0.4) continue;
    const distance = Math.hypot(x - centerX, z - centerZ);
    if (best && distance >= best.distance) continue;
    if (openWaterAhead(x, z)) best = { distance, x, z };
  }
  if (!best) throw new Error("No beach facing the sun over open water");
  const elevation: number = debug.pinned.sun.elevation;
  // Six cells out into the water (the eye stands above the sea level there): the view is all water.
  return { elevation, x: best.x + towardX * 6, yaw: Math.atan2(towardX, towardZ), z: best.z + towardZ * 6 };
});

/** Freezes the sun-glint eye as `waterFrame` (before the possessed view takes `possessedFrame`). */
const freezeWater = async (page: Page) => {
  const { elevation, ...site } = await findSunWater(page);
  // The sun's mirror image lies as far below the horizon as the sun stands above it.
  const pitch = waterPitchOverride ?? -Math.max(0.3, elevation - 0.25);
  const eye = await aimPossessed(page, { height: waterEye, pitch, ...site });
  await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.waterFrame = debug.possessedFrame;
  });
  return eye;
};

const capture = async (page: Page, name: string) => {
  const shot = await captureFrame(page, outputDir, name, warmUpDraws);
  report.shots.push({ height: shot.height, name, width: shot.width });
  saveReport();
  return shot;
};

const setBloom = (page: Page, active: boolean) => page.evaluate(({ linear, value }) => {
  const hook = (window as any).__bloom;
  if (!hook) return false;
  hook(value);
  (window as any).__linearOutput?.(linear);
  return true;
}, { linear: linearReference, value: active });

const sideBySide = (name: string, left: string, right: string) => stackHorizontally(
  resolve(outputDir, `${name}-side-by-side.png`),
  [resolve(outputDir, `${left}.png`), resolve(outputDir, `${right}.png`)]
);

const aimFor = (scene: string): { aim: "sun" | "village"; pitch: number } =>
  scene === "night" ? { aim: "village", pitch: 0.05 } : { aim: "sun", pitch: scene === "dusk" ? 0.06 : 0.12 };

const capturePage = async (page: Page, scene: string, quality: string) => {
  const { camera } = await freezeIso(page);
  const pose: Record<string, unknown> = { camera };
  if (scene === "night") pose.isoClose = await closeIsoOnLitBuilding(page);
  await page.waitForTimeout(settleMs);
  if (views.includes("possessed") || views.includes("water")) {
    await enterPossessed(page);
    if (views.includes("water")) pose.water = await freezeWater(page);
    if (views.includes("possessed"))
      pose.possessed = await freezePossessed(page, aimFor(scene).aim, aimFor(scene).pitch);
    await page.waitForTimeout(settleMs);
  }
  for (const view of views) {
    await setFrame(page, VIEW_FRAMES[view]!);
    const prefix = `${quality}-${scene}-${view}`;
    const bloomRuns = await setBloom(page, false);
    if (!bloomRuns) {
      await capture(page, `${prefix}-off`);
      saveReport();
      continue;
    }
    if (tunes.length) {
      await captureTunes(page, prefix);
      continue;
    }
    const { off, offDrift, on } = await captureStablePair(page, prefix);
    const diff = { ...differenceStats(off, on), ...hazeStats(off, on) };
    writeDiffImage(outputDir, prefix, off, on, on.width, on.height);
    sideBySide(prefix, `${prefix}-off`, `${prefix}-on`);
    report.pairs.push({ diff, name: prefix, offDrift, ...pose });
    saveReport();
  }
};

/**
 * A valid A/B needs the same scene twice: an async vegetation bake that lands between the Off and
 * On draws otherwise shows up as a huge "bloom" difference (a whole tree popping in). Capture Off,
 * On, then Off again; a near-identical second Off proves the frame was stable for the pair. A star
 * twinkle or leaf edge may differ by a few pixels; a popped tree differs by thousands.
 */
const STABLE_DRIFT_PIXELS = 2000;

const captureStablePair = async (page: Page, prefix: string) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const off = await capture(page, `${prefix}-off`);
    await setBloom(page, true);
    const on = await capture(page, `${prefix}-on`);
    await setBloom(page, false);
    const check = await capture(page, `${prefix}-off-check`);
    const drift = differenceStats(off, check);
    if (drift.changed <= STABLE_DRIFT_PIXELS) return { off, offDrift: drift.changed, on };
    console.log(`${prefix}: scene drifted by ${drift.changed} px, settling and retrying`);
    await page.waitForTimeout(settleMs);
  }
  throw new Error(`${prefix}: scene never settled for a valid A/B pair`);
};

/** One Off frame, then every TUNES variant through the live tuning hook, with its statistics. */
const captureTunes = async (page: Page, prefix: string) => {
  const off = await capture(page, `${prefix}-off`);
  for (const { name, ...patch } of tunes) {
    // Every variant starts from the preset's values, not from the previous variant's.
    await page.evaluate(value => {
      const hook = (window as any).__bloomTuning;
      const defaults = (window as any).__bloomTuningDefaults ??= structuredClone(hook());
      const base = structuredClone(defaults);
      // `phases: { golden: { intensity: 0.4 } }` patches single phase values (BLOOM-REFINEMENT).
      const phases = Object.fromEntries(Object.entries(base.phases ?? {}).map(([name, phase]) =>
        [name, { ...(phase as object), ...(value.phases?.[name] ?? {}) }]));
      hook({ ...base, ...value, ...(base.phases ? { phases } : {}) });
    }, patch);
    await setBloom(page, true);
    const on = await capture(page, `${prefix}-${name}`);
    await setBloom(page, false);
    report.pairs.push({ diff: { ...differenceStats(off, on), ...hazeStats(off, on) }, name: `${prefix}-${name}`,
      patch });
    saveReport();
  }
};

const diffOnly = process.env.DIFF_ONLY === "1";
if (!diffOnly) {
  if (masterCompositor) {
    const source = execFileSync("git", [
      "show", "master:island-of-settlers-client/src/renderers/three/frame-compositor.ts"
    ], { cwd: clientRoot, encoding: "utf8" });
    // The lane's renderer imports the R11b dev hook; master predates it.
    writeFileSync(masterModulePath,
      `${source}\nexport const exposeBloomDevHook = () => () => {};\n`);
  }
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    for (const scene of scenes) for (const quality of qualities) {
      const page = await openPage(browser, url, quality);
      await pinScene(page, scene, stripDynamic);
      await capturePage(page, scene, quality);
      await page.close();
    }
  } finally {
    saveReport();
    await browser.close();
    await server.close();
    if (masterCompositor) rmSync(masterModulePath, { force: true });
  }
}
/** DIFF_DIR compares the shots of this run with an earlier run of the same names (cross-build parity). */
if (diffDir) {
  const shots = diffOnly
    ? JSON.parse(readFileSync(resolve(outputDir, "report.json"), "utf8")).shots
    : report.shots;
  for (const shot of shots) {
    const beforeBuffer: Buffer = readFileSync(resolve(diffDir, `${shot.name}.rgba`));
    const afterBuffer: Buffer = readFileSync(resolve(outputDir, `${shot.name}.rgba`));
    assert.equal(beforeBuffer.length, afterBuffer.length, `${shot.name}: raw size differs`);
    const before = { pixels: new Uint8Array(beforeBuffer) };
    const after = { pixels: new Uint8Array(afterBuffer) };
    const diff = differenceStats(before, after);
    writeDiffImage(outputDir, `${shot.name}-vs-before`, before, after, shot.width, shot.height);
    report.diff.push({ ...diff, name: shot.name });
    console.log("diff", shot.name, JSON.stringify(diff));
  }
  writeFileSync(resolve(outputDir, diffOnly ? "diff-report.json" : "report.json"),
    JSON.stringify(report, null, 2));
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots,", report.pairs.length, "pairs");
