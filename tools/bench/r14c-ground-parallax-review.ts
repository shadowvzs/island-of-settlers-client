import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

/**
 * R14c ground parallax review on a supplied save (read only): a frozen iso frame and frozen
 * possessed frames at sand, gravel, dirt and mine-gravel spots (close, normal and spyglass), each
 * with the parallax off and on, plus GPU timer A/B: the terrain draws alone and the whole frame,
 * off and on alternating per sample so shared-GPU load changes cancel in the paired difference.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080] [TIMING=1]
 *   [SAMPLES=60] [SPOTS=sand,mine] [EXTRA_SPOTS=name:x,z,yaw;...] npx tsx tools/bench/r14c-ground-parallax-review.ts
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const timing = process.env.TIMING !== "0";
const samples = Number(process.env.SAMPLES ?? 60);
const spotFilter = process.env.SPOTS?.split(",");
/** PROBE="from=>to" edits the terrain shader for the timing only (cost breakdown experiments). */
const probe = process.env.PROBE?.split("=>") ?? null;
/**
 * VARIANTS="name:from=>to|..." times the terrain alone for off, on and each edited shader in
 * rotation under the same GPU load (cost breakdown; no captures are compared).
 */
const variants = (process.env.VARIANTS ?? "").split("|").filter(Boolean).map(entry => {
  const [name, edit] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
  const [from, to] = edit.split("=>");
  return { from: from!, name, to: to! };
});

interface Spot {
  name: string;
  x: number;
  yaw: number;
  z: number;
}

const extraSpots: Spot[] = (process.env.EXTRA_SPOTS ?? "").split(";").filter(Boolean).map(entry => {
  const [name, values] = entry.split(":");
  const [x, z, yaw] = values!.split(",").map(Number);
  return { name: name!, x: x!, yaw: yaw!, z: z! };
});
/** Views per spot: pitch (radians, up positive) and the spyglass field of view. */
const VIEWS = [
  { name: "close", pitch: -0.6, spyglass: false },
  { name: "normal", pitch: -0.18, spyglass: false },
  { name: "spyglass", pitch: -0.07, spyglass: true }
];
mkdirSync(outputDir, { recursive: true });
const saveText = readFileSync(sourcePath, "utf8");
const save = JSON.parse(saveText);
Object.assign(save.runtime.environment, { cycling: false, targetHour: save.runtime.environment.hour,
  weatherState: "clear" });
const stagedSave = JSON.stringify(save);
const report: Record<string, any> = { device: [], diffs: [], spots: [], timing: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

const patchRoutes = async (page: Page) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    const body = patchAtmosphereLiveCost(await response.text()).replace("atmosphereDebug.api = result;",
      "atmosphereDebug.world = world; atmosphereDebug.terrainMaterial = terrainMaterial; atmosphereDebug.api = result;");
    await route.fulfill({ body, response });
  });
  await page.route("**/exploration-weather-adapter.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({ body: patchAtmosphereWeatherClock(await response.text()), response });
  });
};

const openPage = async (browser: Browser, url: string, quality: string) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: height!, width: width! } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 600));
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

/** Strips moving actors from a frozen frame so off/on captures differ only by the ground. */
const stripFrame = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, frame = debug.frozenFrame;
  Object.assign(frame.environment, { rain: 0, snow: 0 });
  for (const key of ["handcarts", "militaryArrows", "mounts", "ships", "shuttleBoats", "transportHorses", "workers"])
    frame[key] = [];
  for (const key of ["animals", "birds", "butterflies", "critters"]) if (frame[key]) frame[key].count = 0;
  if (frame.exploration) frame.exploration.smoke = null;
  frame.time = 12;
});

