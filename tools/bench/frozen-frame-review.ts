import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { PREFERENCES } from "../../src/app/preferences/keys";
import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { stageStartupSave } from "./frame-profile";

/**
 * Shared frozen-frame review helpers (R11b bloom review, R12b AO review): an owner save staged with
 * the clock and weather pinned, the atmosphere debug API exposed, and same-frame captures read back
 * from the drawing buffer. Every caller runs its browser through captures/browser-slot.sh.
 */

export type RawShot = { height: number; pixels: Uint8Array; width: number };

const LOAD_TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MS ?? 300_000);

/** The save with its day cycle and weather stopped (the source file is only read). */
export const stageFrozenSave = (saveText: string) => {
  const save = JSON.parse(saveText);
  save.runtime ??= {};
  save.runtime.environment ??= { hour: 12 };
  Object.assign(save.runtime.environment, {
    cycling: false,
    targetHour: save.runtime.environment.hour,
    weatherState: "clear"
  });
  return JSON.stringify(save);
};

/** Exposes the world on the atmosphere debug API and pins the weather clock; `extra` adds routes. */
export const patchReviewRoutes = async (page: Page, extra?: (page: Page) => Promise<void>) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await extra?.(page);
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

/** Pins the scene light and the presentation clock on every drawn frame; strips moving actors. */
export const pinScene = (page: Page, scene: string, stripDynamic: boolean) => page.evaluate(
  async ({ sceneName, strip }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { snapshotAtmosphereFrame } = await load("/tools/bench/atmosphere-frame-snapshot.ts");
    const { computeEnvironment, TIME_PRESETS } = await load("/src/render-common/environment.ts");
    const hours: Record<string, number> = {
      dawn: TIME_PRESETS.dawn, day: TIME_PRESETS.day, dusk: TIME_PRESETS.dusk, night: TIME_PRESETS.night
    };
    // A numeric scene name ("17.4") pins that hour (time-lapse reviews).
    const hour = hours[sceneName] ?? Number(sceneName);
    if (!Number.isFinite(hour)) throw new Error(`Unknown scene ${sceneName}`);
    debug.pinned = computeEnvironment(debug.world.sun, hour, 0, 0, 0.45, 0);
    debug.snapshotFrame = (frame: any) => {
      const snapshot = snapshotAtmosphereFrame(frame);
      // The pinned light has no season: keep the live frame's cosmetic season weights (seasons review).
      snapshot.environment = { ...structuredClone(debug.pinned), season: structuredClone(frame.environment?.season) };
      snapshot.time = 12;
      return snapshot;
    };
    debug.stripDynamic = (frame: any) => {
      if (!strip || !frame) return;
      for (const key of ["cavalryMounts", "handcarts", "militaryArrows", "militaryDeaths", "mounts",
        "shipPreviewWorkers", "ships", "shuttleBoats", "transportHorses", "workers"]) frame[key] = [];
      for (const key of ["animals", "birds", "butterflies", "critters"])
        if (frame[key]) frame[key].count = 0;
      if (frame.exploration) frame.exploration.smoke = null;
    };
    debug.renderer.info.autoReset = false;
  }, { sceneName: scene, strip: stripDynamic });

export interface FrozenPageOptions {
  /** Extra query after `quality`, `cache` and `skipLogin` (e.g. "&ao=soft"). */
  query: string;
  quality: string;
  stagedSave: string;
  viewport: { height: number; width: number };
  extraRoutes?: (page: Page) => Promise<void>;
  /** Stored Settings > Graphics overrides as JSON (e.g. '{"autoExposure":50}'); the real settings path. */
  qualityOverrides?: string;
}

/** Stores the player's Settings > Graphics overrides (JSON) before the game reads them. */
export const stageQualityOverrides = (page: Page, overrides: string) =>
  page.addInitScript(({ key, value }) => localStorage.setItem(key, value),
    { key: PREFERENCES.qualityOverrides.key, value: overrides });

/**
 * Opens the game on the staged save with adaptive resolution pinned off and returns the page, its
 * page/console errors and the compositor stats. Asserts the hardware GPU.
 */
