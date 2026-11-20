import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";
import { stageQualityOverrides } from "./frozen-frame-review";

/**
 * R06c sun shaft review on a supplied save (read only): a frozen iso frame (parity) and frozen
 * possessed frames in the densest forest near the start (dawn toward and across the sun, noon)
 * and behind a building at dusk, each with the shafts off and on; a small yaw sweep (shimmer);
 * GPU timing of the pass replayed alone and of whole frames, off/on alternating per sample.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080] [TIMING=1]
 *   [SAMPLES=40] [TUNING='{"intensity":0.06}'] [OVERRIDES='{"sunRays":200}'] [SHOTS=dawn-forest-sun]
 *   [SHIMMER=0] npx tsx tools/bench/r06c-god-rays-review.ts
 *
 * OVERRIDES stores Settings > Graphics overrides first (the Sun rays slider's real path; at 0 %
 * there is no pass and no hook, so "off" and "on" are the same frame).
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const timing = process.env.TIMING !== "0";
const samples = Number(process.env.SAMPLES ?? 40);
const tuning = process.env.TUNING ? JSON.parse(process.env.TUNING) : null;
const qualityOverrides = process.env.OVERRIDES;
const shotNames = process.env.SHOTS?.split(",");
const shimmer = process.env.SHIMMER !== "0";
mkdirSync(outputDir, { recursive: true });
const saveText = readFileSync(sourcePath, "utf8");
const save = JSON.parse(saveText);
Object.assign(save.runtime.environment, { cloudCover: 0.45, cloudTargetExtra: 0, cycling: false, rain: 0,
  snow: 0, targetRain: 0, targetSnow: 0, weatherState: "clear" });
const stagedSave = JSON.stringify(save);
const report: Record<string, any> = { device: [], diffs: [], shimmer: [], spots: [], timing: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

interface Shot { hour: number; name: string; pitch: number; spot: "buildings" | "forest"; yawToSun: number }

/** yawToSun: 0 looks into the sun, π/2 across it. */
const ALL_SHOTS: Shot[] = [
  { hour: 6.7, name: "dawn-forest-sun", pitch: 0.06, spot: "forest", yawToSun: 0 },
  { hour: 6.7, name: "dawn-forest-side", pitch: 0.02, spot: "forest", yawToSun: Math.PI / 2 },
  { hour: 12, name: "noon-forest-sun", pitch: 0.06, spot: "forest", yawToSun: 0 },
  { hour: 17.4, name: "dusk-buildings-sun", pitch: 0.04, spot: "buildings", yawToSun: 0 }
];

const SHOTS = ALL_SHOTS.filter(shot => !shotNames || shotNames.includes(shot.name));
assert(SHOTS.length > 0, `No shot matches SHOTS=${process.env.SHOTS}`);

const patchRoutes = async (page: Page) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    const body = patchAtmosphereLiveCost(await response.text()).replace("atmosphereDebug.api = result;",
      "atmosphereDebug.world = world; atmosphereDebug.api = result;");
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
  if (qualityOverrides) await stageQualityOverrides(page, qualityOverrides);
  await stageStartupSave(page, url, stagedSave, true);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  const renderer = await page.evaluate(() => {
    const gl = (window as any).__atmosphereLiveDebug.renderer.getContext();
    return gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL);
  });
  assert(/NVIDIA/.test(renderer), `Not the hardware GPU: ${renderer}`);
  if (tuning) await page.evaluate(values => (window as any).__godRaysTuning?.(values), tuning);
  report.device.push({ errors, quality, renderer });
  return { context, page };
};

