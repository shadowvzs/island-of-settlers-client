import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";
import { findReviewSpots, type ReviewSpot } from "./t07-grass-ring-spots";

/**
 * T07 grass ring review on a supplied save (read only): frozen possessed frames at a meadow, a
 * village path, a field edge and a shore, each with the ring off and on, plus interleaved GPU
 * timer A/B of the whole frame (ring off vs on) and an optional walking clip (WebM).
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,medium,minimal] [VIEWPORT=1920x1080]
 *   [PITCH=-0.12] [TIMING=1] [PAIRS=120] [EXTRA_SPOTS=name:x,z,yaw[,pitch];...] [CLIP=1] [SPOTS=meadow,shore]
 *   [RING_STATES=off,tufts,on] [CLIP_STATE=on|tufts]
 *   npx tsx tools/bench/t07-grass-ring-review.ts
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,medium,minimal").split(",");
const pitch = Number(process.env.PITCH ?? -0.12);
const timing = process.env.TIMING !== "0";
const pairs = Number(process.env.PAIRS ?? 120);
const clip = process.env.CLIP === "1";
const spotFilter = process.env.SPOTS?.split(",");
const ringStates = (process.env.RING_STATES ?? "off,on").split(",") as RingState[];
const clipState = (process.env.CLIP_STATE ?? "on") as RingState;
/** EXTRA_SPOTS=name:x,z,yaw[,pitch];... adds hand-picked spots (radians; pitch defaults to PITCH). */
const extraSpots: ReviewSpot[] = (process.env.EXTRA_SPOTS ?? "").split(";").filter(Boolean).map(entry => {
  const [name, values] = entry.split(":");
  const [x, z, yaw, spotPitch] = values!.split(",").map(Number);
  return { name: name!, x: x!, yaw: yaw!, z: z!, ...(spotPitch === undefined ? {} : { pitch: spotPitch }) };
});
mkdirSync(outputDir, { recursive: true });
const saveText = readFileSync(sourcePath, "utf8");
const save = JSON.parse(saveText);
Object.assign(save.runtime.environment, { cycling: false, targetHour: save.runtime.environment.hour,
  weatherState: "clear" });
const stagedSave = JSON.stringify(save);
const report: Record<string, any> = { device: [], spots: [], timing: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

const patchRoutes = async (page: Page) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    const body = patchAtmosphereLiveCost(await response.text())
      .replace("atmosphereDebug.lastFrame = frame;",
        "atmosphereDebug.lastFrame = frame; if (frame.roads?.length) atmosphereDebug.roads = frame.roads;")
      .replace("atmosphereDebug.api = result;",
      "atmosphereDebug.world = world; atmosphereDebug.grassRing = grassRing; " +
        "atmosphereDebug.shortGrassHole = vegetation.shortGrassHole; atmosphereDebug.api = result;");
    await route.fulfill({ body, response });
  });
  await page.route("**/exploration-weather-adapter.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({ body: patchAtmosphereWeatherClock(await response.text()), response });
  });
};

const openPage = async (browser: Browser, url: string, quality: string, video: boolean) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: height!, width: width! },
    ...(video ? { recordVideo: { dir: outputDir, size: { height: 720, width: 1280 } } } : {}) });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 400));
  });
  await patchRoutes(page);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY,
    value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, stagedSave, true);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  const renderer = await page.evaluate(() => {
    const gl = (window as any).__atmosphereLiveDebug.renderer.getContext();
    return gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL);
  });
  assert(/NVIDIA/.test(renderer), `Not the hardware GPU: ${renderer}`);
  report.device.push({ errors, quality, renderer });
  return { context, page };
};

/** Possesses, then holds the simulation and freezes a stripped possessed frame (pinned light). */
const freezePossessed = async (page: Page) => {
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed",
    null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
    const { snapshotAtmosphereFrame } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
    const held = live.update(0);
    live.update = () => held;
    const frame = snapshotAtmosphereFrame(debug.lastFrame);
    Object.assign(frame.environment, { rain: 0, snow: 0 });
    for (const key of ["handcarts", "militaryArrows", "mounts", "ships", "shuttleBoats", "transportHorses", "workers"])
      frame[key] = [];
    for (const key of ["animals", "birds", "butterflies", "critters"]) if (frame[key]) frame[key].count = 0;
    if (frame.exploration) frame.exploration.smoke = null;
    debug.possessedFrame = frame;
    debug.frozenFrame = frame;
    debug.frozen = true;
    const ring = debug.grassRing, update = ring?.update;
    if (ring) ring.update = (view: unknown) => {
      update(debug.ringOff ? null : view);
      // OD-T6 "before": the ring with the master tufts (hole forced off, same pixels as master).
      if (debug.holeOff && debug.shortGrassHole) debug.shortGrassHole.w = 0;
    };
    debug.draw();
    frame.time = 12;
  });
};

const setSpot = (page: Page, spot: ReviewSpot) => page.evaluate(({ pitch, spot }) => {
  const pose = (window as any).__atmosphereLiveDebug.possessedFrame.exploration.camera.pose;
  delete pose.eyeBaseY;
  Object.assign(pose, { pitch: spot.pitch ?? pitch, x: spot.x, yaw: spot.yaw, z: spot.z });
}, { pitch, spot });

