import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  callHook as call, measureFrames as measure, openCinematicGame, settleFrames as settle
} from "./cinematic-review-page";
import { enterPossessedView } from "./frame-profile";

/**
 * CIN3 review (CIN2 camera review extended to the sequence player): the owner's example sequence of
 * `?cinematicTest=1` per quality and start view (iso, possessed) as seeked frames (an mp4 clip and stills), then
 * a real-time run that checks the HUD scope, the world hold (no ticks), the input lock (a map click and Escape do
 * nothing but arm the skip prompt), the exact restore of the drawn pose / RTS camera / possession, and frame cost.
 *
 * Usage (browser via captures/browser-slot.sh, env file via `npx tsx --env-file=<file>`):
 *   OUTPUT_DIR=<dir> [OWNER_SAVE=<save>] [QUALITIES=high,minimal] [VIEWS=iso,possessed] [VIEWPORT=1280x720]
 *   [CLIP_STEP_MS=250] [HOUR=11] npx tsx tools/bench/cinematic-camera-review.ts
 */
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR");
const sourcePath = process.env.OWNER_SAVE;
const saveText = sourcePath ? readFileSync(sourcePath, "utf8") : null;
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const views = (process.env.VIEWS ?? "iso,possessed").split(",");
const [width, height] = (process.env.VIEWPORT ?? "1280x720").split("x").map(Number);
const clipStepMs = Number(process.env.CLIP_STEP_MS ?? 250);
const hour = process.env.HOUR ?? "11";
const STILLS: Record<string, number> = {
  "01-letterbox": 300, "02-blend-mid": 1600, "03-shot-a": 2700, "04-drift-speaker": 4500, "05-blend-b": 9400,
  "06-shot-b-glint": 11000, "07-strike-shake": 11200, "08-dip-black": 12900, "09-restore-mid": 15300
};
/** The layer's CSS appear transitions (speaker panel 300 ms) finish before a still is taken. */
const STILL_SETTLE_MS = 450;
mkdirSync(outputDir, { recursive: true });

interface HookState { active: boolean; holdsWorld: boolean; locksInput: boolean; nowMs: number;
  ui: { skipPrompt: boolean } }

const hookState = (page: Page) => call(page, "state") as Promise<HookState>;

const shoot = (page: Page, file: string) => page.screenshot({ path: resolve(outputDir, file) });

/** The RTS camera, the drawn pose, the view mode, the possession phase and the simulation tick. */
const worldState = (page: Page) => page.evaluate(() => {
  const anyWindow = window as any;
  const settlement = anyWindow.__settlement;
  return {
    hud: document.documentElement.getAttribute("data-cinematic"),
    hudVisibility: getComputedStyle(document.querySelector(".app-window-layer")!).visibility,
    phase: anyWindow.__exploration?.controller.phase() ?? null,
    pose: anyWindow.__cinematicTest.pose(),
    ticks: settlement?.simulation.tickCount() ?? null
  };
});

const openGame = (url: string, quality: string, errors: string[]) => openCinematicGame(browser, url,
  { errors, height: height!, hour, quality, saveText, width: width! });

const captureClip = async (page: Page, label: string, durationMs: number) => {
  const frameDir = resolve(outputDir, `${label}-frames`);
  mkdirSync(frameDir, { recursive: true });
  let index = 0;
  for (let time = 0; time < durationMs; time += clipStepMs) {
    await call(page, "seek", time);
    await settle(page);
    await page.screenshot({ path: resolve(frameDir, `${String(index++).padStart(3, "0")}.jpg`), quality: 80 });
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(1000 / clipStepMs), "-i",
    resolve(frameDir, "%03d.jpg"), "-vf", "scale=960:-2", "-pix_fmt", "yuv420p", resolve(outputDir,
      `${label}-clip.mp4`)]);
};

const captureStills = async (page: Page, label: string) => {
  for (const [name, time] of Object.entries(STILLS)) {
    await call(page, "seek", time);
    await settle(page);
    await page.waitForTimeout(STILL_SETTLE_MS);
    await shoot(page, `${label}-${name}.png`);
  }
  await call(page, "stop");
  await settle(page);
};

/** Real time: hold, HUD scope, input lock (map click, Escape twice arms then skips) and the exact restore. */
const realTimeRun = async (page: Page, label: string) => {
  const before = await worldState(page);
  await call(page, "play");
  const sequence = await measure(page, 3000);
  const during = await worldState(page);
  await page.mouse.click(width! / 2, height! / 2);
  await page.keyboard.press("Escape");
  const armed = await hookState(page);
  await shoot(page, `${label}-10-skip-prompt.png`);
  await page.waitForTimeout(500);
  const held = await worldState(page);
  await page.keyboard.press("Escape");
  await settle(page);
  const skipped = await hookState(page);
  await page.waitForTimeout(500);
  const after = await worldState(page);
  await shoot(page, `${label}-11-after-skip.png`);
  return { after, armed, before, during, held, sequence, skipped };
};

/** A full watched run: the restore at the end must equal the start exactly. */
const watchedRun = async (page: Page, label: string) => {
  const before = await worldState(page);
  await call(page, "play");
  await page.waitForFunction(() => !(window as any).__cinematicTest.state().active, null, { timeout: 40000 });
  await settle(page);
  const after = await worldState(page);
  await shoot(page, `${label}-12-after-watch.png`);
  return { after, before };
};

const reviewView = async (page: Page, quality: string, view: string) => {
  const label = `${quality}-${view}`;
  if (view === "possessed") await enterPossessedView(page);
  await shoot(page, `${label}-00-before.png`);
  const base = await measure(page, 3000);
  await captureStills(page, label);
  await captureClip(page, label, 17_500);
  await call(page, "stop");
  await page.waitForTimeout(1000);
  const realTime = await realTimeRun(page, label);
  const watched = await watchedRun(page, label);
  return { base, realTime, watched };
};

const reviewQuality = async (url: string, quality: string) => {
  const errors: string[] = [];
  const page = await openGame(url, quality, errors);
  const report: Record<string, unknown> = { quality, viewport: `${width}x${height}` };
  for (const view of views) report[view] = await reviewView(page, quality, view);
  report.errors = errors;
  writeFileSync(resolve(outputDir, `${quality}-report.json`), JSON.stringify(report, null, 2));
  console.log(`${quality}: done (${errors.length} page errors)`);
  await page.close();
};

const { server, url } = await startDevServer();
const browser = launchBrowser();
try {
  for (const quality of qualities) await reviewQuality(url, quality);
} finally {
  await (await browser).close();
  await server.close();
}
