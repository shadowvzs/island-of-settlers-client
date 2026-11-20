import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { launchBrowser, startDevServer } from "./browser";
import { installFrameProfiler, stageStartupSave } from "./frame-profile";

/**
 * R16b: possessed walk and ride through the owner's town. The strategic zoom is set first (default
 * 1.2, the simple recipe), then the eye follows WAYPOINTS at each of SPEEDS (units/s) while every rAF
 * interval, the building layer's update and the number of recipe swaps per frame are recorded. Still
 * eye poses (SHOTS: fractions of the route) are captured and GPU-timed (`?passes=1`).
 * RADII lists the building eye radius per pass in the same page: `0` is master's rule (the strategic
 * zoom decides in the possessed view too), `preset` the quality preset's radius, a number overrides it.
 * The save is only read; the staged copy pins clear weather and its hour.
 *
 *   OWNER_SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITY=high] [STRATEGY_ZOOM=1.2] [SPEEDS=5,12]
 *   [WAYPOINTS=x,z;x,z;...] [RADII=0,preset,0,preset] [SHOTS=0.1,0.25,0.4] [ISO_CENTER=168,68] [GPU_MS=3000]
 *   [REPORT_TAG=run] [UNCAPPED=1] [PROBE=1] (only the iso shot at the route start and STRATEGY_ZOOM)
 *   npx tsx tools/bench/building-eye-detail-walk.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const quality = process.env.QUALITY ?? "high";
const strategyZoom = Number(process.env.STRATEGY_ZOOM ?? 1.2);
const speeds = (process.env.SPEEDS ?? "5,12").split(",").map(Number);
const radii = (process.env.RADII ?? "0,preset,0,preset").split(",");
const shots = (process.env.SHOTS ?? "0.1,0.25,0.4").split(",").map(Number);
const gpuMs = Number(process.env.GPU_MS ?? 3000);
const tag = process.env.REPORT_TAG ?? "run";
/** Default: from the island's south shore (~80 units out) along the roads to the north end and back. */
const outward = "128,136;140,112;149,97;164.5,96.5;168.5,95.5;168.5,78.5;165.5,78.5;165.5,63.5;179.5,63.5;" +
  "179.5,47;183,47;183,40.5;179.5,40;179.5,26.5;162.5,26.5";
const parseRoute = (text: string) => text.split(";").map(point => point.split(",").map(Number) as [number, number]);
const route = process.env.WAYPOINTS ? parseRoute(process.env.WAYPOINTS)
  : [...parseRoute(outward), ...parseRoute(outward).reverse().slice(1)];
mkdirSync(outputDir, { recursive: true });

const stagedSave = () => {
  const save = JSON.parse(saveText);
  Object.assign(save.runtime.environment, { cloudCover: .35, cycling: false, rain: 0, snow: 0, targetRain: 0,
    targetHour: save.runtime.environment.hour, targetSnow: 0, weatherState: "clear", weatherTimer: 1e9 });
  return JSON.stringify(save);
};

/** Exposes the building layer and makes the eye radius switchable per pass (`__r16bRadius`). */
const patchRenderer = (source: string) => {
  assert(source.includes("quality.buildingEyeDetailRadius"));
  return source.replace("const passNames", "window.__r16b = { buildings, world }; const passNames")
    .replace("quality.buildingEyeDetailRadius", "(globalThis.__r16bRadius ?? quality.buildingEyeDetailRadius)");
};

/** Route position and travel yaw at `fraction` (0..1) of the polyline length. */
const routePose = (fraction: number) => {
  const lengths = route.slice(1).map((point, index) =>
    Math.hypot(point[0] - route[index]![0], point[1] - route[index]![1]));
  let left = fraction * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    const [ax, az] = route[index]!, [bx, bz] = route[index + 1]!;
    if (left > lengths[index]! && index < lengths.length - 1) { left -= lengths[index]!; continue; }
    const t = Math.min(1, left / lengths[index]!);
    return { x: ax + (bx - ax) * t, yaw: Math.atan2(bx - ax, bz - az), z: az + (bz - az) * t };
  }
  throw new Error("empty route");
};

/** Wraps the exploration camera boundary: while `__r16bPose` is set, the eye stands there. */
const installPoseOverride = (page: Page) => page.evaluate(() => {
  const root = window as any;
  const camera = root.__exploration.camera;
  const original = camera.setPose;
  camera.setPose = (pose: any, blend?: number) => original(pose && root.__r16bPose
    ? { ...pose, ...root.__r16bPose, eyeBaseY: undefined, mode: "eye", pitch: -.06 } : pose, blend);
});