/** Freezes a snapshot of the last live frame (the debug draw then repeats it). */
const freezeFrame = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { snapshotAtmosphereFrame } = await import(
    /* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
  debug.frozenFrame = snapshotAtmosphereFrame(debug.lastFrame);
  debug.frozen = true;
});

const freezeIso = async (page: Page) => {
  await page.waitForTimeout(1500);
  await freezeFrame(page);
  await stripFrame(page);
};

const freezePossessed = async (page: Page) => {
  await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.frozen = false;
  });
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed",
    null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const live = (window as any).__settlement, held = live.update(0);
    live.update = () => held;
  });
  await freezeFrame(page);
  await stripFrame(page);
};

/** Strongest sand, gravel, dirt and mine-gravel patches near the start, seen from 4 units back. */
const findSpots = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, world = debug.world;
  const start = debug.frozenFrame.exploration.camera.pose;
  const MATERIALS = 9, stride = world.cellsX + 1;
  const weight = (layer: number, x: number, z: number) => {
    const vx = Math.round(x), vz = Math.round(z);
    if (vx < 0 || vz < 0 || vx > world.cellsX || vz > world.cellsZ) return 0;
    return world.splat[(vz * stride + vx) * MATERIALS + layer] / 255;
  };
  const patch = (layer: number, x: number, z: number) => {
    let sum = 0;
    for (let dz = -3; dz <= 3; dz += 1.5) for (let dx = -3; dx <= 3; dx += 1.5) sum += weight(layer, x + dx, z + dz);
    return sum;
  };
  const buildings = (debug.frozenFrame.buildings ?? []) as { x: number; z: number }[];
  const nearBuilding = (x: number, z: number, radius: number) =>
    buildings.some(building => Math.hypot(building.x - x, building.z - z) < radius);
  const isWater = (x: number, z: number) => {
    const vx = Math.round(x), vz = Math.round(z);
    return (world.heights[vz * stride + vx] ?? 0) < world.seaLevel + 0.3;
  };
  const spots: { name: string; x: number; yaw: number; z: number }[] = [];
  for (const [name, layer] of [["sand", 4], ["gravel", 7], ["dirt", 3], ["mine", 8]] as const) {
    let best = { score: 0.5, x: 0, z: 0 };
    for (let z = start.z - 140; z < start.z + 140; z += 2) for (let x = start.x - 140; x < start.x + 140; x += 2) {
      if (weight(layer, x, z) < 0.7 || nearBuilding(x, z, 9) || isWater(x, z)) continue;
      const score = patch(layer, x, z) - Math.hypot(x - start.x, z - start.z) * 0.01;
      if (score > best.score) best = { score, x, z };
    }
    if (best.score <= 0.5) continue;
    let bestYaw = 0, bestRay = -1;
    for (let index = 0; index < 16; index++) {
      const yaw = (index / 16) * Math.PI * 2;
      let ray = 0;
      for (let step = -4; step <= 6; step += 1) ray += weight(layer, best.x + Math.sin(yaw) * step, best.z + Math.cos(yaw) * step);
      if (ray > bestRay) { bestRay = ray; bestYaw = yaw; }
    }
    spots.push({ name, x: best.x - Math.sin(bestYaw) * 4, yaw: bestYaw, z: best.z - Math.cos(bestYaw) * 4 });
  }
  return spots;
});

const setView = (page: Page, spot: Spot, view: typeof VIEWS[number]) => page.evaluate(async ({ spot, view }) => {
  const { explorationSpyglassFieldOfView } = await import(/* @vite-ignore */ String("/src/app/exploration/movement.ts"));
  const { EXPLORATION_FIELD_OF_VIEW } = await import(
    /* @vite-ignore */ String("/src/render-common/exploration/exploration-frame.ts"));
  const pose = (window as any).__atmosphereLiveDebug.frozenFrame.exploration.camera.pose;
  delete pose.eyeBaseY;
  const fov = view.spyglass ? explorationSpyglassFieldOfView(Number.NaN) : EXPLORATION_FIELD_OF_VIEW;
  Object.assign(pose, { fov, pitch: view.pitch, x: spot.x, yaw: spot.yaw, z: spot.z });
}, { spot, view });

const setParallax = (page: Page, on: boolean) => page.evaluate(on => {
  const material = (window as any).__atmosphereLiveDebug.terrainMaterial;
  const has = material.defines?.GROUND_PARALLAX !== undefined;
  if (has === on) return;
  material.defines = { ...material.defines };
  if (on) material.defines.GROUND_PARALLAX = "";
  else delete material.defines.GROUND_PARALLAX;
  material.needsUpdate = true;
}, on);

const drawFrames = (page: Page, count: number) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug;
  for (let index = 0; index < count; index++) {
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, count);

const capture = async (page: Page, name: string) => {
  await drawFrames(page, 20);
  const image = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.draw();
    return debug.renderer.domElement.toDataURL("image/png") as string;
  });
  const bytes = Buffer.from(image.split(",")[1]!, "base64");
  writeFileSync(resolve(outputDir, `${name}.png`), bytes);
  return image;
};

/** Changed pixels between two captures (decoded in the page): count, max channel delta, > 8. */
const diffImages = (page: Page, first: string, second: string) => page.evaluate(async ({ first, second }) => {
  const decode = async (source: string) => {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
  const [a, b] = [await decode(first), await decode(second)];
  let changed = 0, max = 0, strong = 0;
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(Math.abs(a[index]! - b[index]!), Math.abs(a[index + 1]! - b[index + 1]!),
      Math.abs(a[index + 2]! - b[index + 2]!));
    if (delta > 0) changed++;
    if (delta > 8) strong++;
    max = Math.max(max, delta);
  }
  return { changed, max, strong };
}, { first, second });