/** Freezes the last live frame without moving actors (the debug draw then repeats it). */
const freezeFrame = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { snapshotAtmosphereFrame } = await import(
    /* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
  const frame = snapshotAtmosphereFrame(debug.lastFrame);
  for (const key of ["handcarts", "militaryArrows", "mounts", "ships", "shuttleBoats", "transportHorses", "workers"])
    frame[key] = [];
  for (const key of ["animals", "birds", "butterflies", "critters"]) if (frame[key]) frame[key].count = 0;
  if (frame.exploration) frame.exploration.smoke = null;
  debug.frozenFrame = frame;
  debug.frozen = true;
});

const enterPossessed = async (page: Page) => {
  await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozen = false; });
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed",
    null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const live = (window as any).__settlement, held = live.update(0);
    live.update = () => held;
  });
  await freezeFrame(page);
};

/** The densest tree stand near the start and the building with the most open ground around it. */
const findSpots = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, world = debug.world, frame = debug.frozenFrame;
  const start = frame.exploration.camera.pose, props = world.props;
  const TREES = new Set([0, 1, 2, 18, 21, 22, 23, 24]);
  const trees: [number, number][] = [];
  for (let index = 0; index < props.count; index++) {
    if (TREES.has(props.types[index])) trees.push([props.x[index], props.z[index]]);
  }
  /** Visible (not only discovered) cells all around: the possessed veil hides the rest. */
  const visibleAround = (x: number, z: number, radius: number) => {
    for (let dz = -radius; dz <= radius; dz += 4) for (let dx = -radius; dx <= radius; dx += 4) {
      const cx = Math.round(x + dx), cz = Math.round(z + dz);
      if (cx < 0 || cz < 0 || cx >= world.cellsX || cz >= world.cellsZ) return false;
      if (world.fog[cz * world.cellsX + cx] !== 2) return false;
    }
    return true;
  };
  let forest = { count: 0, x: start.x, z: start.z };
  for (let z = start.z - 240; z < start.z + 240; z += 4) for (let x = start.x - 240; x < start.x + 240; x += 4) {
    const count = trees.filter(([tx, tz]) => Math.hypot(tx - x, tz - z) < 12).length;
    const near = trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.5);
    if (!near && count > forest.count && visibleAround(x, z, 16)) forest = { count, x, z };
  }
  const buildings = ((frame.buildings ?? []) as { x: number; z: number }[])
    .filter(building => visibleAround(building.x, building.z, 24));
  const neighbours = (centre: { x: number; z: number }) =>
    buildings.filter(other => Math.hypot(other.x - centre.x, other.z - centre.z) < 25).length;
  const building = buildings.reduce((best, next) => neighbours(next) > neighbours(best) ? next : best,
    buildings[0] ?? { x: start.x, z: start.z });
  return { building: { x: building.x, z: building.z }, forest, sun: world.sun };
});

/** Eye distance from the stand / building cluster centre, away from the sun (world units). */
const BACK_FOREST = Number(process.env.BACK_FOREST ?? 9);
const BACK_BUILDINGS = Number(process.env.BACK_BUILDINGS ?? 24);

/** Sets the frozen frame's clear-sky hour and the eye's pose for a shot. */
const setShot = (page: Page, shot: Shot, spots: Awaited<ReturnType<typeof findSpots>>, yawOffset = 0) =>
  page.evaluate(async ({ BACK_BUILDINGS, BACK_FOREST, shot, spots, yawOffset }) => {
    const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
    const debug = (window as any).__atmosphereLiveDebug, frame = debug.frozenFrame;
    frame.environment = computeEnvironment(spots.sun, shot.hour, 0, 0, 0.45, 0);
    const { azimuthX, azimuthZ } = frame.environment.sun;
    const toSun = Math.atan2(azimuthX, azimuthZ);
    const pose = frame.exploration.camera.pose;
    delete pose.eyeBaseY;
    // The stand or the buildings stand between the eye and the sun: the eye is in their shade.
    const centre = shot.spot === "forest" ? spots.forest : spots.building;
    const back = shot.spot === "forest" ? BACK_FOREST : BACK_BUILDINGS;
    const base = { x: centre.x - azimuthX * back, z: centre.z - azimuthZ * back };
    Object.assign(pose, { pitch: shot.pitch, x: base.x, yaw: toSun + shot.yawToSun + yawOffset, z: base.z });
  }, { BACK_BUILDINGS, BACK_FOREST, shot, spots, yawOffset });

const setGodRays = (page: Page, on: boolean) => page.evaluate(on => (window as any).__godRays?.(on), on);

const drawFrames = (page: Page, count: number) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug;
  for (let index = 0; index < count; index++) {
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, count);

