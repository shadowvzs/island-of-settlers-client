/**
 * Shared page helpers of the possessed-sky cloud reviews (cloud-shimmer-review.ts, cloud-turn-review.ts):
 * possession, look and eye control, pinned cover and clock, paused frames and recorded frame strips.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

interface ExplorationHook {
  camera: { frame: () => { camera?: { pose: { pitch: number } } | null } };
  controller: { enter: () => Promise<unknown>; setLook: (yaw: number, pitch: number) => void;
    setMovement: (forward: number, right: number) => void; snapshot: () => { phase: string } };
}
export type HookWindow = Window & { __exploration: ExplorationHook; __islandReady?: boolean };

/** Crop of the canvas in shares of its size. */
export interface FrameCrop { height: number; left: number; top: number; width: number }
/** The shimmer review's crop: the upper middle of the view, where the clouds sit when looking up. */
export const SKY_CROP: FrameCrop = { height: 0.4, left: 0.3, top: 0.05, width: 0.4 };

export interface RecordOptions {
  count: number;
  crop?: FrameCrop;
  /** Frames drawn into the strip (default 6). */
  stripFrames?: number;
  /** Adds a 3x zoom of the crop centre: `zoomFrames` frames, then |frame difference| x16 panels. */
  zoomFrames?: number;
}

/** Look-input rates (the controller's look intent, not an absolute pose). */
export const look = (page: Page, yaw: number, pitch: number) => page.evaluate(([yaw, pitch]) =>
  (window as unknown as HookWindow).__exploration.controller.setLook(yaw!, pitch!), [yaw, pitch]);

/**
 * Overrides the published eye pose: a fixed pitch/yaw plus optional turn rates (rad/s) and a pitch
 * swing, so turning strips are repeatable. `null` restores the body's own look.
 */
export interface EyeMotion {
  pitch: number;
  pitchSwing?: number;
  pitchSwingHz?: number;
  yaw: number;
  yawRate?: number;
}
export const driveEye = (page: Page, motion: EyeMotion | null) => page.evaluate(motion => {
  const camera = (window as any).__exploration.camera;
  camera.__originalSetPose ??= camera.setPose;
  if (!motion) {
    camera.setPose = camera.__originalSetPose;
    return;
  }
  const started = performance.now();
  camera.setPose = (pose: any, blend: number) => {
    const seconds = (performance.now() - started) / 1000;
    const swing = (motion.pitchSwing ?? 0) * Math.sin(seconds * Math.PI * 2 * (motion.pitchSwingHz ?? 0));
    const view = { pitch: motion.pitch + swing, yaw: motion.yaw + (motion.yawRate ?? 0) * seconds };
    camera.__originalSetPose(pose ? { ...pose, ...view } : null, blend);
  };
}, motion);

/** Pins the possessed-sky cloud cover so every run looks at the same clouds. */
export const pinCloudCover = (page: Page, cover: number) => page.route("**/exploration-sky-coverage.ts*",
  async route => {
    const response = await route.fetch(), source = await response.text();
    const pinned = source.replace(/export const explorationSkyCoverage = \(/,
      `export const explorationSkyCoverage = () => ${cover}; const unpinnedCoverage = (`);
    assert.notEqual(pinned, source, "sky coverage hook moved");
    await route.fulfill({ body: pinned, response });
  });

/** Exposes the weather controller (`window.__weather`) to set the hour without a glide. */
export const exposeWeather = (page: Page) => page.route("**/src/app/island-runtime.ts*", async route => {
  const response = await route.fetch(), source = await response.text();
  const patched = source.replace("window.__islandReady = true",
    "window.__weather = weather; window.__islandReady = true");
  assert.notEqual(patched, source, "island ready hook moved");
  await route.fulfill({ body: patched, response });
});

/** Sets the hour (clear, no glide); returns the sun's elevation and azimuth. */
export const setHour = (page: Page, hour: number) => page.evaluate(hour => {
  const { controller } = (window as any).__weather;
  const saved = controller.saveState();
  controller.loadState({ ...saved, cycling: false, hour, rain: 0, snow: 0, targetHour: hour, targetRain: 0,
    targetSnow: 0 });
  const { sun } = controller.update(0);
  return { elevation: sun.elevation as number, yaw: Math.atan2(sun.azimuthX, sun.azimuthZ) };
}, hour);

/**
 * Share of near-white pixels in the crop: turn until clouds fill the view. Both readers take the
 * node renderer's canvas (`#webgpu-view`, Ultra) when it exists, else the WebGL canvas.
 */
const cloudShare = (page: Page) => page.evaluate(() => new Promise<number>(done => requestAnimationFrame(() => {
  const canvas = (document.querySelector<HTMLCanvasElement>("canvas#webgpu-view") ??
    document.querySelector<HTMLCanvasElement>("canvas#view"))!;
  const crop = document.createElement("canvas");
  crop.width = Math.floor(canvas.width * 0.4); crop.height = Math.floor(canvas.height * 0.4);
  const context = crop.getContext("2d")!;
  context.drawImage(canvas, canvas.width * 0.3, canvas.height * 0.05, crop.width, crop.height,
    0, 0, crop.width, crop.height);
  const pixels = context.getImageData(0, 0, crop.width, crop.height).data;
  let white = 0;
  for (let index = 0; index < pixels.length; index += 4)
    if (pixels[index]! > 170 && pixels[index + 2]! - pixels[index]! < 40) white++;
  done(white / (pixels.length / 4));
})));

/** The node renderer (Ultra, `renderer=webgpu*`) compiles every pipeline at load: allow longer. */
const ISLAND_LOAD_TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MS ?? 180_000);