const captureStates = async (page: Page, quality: string, name: string) => {
  await setParallax(page, false);
  const off = await capture(page, `${quality}-${name}-off`);
  if (quality === "minimal") return;
  await setParallax(page, true);
  const on = await capture(page, `${quality}-${name}-on`);
  report.diffs.push({ name: `${quality}-${name}`, ...(await diffImages(page, off, on)) });
};

/**
 * GPU time with the parallax off and on, alternating per sample: the terrain meshes drawn alone (no
 * occluders: an upper bound of the ground's share) and the whole frame.
 */
const timeParallax = (page: Page, count: number) => page.evaluate(async ({ count, probe }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), material = debug.terrainMaterial;
  if (!ext) return null;
  const source = material.fragmentShader;
  if (probe) {
    if (!source.includes(probe[0])) return { error: `probe not found: ${probe[0]}` };
    material.fragmentShader = source.replace(probe[0], probe[1]);
  }
  debug.draw();
  const terrainMeshes: any[] = [];
  for (const scene of debug.scenes ?? [])
    scene.traverse((object: any) => { if (object.material === material) terrainMeshes.push(object); });
  if (!terrainMeshes.length) return { error: "terrain meshes not found" };
  let mainScene = terrainMeshes[0];
  while (mainScene.parent) mainScene = mainScene.parent;
  const SceneClass = mainScene.constructor, alone = new SceneClass();
  const setOn = (on: boolean) => {
    material.defines = { ...material.defines };
    if (on) material.defines.GROUND_PARALLAX = "";
    else delete material.defines.GROUND_PARALLAX;
    material.needsUpdate = true;
  };
  const query = async (run: () => void) => {
    const handle = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, handle);
    run();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    let result = Number.NaN;
    for (let wait = 0; wait < 60 && Number.isNaN(result); wait++) {
      await new Promise(done => requestAnimationFrame(done));
      if (gl.getQueryParameter(handle, gl.QUERY_RESULT_AVAILABLE))
        result = gl.getParameter(ext.GPU_DISJOINT_EXT) ? Infinity : gl.getQueryParameter(handle, gl.QUERY_RESULT) / 1e6;
    }
    gl.deleteQuery(handle);
    return result;
  };
  const timeAlone = (on: boolean) => {
    setOn(on);
    debug.draw();
    const parents = terrainMeshes.map(mesh => mesh.parent);
    // Eight draws per query: the per-draw time keeps the timer and scheduling noise eight times smaller.
    return query(() => {
      for (const mesh of terrainMeshes) alone.add(mesh);
      for (let repeat = 0; repeat < 8; repeat++) debug.renderer.render(alone, debug.camera);
      terrainMeshes.forEach((mesh, index) => parents[index].add(mesh));
    }).then(total => total / 8);
  };
  const timeFrame = (on: boolean) => { setOn(on); return query(() => debug.draw()); };
  const collect = async (time: (on: boolean) => Promise<number>) => {
    const off: number[] = [], on: number[] = [], delta: number[] = [];
    for (let index = 0; index < 4; index++) await time(index % 2 === 0);
    for (let pair = 0; pair < count; pair++) {
      const first = pair % 2 === 0;
      const a = await time(first), b = await time(!first);
      const [onMs, offMs] = first ? [a, b] : [b, a];
      if (!Number.isFinite(offMs) || !Number.isFinite(onMs)) continue;
      off.push(offMs); on.push(onMs); delta.push(onMs - offMs);
    }
    const quantile = (values: number[], q: number) =>
      [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * q)] ?? 0;
    return { count: delta.length, deltaMedian: quantile(delta, 0.5), deltaP25: quantile(delta, 0.25),
      deltaP75: quantile(delta, 0.75), offMedian: quantile(off, 0.5), onMedian: quantile(on, 0.5) };
  };
  const result = { frame: await collect(timeFrame), terrainAlone: await collect(timeAlone),
    terrainMeshes: terrainMeshes.length };
  material.fragmentShader = source;
  setOn(true);
  return result;
}, { count, probe });