const drawFrames = (page: Page, count: number) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug;
  for (let index = 0; index < count; index++) {
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, count);

/** Ring states: off (no ring), tufts (ring over the master tufts), on (ring with the OD-T6 hole). */
type RingState = "off" | "on" | "tufts";

const setRing = (page: Page, state: RingState) => page.evaluate(state => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.ringOff = state === "off";
  debug.holeOff = state === "tufts";
}, state);

const capture = async (page: Page, name: string) => {
  await drawFrames(page, 30);
  const stats = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.draw();
    return { ...debug.lastDraw, image: debug.renderer.domElement.toDataURL("image/png") };
  });
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(stats.image.split(",")[1]!, "base64"));
  return { draws: stats.draws, name, triangles: stats.triangles };
};

/**
 * Paired GPU timer A/B of the whole frame: ring off and on alternate every frame, so slow load
 * changes of the shared GPU cancel in the per-pair difference (its median is the ring cost).
 */
const timeRing = (page: Page) => page.evaluate(async ({ pairs }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) return null;
  const timeFrame = async (off: boolean) => {
    debug.ringOff = off;
    const query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    debug.draw();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    let result = Number.NaN;
    for (let wait = 0; wait < 60 && Number.isNaN(result); wait++) {
      await new Promise(done => requestAnimationFrame(done));
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      result = gl.getParameter(ext.GPU_DISJOINT_EXT) ? Infinity : gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    }
    gl.deleteQuery(query);
    return result;
  };
  const off: number[] = [], on: number[] = [], delta: number[] = [];
  for (let index = 0; index < 6; index++) await timeFrame(index % 2 === 0);
  for (let pair = 0; pair < pairs; pair++) {
    const first = pair % 2 === 0;
    const a = await timeFrame(first), b = await timeFrame(!first);
    const [offMs, onMs] = first ? [a, b] : [b, a];
    if (!Number.isFinite(offMs) || !Number.isFinite(onMs)) continue;
    off.push(offMs); on.push(onMs); delta.push(onMs - offMs);
  }
  debug.ringOff = false;
  const quantile = (values: number[], q: number) =>
    [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * q)] ?? 0;
  return { count: delta.length, deltaMedian: quantile(delta, 0.5), deltaP25: quantile(delta, 0.25),
    deltaP75: quantile(delta, 0.75), medianOff: quantile(off, 0.5), medianOn: quantile(on, 0.5) };
}, { pairs });

/**
 * The ring's own draws, timed alone after a full frame (ring on): its meshes move into an otherwise
 * empty scene for the query. No scene depth is bound, so nothing occludes the blades: an upper bound.
 */
const timeRingAlone = (page: Page) => page.evaluate(async ({ samples }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), ring = debug.grassRing;
  if (!ext || !ring) return null;
  const mainScene = ring.root.parent, SceneClass = mainScene.constructor;
  const alone = new SceneClass(), empty = new SceneClass();
  const timeScene = async (scene: any) => {
    debug.ringOff = false;
    debug.draw();
    const query = gl.createQuery();
    if (scene === alone) alone.add(ring.root);
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    debug.renderer.render(scene, debug.camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    if (scene === alone) mainScene.add(ring.root);
    let result = Number.NaN;
    for (let wait = 0; wait < 60 && Number.isNaN(result); wait++) {
      await new Promise(done => requestAnimationFrame(done));
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        result = gl.getParameter(ext.GPU_DISJOINT_EXT) ? Infinity : gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    }
    gl.deleteQuery(query);
    return result;
  };
  const ringMs: number[] = [], emptyMs: number[] = [];
  for (let index = 0; index < samples; index++) {
    const ringTime = await timeScene(alone), emptyTime = await timeScene(empty);
    if (Number.isFinite(ringTime)) ringMs.push(ringTime);
    if (Number.isFinite(emptyTime)) emptyMs.push(emptyTime);
  }
  const quantile = (values: number[], q: number) =>
    [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * q)] ?? 0;
  return { emptyMedian: quantile(emptyMs, 0.5), ringMin: quantile(ringMs, 0), ringMedian: quantile(ringMs, 0.5),
    ringP25: quantile(ringMs, 0.25), ringP75: quantile(ringMs, 0.75), samples: ringMs.length };
}, { samples: pairs });

/**
 * OD-T6: the short-grass tuft draws timed alone after a full frame (ring on), with the ring hole
 * as drawn and with the hole forced off (master tufts), alternating per sample. The short-grass
 * meshes are the ones whose material carries the active hole (uGrassHole.w > 0).
 */