const capture = async (page: Page, name: string) => {
  await drawFrames(page, 12);
  const image = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.draw();
    return debug.renderer.domElement.toDataURL("image/png") as string;
  });
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(image.split(",")[1]!, "base64"));
  return image;
};

/** Pixel delta statistics of two captures (decoded in the page). */
const diffImages = (page: Page, first: string, second: string) => page.evaluate(async ({ first, second }) => {
  const decode = async (source: string) => {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
  const [a, b] = [await decode(first), await decode(second)];
  let changed = 0, max = 0, strong = 0, sum = 0;
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(Math.abs(a[index]! - b[index]!), Math.abs(a[index + 1]! - b[index + 1]!),
      Math.abs(a[index + 2]! - b[index + 2]!));
    if (delta > 0) changed++;
    if (delta > 8) strong++;
    sum += delta;
    max = Math.max(max, delta);
  }
  return { changed, max, mean: sum / (a.length / 4), strong };
}, { first, second });

const captureStates = async (page: Page, quality: string, name: string) => {
  if (quality === "minimal") return capture(page, `${quality}-${name}`);
  await setGodRays(page, false);
  const off = await capture(page, `${quality}-${name}-off`);
  await setGodRays(page, true);
  const on = await capture(page, `${quality}-${name}-on`);
  const stats = await page.evaluate(() => (window as any).__atmosphereLiveDebug.api.stats?.());
  report.diffs.push({ name: `${quality}-${name}`, ...(await diffImages(page, off, on)),
    volumetricLight: stats?.volumetricLight });
  return on;
};

/** The blurred half-resolution shaft buffer as a signed grey image (scaled by its 99th percentile). */
const dumpShafts = async (page: Page, name: string) => {
  const image = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug, renderer = debug.renderer, gl = renderer.getContext();
    let last: any = null;
    const nativeRender = renderer.render;
    renderer.render = function(scene: any, camera: any) {
      if (scene.children[0]?.material?.uniforms?.uGodRayAxis) last = renderer.getRenderTarget();
      return nativeRender.call(this, scene, camera);
    };
    debug.draw();
    renderer.render = nativeRender;
    if (!last) return null;
    const { height, width } = last;
    const pixels = new Float32Array(width * height * 4);
    const framebuffer = renderer.properties.get(last).__webglFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const values = Array.from({ length: width * height }, (_, index) => pixels[index * 4]!);
    const magnitudes = values.map(Math.abs).sort((a, b) => a - b);
    const scale = magnitudes[Math.floor(values.length * 0.99)]! || 1;
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d")!;
    const data = context.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      // Signed: mid grey is no change, white lit air, black shadowed air (below the pivot).
      const value = values[(height - 1 - y) * width + x]! / scale;
      const grey = Math.max(0, Math.min(255, Math.round(127.5 + value * 127.5)));
      const offset = (y * width + x) * 4;
      data.data.set([grey, grey, grey, 255], offset);
    }
    context.putImageData(data, 0, 0);
    return canvas.convertToBlob().then(blob => new Promise<string>(done => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result as string);
      reader.readAsDataURL(blob);
    }));
  });
  if (image) writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(image.split(",")[1]!, "base64"));
};

/** Frame-to-frame change over 0.25 degree yaw steps, shafts off and on (shimmer adds change). */
const measureShimmer = async (page: Page, shot: Shot, spots: Awaited<ReturnType<typeof findSpots>>) => {
  const result: Record<string, number[]> = {};
  for (const on of [false, true]) {
    await setGodRays(page, on);
    const deltas: number[] = [];
    let previous: string | null = null;
    for (let step = 0; step < 4; step++) {
      await setShot(page, shot, spots, step * Math.PI / 720);
      const image = await capture(page, `shimmer-${on ? "on" : "off"}-${step}`);
      if (previous) deltas.push((await diffImages(page, previous, image)).mean);
      previous = image;
    }
    result[on ? "on" : "off"] = deltas;
  }
  report.shimmer.push({ shot: shot.name, ...result });
};

/**
 * GPU time: the god-ray passes (march and two blur axes) replayed 8 times per timer query, and
 * whole frames, shafts off and on alternating per sample (shared-GPU load cancels in the pairs).
 */