/** Terrain-alone GPU time of off, on and the VARIANTS shaders, rotated per round (median per shader). */
const timeVariants = (page: Page, count: number) => page.evaluate(async ({ count, variants }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), material = debug.terrainMaterial;
  const source = material.fragmentShader;
  const missing = variants.find(variant => !source.includes(variant.from));
  if (missing) return { error: `variant edit not found: ${missing.name}` };
  const shaders = [{ name: "off", on: false, source }, { name: "on", on: true, source },
    ...variants.map(variant => ({ name: variant.name, on: true, source: source.replace(variant.from, variant.to) }))];
  const terrainMeshes: any[] = [];
  for (const scene of debug.scenes ?? [])
    scene.traverse((object: any) => { if (object.material === material) terrainMeshes.push(object); });
  let root = terrainMeshes[0];
  while (root.parent) root = root.parent;
  const alone = new root.constructor();
  const applyShader = (shader: typeof shaders[number]) => {
    material.defines = { ...material.defines };
    if (shader.on) material.defines.GROUND_PARALLAX = "";
    else delete material.defines.GROUND_PARALLAX;
    material.fragmentShader = shader.source;
    material.needsUpdate = true;
  };
  const time = async (shader: typeof shaders[number]) => {
    applyShader(shader);
    debug.draw();
    const parents = terrainMeshes.map(mesh => mesh.parent), handle = gl.createQuery();
    for (const mesh of terrainMeshes) alone.add(mesh);
    gl.beginQuery(ext.TIME_ELAPSED_EXT, handle);
    for (let repeat = 0; repeat < 8; repeat++) debug.renderer.render(alone, debug.camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    terrainMeshes.forEach((mesh, index) => parents[index].add(mesh));
    let result = Number.NaN;
    for (let wait = 0; wait < 60 && Number.isNaN(result); wait++) {
      await new Promise(done => requestAnimationFrame(done));
      if (gl.getQueryParameter(handle, gl.QUERY_RESULT_AVAILABLE))
        result = gl.getParameter(ext.GPU_DISJOINT_EXT) ? Infinity : gl.getQueryParameter(handle, gl.QUERY_RESULT) / 8e6;
    }
    gl.deleteQuery(handle);
    return result;
  };
  for (const shader of shaders) await time(shader);
  const deltas = shaders.map(() => [] as number[]);
  for (let round = 0; round < count; round++) {
    const times: number[] = [];
    for (let index = 0; index < shaders.length; index++) {
      const shaderIndex = (index + round) % shaders.length;
      times[shaderIndex] = await time(shaders[shaderIndex]!);
    }
    if (times.every(Number.isFinite)) times.forEach((value, index) => deltas[index]!.push(value - times[0]!));
  }
  applyShader(shaders[1]!);
  const quantile = (values: number[], q: number) =>
    [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * q)] ?? 0;
  return Object.fromEntries(shaders.map((shader, index) => [shader.name, {
    p25: quantile(deltas[index]!, 0.25), median: quantile(deltas[index]!, 0.5), p75: quantile(deltas[index]!, 0.75)
  }]));
}, { count, variants });

const reviewQuality = async (browser: Browser, url: string, quality: string) => {
  const { context, page } = await openPage(browser, url, quality);
  await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    const nativeRender = debug.renderer.render;
    debug.renderer.render = function(scene: any, camera: any) {
      (debug.scenes ??= new Set()).add(scene);
      return nativeRender.call(this, scene, camera);
    };
  });
  await freezeIso(page);
  await captureStates(page, quality, "iso");
  await freezePossessed(page);
  const spots = [...await findSpots(page), ...extraSpots]
    .filter(spot => !spotFilter || spotFilter.includes(spot.name));
  report.spots.push({ quality, spots });
  for (const spot of spots) {
    for (const view of VIEWS) {
      await setView(page, spot, view);
      await captureStates(page, quality, `${spot.name}-${view.name}`);
    }
    if (variants.length > 0 && quality !== "minimal") {
      await setView(page, spot, VIEWS[0]!);
      report.timing.push({ spot: spot.name, variants: await timeVariants(page, samples), view: "close" });
      saveReport();
      continue;
    }
    if (timing && quality !== "minimal") {
      await setView(page, spot, VIEWS[0]!);
      report.timing.push({ quality, spot: spot.name, view: "close", ...(await timeParallax(page, samples)) });
      await setView(page, spot, VIEWS[1]!);
      report.timing.push({ quality, spot: spot.name, view: "normal", ...(await timeParallax(page, samples)) });
    }
    saveReport();
  }
  report.device.find((entry: any) => entry.quality === quality).programs = await page.evaluate(() =>
    (window as any).__atmosphereLiveDebug.linkedSky().filter((program: any) => program.kind === "terrain").length);
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