export const openFrozenPage = async (browser: Browser, url: string, options: FrozenPageOptions) => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: options.viewport });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text()))
      errors.push(message.text().slice(0, 300));
  });
  await patchReviewRoutes(page, options.extraRoutes);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY,
    value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  if (options.qualityOverrides) await stageQualityOverrides(page, options.qualityOverrides);
  await stageStartupSave(page, url, options.stagedSave, true);
  await page.goto(`${url}?quality=${options.quality}&cache=0&skipLogin=1${options.query}`);
  try {
    await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: LOAD_TIMEOUT_MS });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: LOAD_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`island did not load: ${(error as Error).message}; page errors: ${errors.join(" | ")}`,
      { cause: error });
  }
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const details = debug.api.getStats().details;
    return {
      ambientOcclusion: details.ambientOcclusion ?? 0, bloom: details.bloom ?? 0,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], linearOutput: details.linearOutput ?? 0,
      renderer: gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
      sceneSamples: details.sceneSamples ?? 0, sceneTarget: details.sceneTarget ?? "off"
    };
  });
  assert(/NVIDIA/.test(stats.renderer) && !/swiftshader/i.test(stats.renderer),
    `Not the hardware GPU: ${stats.renderer}`);
  return { errors, page, stats };
};

/** Freezes the current iso frame as `isoFrame` and draws it once. */
export const freezeIso = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.freeze();
  debug.isoFrame = debug.snapshotFrame(debug.frozenFrame);
  debug.stripDynamic(debug.isoFrame);
  debug.frozenFrame = debug.isoFrame;
  debug.draw();
  debug.isoFrame.time = 12;
  return { camera: debug.frozenFrame.camera };
});

/** Possesses the first exploration entry and waits until the possessed phase has settled. */
export const enterPossessed = async (page: Page) => {
  await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozen = false; });
  await page.evaluate(() => (document.querySelector("[data-exploration-entry]") as HTMLElement).click());
  await page.waitForFunction(() =>
    (window as any).__exploration.controller.snapshot().phase === "possessed", null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
};

/** A possessed eye pose; `height` above the ground defaults to 1.6. */
export interface PossessedEye { height?: number; pitch: number; x: number; yaw: number; z: number }

/** Puts the possessed eye at a fixed pose (ground height + `height`) and freezes that frame. */
export const aimPossessed = (page: Page, eye: PossessedEye) => page.evaluate(async target => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { sampleSmooth } = await load("/src/shared/world/grid-geometry.ts");
  debug.freeze();
  const frame = debug.frozenFrame, pose = frame.exploration.camera.pose;
  const ground = Math.max(debug.world.seaLevel, sampleSmooth(debug.world, debug.world.heights, target.x, target.z));
  Object.assign(pose, { pitch: target.pitch, x: target.x, y: ground + (target.height ?? 1.6), yaw: target.yaw,
    z: target.z });
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.possessedFrame = frame;
  debug.frozenFrame = frame;
  debug.draw();
  return { ...target, y: pose.y };
}, eye);

export const setFrame = (page: Page, name: string) => page.evaluate(frame => {
  (window as any).__atmosphereLiveDebug.frozenFrame = (window as any).__atmosphereLiveDebug[frame];
}, name);

export const warmUp = (page: Page, draws: number) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug;
  for (let index = 0; index < count; index++) {
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, draws);

/** Reads the frame and encodes the PNG from the same opaque pixel buffer as the RGBA dump. */
export const readFrame = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  debug.draw();
  const shotWidth = gl.drawingBufferWidth, shotHeight = gl.drawingBufferHeight;
  const pixels = new Uint8Array(shotWidth * shotHeight * 4);
  gl.readPixels(0, 0, shotWidth, shotHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // The game canvas is opaque (`alpha: false`): its alpha channel may still hold
  // alpha-to-coverage residue from the scene target, which a PNG viewer would composite over
  // the page. Force it opaque so the captures show exactly what the player sees.
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  // readPixels is bottom-up; ImageData is top-down.
  const image = new Uint8ClampedArray(pixels.length);
  const rowBytes = shotWidth * 4;
  for (let row = 0; row < shotHeight; row++)
    image.set(pixels.subarray((shotHeight - 1 - row) * rowBytes, (shotHeight - row) * rowBytes),
      row * rowBytes);
  const canvas = document.createElement("canvas");
  canvas.width = shotWidth;
  canvas.height = shotHeight;
  canvas.getContext("2d")!.putImageData(new ImageData(image, shotWidth, shotHeight), 0, 0);
  return { dataUrl: canvas.toDataURL("image/png") as string, height: shotHeight, pixels, width: shotWidth };
});