const setRadius = (page: Page, radius: string) => page.evaluate(value => {
  (globalThis as any).__r16bRadius = value === "preset" ? undefined : Number(value);
}, radius);

const detailedCount = (page: Page) => page.evaluate(() => {
  const { buildings } = (window as any).__r16b;
  let count = 0;
  for (let uid = 0; uid < 64; uid++) if (buildings.isDetailed(`settlement-${uid}`)) count++;
  return count;
});

/** Walks the route at `speed` units/s in the page; per frame: interval, CPU stages, recipe swaps. */
const walk = (page: Page, speed: number) => page.evaluate(async ({ points, speed }) => {
  const root = window as any;
  const { buildings } = root.__r16b;
  const lengths = points.slice(1).map((point: number[], index: number) =>
    Math.hypot(point[0]! - points[index]![0]!, point[1]! - points[index]![1]!));
  const total = lengths.reduce((sum: number, length: number) => sum + length, 0);
  const poseAt = (distance: number) => {
    let left = Math.min(distance, total);
    for (let index = 0; index < lengths.length; index++) {
      const length = lengths[index]!;
      if (left > length && index < lengths.length - 1) { left -= length; continue; }
      const [ax, az] = points[index]!, [bx, bz] = points[index + 1]!;
      const t = Math.min(1, left / length);
      return { x: ax! + (bx! - ax!) * t, yaw: Math.atan2(bx! - ax!, bz! - az!), z: az! + (bz! - az!) * t };
    }
    return root.__r16bPose;
  };
  const shown = () => {
    const ids: boolean[] = [];
    for (let uid = 0; uid < 64; uid++) ids.push(buildings.isDetailed(`settlement-${uid}`) === true);
    return ids;
  };
  const samples: { buildings: number; cpu: number; detailed: number; dt: number; swaps: number;
    top?: string }[] = [];
  /** The three costliest loop stages of a slow frame. */
  const topStages = (timings: Record<string, number>) => Object.entries(timings)
    .filter(([name]) => name !== "cpu").sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, ms]) => `${name}:${ms.toFixed(1)}`).join(" ");
  let previous = shown(), last = performance.now(), travelled = 0;
  while (travelled < total) {
    const now = await new Promise<number>(done => requestAnimationFrame(done));
    const dt = now - last;
    last = now;
    const current = shown();
    const timings = root.__ownerTimings ?? {};
    samples.push({ buildings: timings.buildings ?? 0, cpu: timings.cpu ?? 0,
      detailed: current.filter(Boolean).length, dt,
      swaps: current.filter((value, index) => value !== previous[index]).length,
      top: timings.cpu > 16 ? topStages(timings) : undefined });
    previous = current;
    travelled += speed * Math.min(dt, 100) / 1000;
    root.__r16bPose = poseAt(travelled);
  }
  return samples;
}, { points: route, speed });

type Sample = Awaited<ReturnType<typeof walk>>[number];
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

/** Frames of a swap (and the next one) against all other frames of the same pass. */
const summarize = (samples: Sample[]) => {
  const all = samples.slice(2);
  const swapFrames = new Set<number>();
  all.forEach((sample, index) => { if (sample.swaps) { swapFrames.add(index); swapFrames.add(index + 1); } });
  const near = all.filter((_, index) => swapFrames.has(index));
  const other = all.filter((_, index) => !swapFrames.has(index));
  const worst = (list: Sample[], key: Exclude<keyof Sample, "top">) => Math.max(0, ...list.map(sample => sample[key]));
  const over16 = (list: Sample[]) => list.filter(sample => sample.dt > 16.7).length;
  /** Leading loop stage of the slow (CPU > 16 ms) frames, counted per stage name. */
  const causes = (list: Sample[]) => {
    const counts: Record<string, number> = {};
    for (const sample of list) {
      const stage = sample.top?.split(":")[0];
      if (stage) counts[stage] = (counts[stage] ?? 0) + 1;
    }
    return counts;
  };
  return {
    frames: all.length, maxDetailed: worst(all, "detailed"), swaps: all.reduce((sum, sample) => sum + sample.swaps, 0),
    swapFrames: near.length, swapFramesOver16: over16(near), otherFramesOver16: over16(other),
    worstBuildingsMsSwap: worst(near, "buildings"), worstBuildingsMsOther: worst(other, "buildings"),
    worstCpuSwap: worst(near, "cpu"), worstCpuOther: worst(other, "cpu"),
    worstDtSwap: worst(near, "dt"), worstDtOther: worst(other, "dt"),
    p50Dt: percentile(all.map(sample => sample.dt), .5), p99Dt: percentile(all.map(sample => sample.dt), .99),
    p99BuildingsMs: percentile(all.map(sample => sample.buildings), .99),
    slowCausesOther: causes(other), slowCausesSwap: causes(near),
    slowSwapFrames: near.filter(sample => sample.top).map(sample => `${sample.dt.toFixed(0)}ms ${sample.top}`)
  };
};