export const waitForIslandPage = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__islandReady),
    null, { timeout: ISLAND_LOAD_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: ISLAND_LOAD_TIMEOUT_MS });
};

export const enterPossession = async (page: Page) => {
  await page.evaluate(() => (window as unknown as HookWindow).__exploration.controller.enter());
  await page.waitForFunction(() =>
    (window as unknown as HookWindow).__exploration.controller.snapshot().phase === "possessed",
  null, { timeout: Math.max(60_000, ISLAND_LOAD_TIMEOUT_MS / 2) });
};

/** Possesses the body, looks up past `lookPitch` and turns until clouds fill the crop. */
export const possessAndLookUp = async (page: Page, lookPitch: number) => {
  await enterPossession(page);
  await look(page, 0, 1.5);
  await page.waitForFunction(pitch =>
    ((window as unknown as HookWindow).__exploration.camera.frame().camera?.pose.pitch ?? 0) > pitch, lookPitch);
  await look(page, 0, 0);
  await page.waitForTimeout(800);
  for (let turn = 0; turn < 16 && await cloudShare(page) < 0.08; turn++) {
    await look(page, 1, 0);
    await page.waitForTimeout(200);
    await look(page, 0, 0);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(3000);
};

/** Pauses rAF for `ms`; `hidden` also reports the document hidden like a real tab switch. */
export const pauseFrames = (page: Page, ms: number, hidden: boolean) => page.evaluate(async ({ hidden, ms }) => {
  const realFrame = window.requestAnimationFrame.bind(window);
  const queued: FrameRequestCallback[] = [];
  window.requestAnimationFrame = callback => { queued.push(callback); return 0; };
  const setHidden = (value: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    Object.defineProperty(document, "visibilityState", { configurable: true,
      get: () => (value ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  if (hidden) setHidden(true);
  await new Promise(done => setTimeout(done, ms));
  window.requestAnimationFrame = realFrame;
  if (hidden) setHidden(false);
  for (const callback of queued.splice(0)) realFrame(callback);
}, { hidden, ms });

/**
 * Crops consecutive presented frames; returns the strips (data URLs) and the noise metric.
 * Flicker = mean |frame - neighbour mean|, boil = per-pixel deviation (sky and cloud pixels only).
 */
export const recordFrames = (page: Page, options: RecordOptions) => page.evaluate(async options => {
  const shares = options.crop!;
  const canvas = (document.querySelector<HTMLCanvasElement>("canvas#webgpu-view") ??
    document.querySelector<HTMLCanvasElement>("canvas#view"))!;
  const width = Math.floor(canvas.width * shares.width), height = Math.floor(canvas.height * shares.height);
  const left = Math.floor(canvas.width * shares.left), top = Math.floor(canvas.height * shares.top);
  const frames: Float32Array[] = [];
  const crops: HTMLCanvasElement[] = [];
  const intervals: number[] = [];
  let last = performance.now();
  for (let index = 0; index < options.count; index++) {
    // Registered after the game's callback, so it runs after this frame's render.
    const at = await new Promise<number>(done => requestAnimationFrame(done));
    intervals.push(at - last);
    last = at;
    const crop = document.createElement("canvas");
    crop.width = width; crop.height = height;
    const context = crop.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(canvas, left, top, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const luminance = new Float32Array(width * height);
    for (let pixel = 0; pixel < luminance.length; pixel++)
      luminance[pixel] = pixels[pixel * 4]! * 0.2126 + pixels[pixel * 4 + 1]! * 0.7152 +
        pixels[pixel * 4 + 2]! * 0.0722;
    frames.push(luminance);
    if (crops.length < Math.max(options.stripFrames!, options.zoomFrames ?? 0)) crops.push(crop);
  }
  // Flicker cancels the slow wind drift; pixels that ever turn dark (birds, roofs) are skipped.
  const flicker = new Float32Array(width * height);
  let judged = 0;
  for (let pixel = 0; pixel < flicker.length; pixel++) {
    let darkest = 255, sum = 0;
    for (const frame of frames) darkest = Math.min(darkest, frame[pixel]!);
    if (darkest < 70) { flicker[pixel] = -1; continue; }
    for (let index = 1; index < frames.length - 1; index++)
      sum += Math.abs(frames[index]![pixel]! - (frames[index - 1]![pixel]! + frames[index + 1]![pixel]!) / 2);
    flicker[pixel] = sum / (frames.length - 2);
    judged++;
  }
  let boilSum = 0;
  for (let pixel = 0; pixel < flicker.length; pixel++) {
    if (flicker[pixel]! < 0) continue;
    let sum = 0, square = 0;
    for (const frame of frames) { sum += frame[pixel]!; square += frame[pixel]! * frame[pixel]!; }
    const mean = sum / frames.length;
    boilSum += Math.sqrt(Math.max(0, square / frames.length - mean * mean));
  }
  const sorted = Array.from(flicker).filter(value => value >= 0).sort((a, b) => a - b);
  const stripCrops = crops.slice(0, options.stripFrames);
  const strip = document.createElement("canvas");
  strip.width = width * stripCrops.length; strip.height = height;
  stripCrops.forEach((crop, index) => strip.getContext("2d")!.drawImage(crop, index * width, 0));
  let zoom: string | null = null;
  const zoomFrames = Math.min(options.zoomFrames ?? 0, crops.length);
  if (zoomFrames > 1) {
    // Centre third of the crop at 3x (nearest), then |difference| x16 of consecutive zoomed frames.
    const part = { height: Math.floor(height / 3), width: Math.floor(width / 3) };
    const sheet = document.createElement("canvas");
    sheet.width = width * (zoomFrames * 2 - 1); sheet.height = part.height * 3;
    const sheetContext = sheet.getContext("2d", { willReadFrequently: true })!;
    sheetContext.imageSmoothingEnabled = false;
    for (let index = 0; index < zoomFrames; index++)
      sheetContext.drawImage(crops[index]!, part.width, part.height, part.width, part.height,
        index * width, 0, part.width * 3, part.height * 3);
    for (let index = 1; index < zoomFrames; index++) {
      const previous = sheetContext.getImageData((index - 1) * width, 0, part.width * 3, part.height * 3);
      const next = sheetContext.getImageData(index * width, 0, part.width * 3, part.height * 3);
      for (let value = 0; value < next.data.length; value += 4)
        for (let channel = 0; channel < 3; channel++)
          next.data[value + channel] = Math.min(255,
            Math.abs(next.data[value + channel]! - previous.data[value + channel]!) * 16);
      sheetContext.putImageData(next, (zoomFrames + index - 1) * width, 0);
    }
    zoom = sheet.toDataURL("image/png");
  }
  return {
    boil: boilSum / Math.max(1, judged),
    judgedShare: judged / flicker.length,
    medianFrameMs: intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]!,
    meanFlicker: sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length),
    p99Flicker: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    strip: strip.toDataURL("image/png"),
    zoom
  };
}, { crop: SKY_CROP, stripFrames: 6, ...options });

export const savePng = (folder: string, name: string, data: string) =>
  writeFileSync(resolve(folder, `${name}.png`), Buffer.from(data.split(",")[1]!, "base64"));