/** Warms the frozen frame up, reads it and writes `<name>.png` and `<name>.rgba` into `directory`. */
export const captureFrame = async (page: Page, directory: string, name: string, draws: number) => {
  await warmUp(page, draws);
  const shot = await readFrame(page);
  writeFileSync(resolve(directory, `${name}.png`), Buffer.from(shot.dataUrl.split(",")[1]!, "base64"));
  writeFileSync(resolve(directory, `${name}.rgba`), Buffer.from(shot.pixels));
  return shot;
};

/**
 * Per-pixel channel difference: share over 1 and 8 levels, maximum and mean. `dark*` covers the
 * areas that were not bright before (max channel < 128): their mean luminance before and after and
 * the relative change, so a full-screen haze or darkening would show up here.
 */
export const differenceStats = (before: { pixels: Uint8Array }, after: { pixels: Uint8Array }) => {
  assert.equal(before.pixels.length, after.pixels.length, "Shots of different sizes");
  const images = before.pixels.length / 4;
  let changed = 0, maximum = 0, over1 = 0, over8 = 0, total = 0;
  let darkPixels = 0, darkLumaBefore = 0, darkLumaAfter = 0;
  for (let index = 0; index < before.pixels.length; index += 4) {
    let delta = 0;
    let brightness = 0;
    let lumaBefore = 0, lumaAfter = 0;
    for (let channel = 0; channel < 3; channel++) {
      const beforeChannel = before.pixels[index + channel]!;
      const afterChannel = after.pixels[index + channel]!;
      delta = Math.max(delta, Math.abs(beforeChannel - afterChannel));
      brightness = Math.max(brightness, beforeChannel);
      const weight = [0.2126, 0.7152, 0.0722][channel]!;
      lumaBefore += beforeChannel * weight;
      lumaAfter += afterChannel * weight;
    }
    if (brightness < 128) {
      darkPixels++;
      darkLumaBefore += lumaBefore;
      darkLumaAfter += lumaAfter;
    }
    changed += delta > 0 ? 1 : 0;
    over1 += delta > 1 ? 1 : 0;
    over8 += delta > 8 ? 1 : 0;
    maximum = Math.max(maximum, delta);
    total += delta;
  }
  const darkMeanBefore = darkPixels ? darkLumaBefore / darkPixels : 0;
  const darkMeanAfter = darkPixels ? darkLumaAfter / darkPixels : 0;
  return {
    changed,
    darkChangePercent: darkMeanBefore ? (darkMeanAfter - darkMeanBefore) / darkMeanBefore * 100 : 0,
    darkMeanAfter,
    darkMeanBefore,
    darkPixels,
    maximum,
    mean: total / images,
    over1,
    over8,
    pixels: images
  };
};

/** Amplified (×16) red difference image `<name>-diff.png` under `<directory>/diff`. */
export const writeDiffImage = (directory: string, name: string, before: { pixels: Uint8Array },
  after: { pixels: Uint8Array }, shotWidth: number, shotHeight: number) => {
  const image = Buffer.alloc(before.pixels.length);
  for (let index = 0; index < before.pixels.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++)
      delta = Math.max(delta, Math.abs(before.pixels[index + channel]! - after.pixels[index + channel]!));
    image[index] = Math.min(255, delta * 16);
    image[index + 1] = 0;
    image[index + 2] = 0;
    image[index + 3] = 255;
  }
  const rawPath = resolve(directory, "diff", `${name}-diff.rgba`);
  writeFileSync(rawPath, image);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${shotWidth}x${shotHeight}`, "-i", rawPath, "-vf", "vflip", "-frames:v", "1",
    resolve(directory, "diff", `${name}-diff.png`)]);
};

/** `<output>` as the horizontal stack of the given PNG paths (ffmpeg). */
export const stackHorizontally = (output: string, inputs: readonly string[]) => {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flatMap(input => ["-i", input]),
    "-filter_complex", `hstack=inputs=${inputs.length}`, output]);
};