/** GPU and CPU per frame over GPU_MS at the current (still) eye. */
const measureGpu = (page: Page) => page.evaluate(async milliseconds => {
  const profiler = (globalThis as any).__frameProfiler;
  profiler.resetSession();
  await new Promise(done => setTimeout(done, milliseconds));
  const report = profiler.sessionReport();
  const pass = (name: string) => report.passes.find((entry: any) => entry.name === name);
  const brief = (name: string) => {
    const entry = pass(name);
    return entry ? { drawCalls: entry.drawCalls, gpuMs: entry.gpuMs, triangles: entry.triangles } : null;
  };
  return { buildings: brief("buildings"), frameCpuMs: report.frameCpuMs, frameGpuMs: report.frameGpuMs,
    frames: report.frames, shadows: brief("shadows"), world: brief("world") };
}, gpuMs);

const stillShots = async (page: Page, label: string) => {
  const rows = [];
  for (const fraction of shots) {
    await page.evaluate(pose => { (window as any).__r16bPose = pose; }, routePose(fraction));
    await page.waitForTimeout(2500);
    const name = `${quality}-${label}-at${fraction}`;
    await page.screenshot({ path: resolve(outputDir, `${name}.png`) });
    rows.push({ detailed: await detailedCount(page), fraction, name, ...await measureGpu(page) });
  }
  return rows;
};

const openGame = async (url: string, errors: string[]) => {
  const browser = await launchBrowser(process.env.UNCAPPED === "1");
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 900, width: 1600 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value");
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY, value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, stagedSave());
  await installFrameProfiler(page, patchRenderer);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&passes=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  return { browser, page };
};

/** PROBE: every 4th terrain vertex height and the sea level, for planning a route on land. */
const writeHeights = async (page: Page) => {
  const heights = await page.evaluate(() => {
    const { world } = (window as any).__r16b;
    const rows: number[][] = [];
    for (let z = 0; z <= world.cellsZ; z += 4) {
      const row: number[] = [];
      for (let x = 0; x <= world.cellsX; x += 4) row.push(Math.round(world.heights[z * (world.cellsX + 1) + x] * 10) / 10);
      rows.push(row);
    }
    return { cellsX: world.cellsX, cellsZ: world.cellsZ, rows, seaLevel: world.seaLevel, step: 4 };
  });
  writeFileSync(resolve(outputDir, `${tag}-heights.json`), JSON.stringify(heights));
};

const enterTown = async (page: Page) => {
  const [startX, startZ] = (process.env.ISO_CENTER ?? "168,68").split(",").map(Number);
  await page.evaluate(({ x, z, zoom }) => {
    const camera = (window as any).__ownerCamera;
    camera.centerX = x; camera.centerZ = z; camera.zoom = zoom;
  }, { x: startX, z: startZ, zoom: strategyZoom });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: resolve(outputDir, `${quality}-${tag}-iso-before.png`) });
  if (process.env.PROBE === "1") return writeHeights(page);
  await installPoseOverride(page);
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null,
    { timeout: 60_000 });
  await page.waitForTimeout(3000);
};

const { server, url } = await startDevServer();
const errors: string[] = [];
const { browser, page } = await openGame(url, errors);
try {
  await enterTown(page);
  const passes = [];
  for (const [index, radius] of (process.env.PROBE === "1" ? [] : radii).entries()) {
    await setRadius(page, radius);
    const label = `${tag}-r${radius}-${index}`;
    const still = await stillShots(page, label);
    const walks = [];
    for (const speed of speeds) {
      await page.evaluate(pose => { (window as any).__r16bPose = pose; }, routePose(0));
      await page.waitForTimeout(2500);
      const samples = await walk(page, speed);
      walks.push({ speed, summary: summarize(samples), samples });
    }
    passes.push({ radius, still, walks });
    console.log(JSON.stringify({ radius, still: still.map(({ buildings, detailed, frameGpuMs, name }) =>
      ({ buildings, detailed, frameGpuMs, name })), walks: walks.map(({ speed, summary }) => ({ speed, summary })) },
    null, 1));
  }
  await page.evaluate(() => {
    (window as any).__r16bPose = undefined;
    (window as any).__exploration.controller.forceExit("leave");
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: resolve(outputDir, `${quality}-${tag}-iso-after.png`) });
  writeFileSync(resolve(outputDir, `${quality}-${tag}.json`), JSON.stringify({ errors, passes, quality, route,
    strategyZoom }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
assert.deepEqual(errors, []);
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
