import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { readFrame, warmUp } from "./frozen-frame-review";
import { enterPossessed, openReviewPage, prepareScene, setIsoView, stageReviewSave } from "./water-review-page";

/**
 * CLOUDS-3D review on frozen owner-save frames: the weather (day, dusk, rain, storm) is pinned
 * through the environment, the cloud clock through the frame time. Views: the save's iso camera,
 * a far iso view, a possessed eye on the beach looking out to sea and one looking up. PLAIN shots
 * only (run once from a base worktree's client directory for "before", once from the lane).
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080]
 *   [ONLY=<regexp of view names>] [CLIP=1] (time-lapse: 120 frames of the possessed sky and the
 *   iso view while the cloud clock runs 40x, PNG frames, mp4 and the frame-to-frame difference)
 *   [CLIP_STEP=<cloud seconds per frame, default 2; 0 holds the frame>]
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number) as [number, number];
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const clipMode = process.env.CLIP === "1";
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const CLIP_FRAMES = 120;
/** Cloud-clock seconds per clip frame (CLIP_STEP=0: a held frame, the pure temporal flicker). */
const CLIP_STEP = Number(process.env.CLIP_STEP ?? 2);
/** The possessed dry-cover cycle (exploration-sky-coverage.ts) at ~0.55 cover: frame time 1125 s. */
const CLOUDY_TIME = 1125;
const WARM_DRAWS = 24;
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(outputDir, { recursive: true });
const report: Record<string, any> = { pages: [], shots: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

interface WeatherScene { hour: number; name: string; rain: number }
const SCENES: WeatherScene[] = [
  { hour: 12, name: "day", rain: 0 },
  { hour: 17.8, name: "dusk", rain: 0 },
  { hour: 12, name: "rain", rain: 0.55 },
  { hour: 15, name: "storm", rain: 1 }
];

/** Pins light, rain and the cloud clock on both frozen frames. */
const pinWeather = (page: Page, scene: WeatherScene, time: number) => page.evaluate(async ({ scene, time }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
  const environment = computeEnvironment(debug.world.sun, scene.hour, scene.rain, 0, undefined, 0);
  for (const frame of [debug.isoFrame, debug.possessedFrame]) {
    if (!frame) continue;
    frame.environment = structuredClone(environment);
    frame.time = time;
  }
}, { scene, time });

/** The possessed eye on the beach, looking out over the deep water at `pitch`. */
const aimSky = (page: Page, pitch: number, turn = 0) => page.evaluate(({ pitch, turn }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { coast, deep, ground } = debug.sites;
  const frame = debug.possessedFrame, pose = frame.exploration.camera.pose;
  const awayX = coast.x - deep.x, awayZ = coast.z - deep.z, away = Math.hypot(awayX, awayZ) || 1;
  pose.x = coast.x + awayX / away * 2 + awayZ / away * 4;
  pose.z = coast.z + awayZ / away * 2 - awayX / away * 4;
  pose.y = Math.max(ground, debug.sites.seaLevel) + 1.7;
  pose.yaw = Math.atan2(deep.x - pose.x, deep.z - pose.z) + turn;
  pose.pitch = pitch;
  debug.frozenFrame = frame;
}, { pitch, turn });

const writeShot = (name: string, shot: { dataUrl: string }) =>
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(shot.dataUrl.split(",")[1]!, "base64"));

const capture = async (page: Page, name: string) => {
  if (only && !only.test(name)) return;
  await warmUp(page, WARM_DRAWS);
  writeShot(name, await readFrame(page));
  report.shots.push({ name });
  console.log(name);
};

const captureViews = async (page: Page, quality: string) => {
  const { camera } = await prepareScene(page);
  await enterPossessed(page);
  const scenes = quality === "high" ? SCENES : SCENES.filter(scene => scene.name !== "dusk");
  for (const scene of scenes) {
    await pinWeather(page, scene, CLOUDY_TIME);
    await setIsoView(page, { centerX: camera.centerX, centerZ: camera.centerZ, zoom: camera.zoom });
    await capture(page, `${quality}-${scene.name}-iso`);
    await setIsoView(page, { centerX: camera.centerX, centerZ: camera.centerZ, zoom: 0.3 });
    await capture(page, `${quality}-${scene.name}-iso-far`);
    await aimSky(page, 0.12);
    await capture(page, `${quality}-${scene.name}-possessed-sea`);
    await aimSky(page, 0.62, 0.5);
    await capture(page, `${quality}-${scene.name}-possessed-up`);
  }
};

/** Mean absolute frame-to-frame channel difference (the flicker measure of a clip). */
const temporalDifference = (frames: Uint8Array[]) => {
  const means = frames.slice(1).map((frame, index) => {
    const previous = frames[index]!;
    let total = 0;
    for (let pixel = 0; pixel < frame.length; pixel += 16)
      for (let channel = 0; channel < 3; channel++)
        total += Math.abs(frame[pixel + channel]! - previous[pixel + channel]!);
    return total / (frame.length / 16 * 3);
  });
  return { max: Math.max(...means), mean: means.reduce((sum, value) => sum + value, 0) / means.length };
};

/** A cloud time-lapse: every frame advances the frozen clock by `step` seconds and draws twice. */
const captureClip = async (
  page: Page, name: string, scene: WeatherScene, step: number, turn: (frame: number) => Promise<void>
) => {
  if (only && !only.test(name)) return;
  const directory = resolve(outputDir, `clip-${name}`);
  mkdirSync(directory, { recursive: true });
  const frames: Uint8Array[] = [];
  for (let frame = 0; frame < CLIP_FRAMES; frame++) {
    await pinWeather(page, scene, CLOUDY_TIME + frame * step);
    await turn(frame);
    await warmUp(page, frame === 0 ? WARM_DRAWS : 1);
    const shot = await readFrame(page);
    frames.push(shot.pixels);
    writeShot(`clip-${name}/${String(frame).padStart(3, "0")}`, shot);
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", resolve(directory, "%03d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", resolve(outputDir, `${name}.mp4`)]);
  const temporal = temporalDifference(frames);
  report.shots.push({ name, temporal });
  console.log(`clip ${name}: frame-to-frame mean ${temporal.mean.toFixed(3)}, max ${temporal.max.toFixed(3)}`);
};

const captureClips = async (page: Page, quality: string) => {
  const { camera } = await prepareScene(page);
  await enterPossessed(page);
  const day = SCENES[0]!;
  await captureClip(page, `${quality}-possessed-timelapse`, day, CLIP_STEP,
    frame => aimSky(page, 0.3, CLIP_STEP ? frame * 0.002 : 0));
  await captureClip(page, `${quality}-iso-timelapse`, day, CLIP_STEP,
    () => setIsoView(page, { centerX: camera.centerX, centerZ: camera.centerZ, zoom: 0.3 }));
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { errors, page } = await openReviewPage(browser, url, quality, stageReviewSave(saveText),
      { height, width });
    report.pages.push({ errors, quality });
    await (clipMode ? captureClips : captureViews)(page, quality);
    await page.close();
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots");