const timeShortGrassAlone = (page: Page) => page.evaluate(async ({ samples }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), ring = debug.grassRing;
  if (!ext || !ring) return null;
  debug.ringOff = false;
  debug.draw();
  const mainScene = ring.root.parent, SceneClass = mainScene.constructor;
  const tufts: any[] = [];
  mainScene.traverse((object: any) => {
    if (object.isInstancedMesh && object.material?.uniforms?.uGrassHole?.value.w > 0) tufts.push(object);
  });
  if (!tufts.length) return null;
  const hole = tufts[0].material.uniforms.uGrassHole.value;
  const alone = new SceneClass();
  const timeTufts = async (holeOn: boolean) => {
    debug.draw();
    const blend = hole.w;
    if (!holeOn) hole.w = 0;
    const parents = tufts.map(mesh => mesh.parent);
    const visible = tufts.map(mesh => mesh.visible);
    for (const mesh of tufts) alone.add(mesh);
    const query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    debug.renderer.render(alone, debug.camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    tufts.forEach((mesh, index) => { parents[index].add(mesh); mesh.visible = visible[index]; });
    hole.w = blend;
    let result = Number.NaN;
    for (let wait = 0; wait < 60 && Number.isNaN(result); wait++) {
      await new Promise(done => requestAnimationFrame(done));
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        result = gl.getParameter(ext.GPU_DISJOINT_EXT) ? Infinity : gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    }
    gl.deleteQuery(query);
    return result;
  };
  const onMs: number[] = [], offMs: number[] = [];
  for (let index = 0; index < samples; index++) {
    const first = index % 2 === 0;
    const a = await timeTufts(first), b = await timeTufts(!first);
    const [on, off] = first ? [a, b] : [b, a];
    if (Number.isFinite(on)) onMs.push(on);
    if (Number.isFinite(off)) offMs.push(off);
  }
  const quantile = (values: number[], q: number) =>
    [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * q)] ?? 0;
  return { holeMedian: quantile(onMs, 0.5), holeP25: quantile(onMs, 0.25), holeP75: quantile(onMs, 0.75),
    meshes: tufts.length, noHoleMedian: quantile(offMs, 0.5), noHoleP25: quantile(offMs, 0.25),
    noHoleP75: quantile(offMs, 0.75), samples: onMs.length };
}, { samples: pairs });

/** Walks for 8 s, then rides for 5 s (wall clock): the eye moves every frame, the wind clock runs. */
const walk = (page: Page, spot: ReviewSpot) => page.evaluate(async spot => {
  const debug = (window as any).__atmosphereLiveDebug, frame = debug.possessedFrame;
  const pose = frame.exploration.camera.pose, startX = pose.x, startZ = pose.z, startTime = frame.time;
  const began = performance.now();
  for (let seconds = 0; seconds < 13; seconds = (performance.now() - began) / 1000) {
    const travelled = Math.min(seconds, 8) * 1.6 + Math.max(0, seconds - 8) * 4;
    pose.x = startX + Math.sin(spot.yaw) * travelled;
    pose.z = startZ + Math.cos(spot.yaw) * travelled;
    pose.yaw = spot.yaw + Math.sin(seconds * 0.7) * 0.35;
    frame.time = startTime + seconds;
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, spot);

/** CPU cost of the ring updates: a full refill (possession entry, terrain edit) and one-tile moves. */
const measureRingCpu = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, ring = debug.grassRing;
  if (!ring) return null;
  const pose = debug.possessedFrame.exploration.camera.pose;
  const view = { blend: 1, camera: debug.camera, eyeX: pose.x, eyeZ: pose.z, viewportHeight: 1080 };
  ring.invalidate();
  let started = performance.now();
  ring.update(view);
  const fullMs = performance.now() - started;
  const moves: number[] = [];
  for (let step = 1; step <= 8; step++) {
    view.eyeX = pose.x + step * 2;
    started = performance.now();
    ring.update(view);
    moves.push(performance.now() - started);
  }
  ring.invalidate();
  return { fullMs, moveMaxMs: Math.max(...moves), moveMedianMs: [...moves].sort((a, b) => a - b)[4] };
});

const reviewQuality = async (browser: Browser, url: string, quality: string) => {
  const video = clip && quality === "high";
  const { context, page } = await openPage(browser, url, quality, video);
  await freezePossessed(page);
  report.cpu = { ...report.cpu, [quality]: await measureRingCpu(page) };
  const spots = [...await page.evaluate(findReviewSpots), ...extraSpots]
    .filter(spot => !spotFilter || spotFilter.includes(spot.name));
  report.spots.push({ quality, spots });
  for (const spot of spots) {
    await setSpot(page, spot);
    for (const state of ringStates) {
      await setRing(page, state);
      report.spots.push({ quality, ...(await capture(page, `${quality}-${spot.name}-${state}`)) });
    }
    if (timing && quality !== "minimal") report.timing.push({ alone: await timeRingAlone(page), quality,
      shortGrass: await timeShortGrassAlone(page), spot: spot.name, ...(await timeRing(page)) });
    saveReport();
  }
  if (video && spots[0]) {
    await setSpot(page, spots[0]);
    await setRing(page, clipState);
    await walk(page, spots[0]);
    report.clip = await page.video()?.path();
  }
  await context.close();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
try {
  for (const quality of qualities) await reviewQuality(browser, url, quality);
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done");