const timeGodRays = (page: Page, count: number) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug, renderer = debug.renderer, gl = renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) return null;
  const calls: { axis: unknown; camera: unknown; material: any; scene: any; source: unknown; target: unknown }[] = [];
  const nativeRender = renderer.render;
  renderer.render = function(scene: any, camera: any) {
    const material = scene.children[0]?.material;
    if (material?.uniforms?.uGodRayMedium || material?.uniforms?.uGodRayAxis) calls.push({ axis:
      material.uniforms.uGodRayAxis?.value, camera, material, scene, source: material.uniforms.uGodRays?.value,
      target: renderer.getRenderTarget() });
    return nativeRender.call(this, scene, camera);
  };
  debug.draw();
  renderer.render = nativeRender;
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
  const replay = () => {
    for (const call of calls) {
      call.scene.children[0].material = call.material;
      if (call.axis) call.material.uniforms.uGodRayAxis.value = call.axis;
      if (call.source) call.material.uniforms.uGodRays.value = call.source;
      renderer.setRenderTarget(call.target);
      nativeRender.call(renderer, call.scene, call.camera);
    }
  };
  const quantile = (values: number[], q: number) =>
    [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * q)] ?? 0;
  const passes: number[] = [];
  for (let index = 0; index < count && calls.length; index++) {
    const ms = await query(() => { for (let repeat = 0; repeat < 8; repeat++) replay(); });
    if (Number.isFinite(ms)) passes.push(ms / 8);
  }
  const off: number[] = [], on: number[] = [], delta: number[] = [];
  for (let pair = 0; pair < count; pair++) {
    const first = pair % 2 === 0;
    (window as any).__godRays(first);
    const a = await query(() => debug.draw());
    (window as any).__godRays(!first);
    const b = await query(() => debug.draw());
    const [onMs, offMs] = first ? [a, b] : [b, a];
    if (!Number.isFinite(onMs) || !Number.isFinite(offMs)) continue;
    on.push(onMs); off.push(offMs); delta.push(onMs - offMs);
  }
  (window as any).__godRays(true);
  const summary = (values: number[]) => ({ median: quantile(values, 0.5), p25: quantile(values, 0.25),
    p75: quantile(values, 0.75) });
  return { calls: calls.length, frameDelta: summary(delta), frameOff: summary(off), frameOn: summary(on),
    pass: summary(passes), passSamples: passes.length };
}, count);

/** SWEEP='[{...},{...}]': the "on" capture of every shot per tuning (look development only). */
const sweep: Record<string, number>[] = process.env.SWEEP ? JSON.parse(process.env.SWEEP) : [];

const runSweep = async (page: Page, spots: Awaited<ReturnType<typeof findSpots>>) => {
  const base = await page.evaluate(() => ({ ...(window as any).__godRaysTuning() }));
  for (const [index, values] of sweep.entries()) {
    await page.evaluate(values => (window as any).__godRaysTuning(values), { ...base, ...values });
    for (const shot of SHOTS) {
      await setShot(page, shot, spots);
      await capture(page, `sweep${index}-${shot.name}`);
    }
  }
  await page.evaluate(values => (window as any).__godRaysTuning(values), base);
};

const reviewQuality = async (browser: Browser, url: string, quality: string) => {
  const { context, page } = await openPage(browser, url, quality);
  await page.waitForTimeout(1500);
  await freezeFrame(page);
  await captureStates(page, quality, "iso");
  await enterPossessed(page);
  const spots = await findSpots(page);
  report.spots.push({ quality, spots });
  if (sweep.length > 0) {
    await runSweep(page, spots);
    await context.close();
    return;
  }
  for (const shot of SHOTS) {
    await setShot(page, shot, spots);
    await captureStates(page, quality, shot.name);
    if (quality !== "minimal") await dumpShafts(page, `${quality}-${shot.name}-shafts`);
    saveReport();
  }
  if (quality !== "minimal") {
    if (shimmer) await measureShimmer(page, SHOTS[0]!, spots);
    if (timing) {
      await setShot(page, SHOTS[0]!, spots);
      report.timing.push({ quality, shot: SHOTS[0]!.name, ...(await timeGodRays(page, samples)) });
    }
  }
  saveReport();
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
