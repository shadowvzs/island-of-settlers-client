import type { Browser, Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { stageStartupSave } from "./frame-profile";

/**
 * Shared page helpers of the R18a water tools (water-coast-review.ts, water-cost-ab.ts): a frozen
 * owner-save frame (atmosphere live-cost patch), the coast and deep-water review sites, a
 * render-only synthetic ship sailing a gentle arc, iso and possessed framings.
 */
const LOAD_TIMEOUT_MS = 300_000;

const patchRoutes = async (page: Page) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    const body = patchAtmosphereLiveCost(await response.text())
      .replace("atmosphereDebug.api = result;", "atmosphereDebug.world = world; atmosphereDebug.api = result;");
    await route.fulfill({ body, response });
  });
  await page.route("**/exploration-weather-adapter.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({ body: patchAtmosphereWeatherClock(await response.text()), response });
  });
};

/**
 * Stages `save` (a read copy) and opens the game at `quality`; `query` appends development switches
 * (e.g. `&ssr=off`); `prepare` adds review-only routes before loading. Console errors are collected.
 */
export const openReviewPage = async (
  browser: Browser, url: string, quality: string, save: string, viewport: { height: number; width: number },
  query = "", prepare?: (page: Page) => Promise<void>
) => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 300));
  });
  await patchRoutes(page);
  await prepare?.(page);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY,
    value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, save, true);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1${query}`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: LOAD_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: LOAD_TIMEOUT_MS });
  await page.waitForTimeout(5000);
  if (errors.length) throw new Error(`${quality}: ${errors.join(" | ")}`);
  return { errors, page };
};

/** The owner save with the clock and weather pinned (clear, no day cycle). */
export const stageReviewSave = (saveText: string) => {
  const save = JSON.parse(saveText);
  Object.assign(save.runtime.environment, { cycling: false, targetHour: save.runtime.environment.hour,
    weatherState: "clear" });
  return JSON.stringify(save);
};

/**
 * Freezes the live frame, keeps a ship template, strips dynamic actors and finds the review sites:
 * a deep-water point with a clear sailing circle (the wake arc) and the nearest beach to it.
 */
export const prepareScene = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { snapshotAtmosphereFrame } = await import(
    /* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
  const { sampleBilinear, sampleSmooth } = await import(
    /* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
  debug.snapshotFrame = snapshotAtmosphereFrame;
  debug.freeze();
  const frame = debug.frozenFrame;
  debug.shipTemplate = structuredClone((frame.ships ?? [])[0] ?? null);
  for (const key of ["cavalryMounts", "handcarts", "militaryArrows", "militaryDeaths", "mounts",
    "shipPreviewWorkers", "ships", "shuttleBoats", "transportHorses", "workers"]) frame[key] = [];
  for (const key of ["animals", "birds", "butterflies", "critters"]) if (frame[key]) frame[key].count = 0;
  const world = debug.world;
  const depthAt = (x: number, z: number) =>
    sampleBilinear(world, world.waterSurface, x, z) - sampleSmooth(world, world.heights, x, z);
  const { centerX, centerZ } = frame.camera;
  const clearCircle = (x: number, z: number) => {
    for (let step = 0; step < 24; step++) {
      const angle = step / 24 * Math.PI * 2;
      for (const radius of [3, 6, 9]) if (depthAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) < 1.2)
        return false;
    }
    return depthAt(x, z) > 2;
  };
  let deep = null as null | { x: number; z: number };
  for (let ring = 0; ring < 60 && !deep; ring++) for (let step = 0; step < 8 * Math.max(1, ring) && !deep; step++) {
    const angle = step / (8 * Math.max(1, ring)) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * ring, z = centerZ + Math.sin(angle) * ring;
    if (x > 10 && z > 10 && x < world.cellsX - 10 && z < world.cellsZ - 10 && clearCircle(x, z)) deep = { x, z };
  }
  if (!deep) throw new Error("No deep water circle near the camera");
  // A gentle port turn ending at the deep point: the pose `distance` units along it (negative: behind).
  const courseRadius = 35;
  const courseAt = (heading: number, distance: number) => {
    const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
    const centerX = deep!.x - forwardZ * courseRadius, centerZ = deep!.z + forwardX * courseRadius;
    const angle = distance / courseRadius;
    const offsetX = deep!.x - centerX, offsetZ = deep!.z - centerZ;
    const x = centerX + offsetX * Math.cos(angle) - offsetZ * Math.sin(angle);
    const z = centerZ + offsetX * Math.sin(angle) + offsetZ * Math.cos(angle);
    return { x, yaw: heading - angle, z };
  };
  const clearCourse = (heading: number) => {
    for (let distance = -26; distance <= 6; distance += 1) {
      const pose = courseAt(heading, distance);
      for (const side of [-3, 0, 3])
        if (depthAt(pose.x + Math.cos(pose.yaw) * side, pose.z - Math.sin(pose.yaw) * side) < 1.2) return false;
    }
    return true;
  };
  let heading = null as null | number;
  // Prefer sailing away from the iso camera (heading -z): the wake then trails towards the viewer and
  // neither arm is hidden behind the sails.
  for (let step = 0; step < 32 && heading === null; step++) {
    const candidate = Math.PI + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * Math.PI / 16;
    if (clearCourse(candidate)) heading = candidate;
  }
  if (heading === null) throw new Error("No clear course through the deep water");
  const course = { at: (distance: number) => courseAt(heading!, distance) };
  let coast = null as null | { x: number; z: number; distance: number };
  for (let z = deep.z - 40; z <= deep.z + 40; z += 0.5) for (let x = deep.x - 40; x <= deep.x + 40; x += 0.5) {
    const depth = depthAt(x, z);
    if (depth > 0 || depth < -0.25) continue;
    const distance = Math.hypot(x - deep.x, z - deep.z);
    if (!coast || distance < coast.distance) coast = { distance, x, z };
  }
  if (!coast) throw new Error("No coast near the deep water");
  debug.isoFrame = snapshotAtmosphereFrame(frame);
  debug.isoFrame.time = 12;
  debug.sites = { coast, course, deep, ground: sampleSmooth(world, world.heights, coast.x, coast.z),
    seaLevel: world.seaLevel, water: sampleBilinear(world, world.waterSurface, deep.x, deep.z) };
  return { camera: frame.camera, heading, ship: Boolean(debug.shipTemplate),
    sites: { coast, deep, ground: debug.sites.ground, seaLevel: world.seaLevel } };
});

/**
 * Sails the synthetic ship for `seconds` of presentation time, one draw per 1/30 s, along a gentle
 * arc (radius COURSE_RADIUS) that ends at the deep point on the course found by prepareScene.
 */
export const sailShip = (page: Page, seconds: number, endTime = 12) => page.evaluate(async ({ endTime, seconds }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { course, water } = debug.sites;
  const frame = debug.frozenFrame;
  const template = debug.shipTemplate;
  const speed = 2.4;
  for (let step = Math.round(seconds * 30); step >= 0; step--) {
    const pose = course.at((endTime - 12 - step / 30) * speed);
    frame.time = endTime - step / 30;
    frame.ships = template ? [{ ...template, phase: "sailing", x: pose.x, y: water, yaw: pose.yaw, z: pose.z }] : [];
    debug.draw();
    if (step % 15 === 0) await new Promise(done => requestAnimationFrame(done));
  }
}, { endTime, seconds });

export const setIsoView = (page: Page, view: { centerX?: number; centerZ?: number; zoom?: number }) =>
  page.evaluate(view => {
    const debug = (window as any).__atmosphereLiveDebug;
    const frame = structuredClone({ ...debug.isoFrame, felling: undefined, growth: undefined });
    Object.assign(frame, { felling: debug.isoFrame.felling, growth: debug.isoFrame.growth });
    Object.assign(frame.camera, view);
    debug.frozenFrame = frame;
  }, view);

export const pinLight = (page: Page, scene: "day" | "dusk") => page.evaluate(async scene => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { computeEnvironment, TIME_PRESETS } = await import(
    /* @vite-ignore */ String("/src/render-common/environment.ts"));
  const environment = computeEnvironment(debug.world.sun, TIME_PRESETS[scene], 0, 0, 0.45, 0);
  debug.isoFrame.environment = environment;
  if (debug.possessedFrame) debug.possessedFrame.environment = structuredClone(environment);
}, scene);

export const enterPossessed = async (page: Page) => {
  await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozen = false; });
  await page.evaluate(() => (document.querySelector("[data-exploration-entry]") as HTMLElement).click());
  await page.waitForFunction(() =>
    (window as any).__exploration.controller.snapshot().phase === "possessed", null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { snapshotAtmosphereFrame } = await import(
    /* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
    debug.freeze();
    const frame = snapshotAtmosphereFrame(debug.frozenFrame);
    for (const key of ["cavalryMounts", "handcarts", "mounts", "ships", "shuttleBoats", "workers"]) frame[key] = [];
    frame.environment = structuredClone(debug.isoFrame.environment);
    debug.possessedFrame = frame;
  });
};

/**
 * Eye on the beach above the coast point, looking out at the sailing circle ("ship") or along the
 * beach ("coast"); "waterline" stands in the swash one unit seaward, 0.9 above the sea, looking along
 * the beach just above the water (a low view of the shore trees and their reflections).
 */
export const setPossessedView = (page: Page, target: "coast" | "ship" | "waterline") => page.evaluate(target => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { coast, deep, ground } = debug.sites;
  const frame = debug.possessedFrame, pose = frame.exploration.camera.pose;
  const awayX = coast.x - deep.x, awayZ = coast.z - deep.z, away = Math.hypot(awayX, awayZ) || 1;
  const waterline = target === "waterline";
  // Two units inland and four along the beach: clear of the shore trees that grow at the coast point.
  const inland = waterline ? -1 : 2;
  pose.x = coast.x + awayX / away * inland + awayZ / away * 4;
  pose.z = coast.z + awayZ / away * inland - awayX / away * 4;
  pose.y = waterline ? debug.sites.seaLevel + 0.9 : Math.max(ground, debug.sites.seaLevel) + 1.7;
  const alongBeach = target !== "ship";
  const aimX = alongBeach ? coast.x - awayZ / away * 6 : deep.x;
  const aimZ = alongBeach ? coast.z + awayX / away * 6 : deep.z;
  pose.yaw = Math.atan2(aimX - pose.x, aimZ - pose.z);
  const pitches = { coast: -0.32, ship: -0.12, waterline: -0.06 };
  pose.pitch = pitches[target];
  debug.frozenFrame = frame;
}, target);

/**
 * Draws the frozen frame and returns it as a PNG data URL (opaque); with `crop` (drawing-buffer
 * pixels, top-left origin) only that rectangle, clamped to the frame.
 */
export const readFrame = (page: Page, crop?: { height: number; width: number; x: number; y: number }) =>
  page.evaluate(crop => {
    const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
    debug.draw();
    const shotWidth = gl.drawingBufferWidth, shotHeight = gl.drawingBufferHeight;
    const pixels = new Uint8Array(shotWidth * shotHeight * 4);
    gl.readPixels(0, 0, shotWidth, shotHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const image = new Uint8ClampedArray(pixels.length), rowBytes = shotWidth * 4;
    for (let row = 0; row < shotHeight; row++)
      image.set(pixels.subarray((shotHeight - 1 - row) * rowBytes, (shotHeight - row) * rowBytes), row * rowBytes);
    for (let index = 3; index < image.length; index += 4) image[index] = 255;
    const full = document.createElement("canvas");
    full.width = shotWidth;
    full.height = shotHeight;
    full.getContext("2d")!.putImageData(new ImageData(image, shotWidth, shotHeight), 0, 0);
    if (!crop) return full.toDataURL("image/png") as string;
    const width = Math.min(crop.width, shotWidth), height = Math.min(crop.height, shotHeight);
    const x = Math.min(Math.max(0, Math.round(crop.x)), shotWidth - width);
    const y = Math.min(Math.max(0, Math.round(crop.y)), shotHeight - height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(full, x, y, width, height, 0, 0, width, height);
    return canvas.toDataURL("image/png") as string;
  }, crop);
