import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { callHook as call, measureFrames, openCinematicGame, settleFrames as settle } from "./cinematic-review-page";

/**
 * CIN6 review: per quality on one page, in this order (the first use must be measured on a fresh page):
 * 1. shader prewarm: the strike fixture in real time from a fresh view; GPU program count before / after the first
 *    glint and the first strike, and the longest frame at those moments (rAF deltas);
 * 2. glint and ground strike stills: the fixture seeked (iso glint at normal zoom, low shot with glint), then a
 *    live strike in the paused low shot (bolt, then the impact glow alone); the CIN3 owner fixture's glint still
 *    for the before/after comparison with `captures/cin3`;
 * 3. weather clear -> rain over 4 s in the iso view, stills and frame cost;
 * 4. hour transition 11:00 -> 18:30 (dusk), stills along the way.
 *
 * Usage (browser via captures/browser-slot.sh, env file via `npx tsx --env-file=<file>`):
 *   OUTPUT_DIR=<dir> [OWNER_SAVE=<save>] [QUALITIES=high,minimal] [VIEWPORT=1280x720] [HOUR=11]
 *   npx tsx tools/bench/cinematic-environment-review.ts
 */
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR");
const sourcePath = process.env.OWNER_SAVE;
const saveText = sourcePath ? readFileSync(sourcePath, "utf8") : null;
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const [width, height] = (process.env.VIEWPORT ?? "1280x720").split("x").map(Number);
const hour = process.env.HOUR ?? "11";
/** Strike fixture moments (ms, see fixture-strike-data.ts): first glint, strike, end. */
const GLINT_MS = 0;
const STRIKE_MS = 5100;
const FIXTURE_END_MS = 7500;
const HITCH_WINDOW_MS = 600;
const DUSK_HOUR = 18.5;
mkdirSync(outputDir, { recursive: true });

const shoot = (page: Page, file: string) => page.screenshot({ path: resolve(outputDir, file) });
const programs = async (page: Page) =>
  ((await call(page, "resources")) as { programs: number } | null)?.programs ?? null;

/** Records every rAF delta (ms, with its time since `start`) until `collect` is called. */
const startFrameRecorder = (page: Page) => page.evaluate(() => {
  const anyWindow = window as any;
  const start = performance.now();
  const frames: { at: number; delta: number }[] = [];
  let last = start;
  const tick = (now: number) => {
    frames.push({ at: now - start, delta: now - last });
    last = now;
    if (anyWindow.__cin6Recording) requestAnimationFrame(tick);
  };
  anyWindow.__cin6Recording = true;
  anyWindow.__cin6Frames = frames;
  requestAnimationFrame(tick);
});

const collectFrames = (page: Page) => page.evaluate(() => {
  const anyWindow = window as any;
  anyWindow.__cin6Recording = false;
  return anyWindow.__cin6Frames as { at: number; delta: number }[];
});

const longestFrame = (frames: readonly { at: number; delta: number }[], fromMs: number) => frames
  .filter(frame => frame.at >= fromMs && frame.at < fromMs + HITCH_WINDOW_MS)
  .reduce((longest, frame) => Math.max(longest, frame.delta), 0);

const median = (values: number[]) => [...values].sort((first, second) => first - second)[values.length >> 1] ?? 0;

/** 1. The first glint and the first strike on a fresh page: no program compile, no long frame. */
const prewarmRun = async (page: Page) => {
  const before = await programs(page);
  await startFrameRecorder(page);
  await call(page, "play", true, "strike");
  await page.waitForTimeout(HITCH_WINDOW_MS);
  const afterGlint = await programs(page);
  await page.waitForTimeout(STRIKE_MS);
  const afterStrike = await programs(page);
  await page.waitForFunction(() => !(window as any).__cinematicTest.state().active, null,
    { timeout: FIXTURE_END_MS * 3 });
  const frames = await collectFrames(page);
  return { afterGlint, afterStrike, before, glintLongestMs: longestFrame(frames, GLINT_MS),
    medianFrameMs: median(frames.map(frame => frame.delta)), strikeLongestMs: longestFrame(frames, STRIKE_MS) };
};

/** 2. Seeked glint stills, then live strikes in the paused low shot. */
const strikeStills = async (page: Page, label: string) => {
  for (const [name, time] of [["glint-iso", 1500], ["glint-low", 4800]] as const) {
    await call(page, "seek", time, "strike");
    await settle(page);
    await shoot(page, `${label}-${name}.png`);
  }
  const pose = (await call(page, "pose")) as { orbit: { targetX: number; targetZ: number } };
  await call(page, "strike", pose.orbit.targetX, pose.orbit.targetZ);
  await settle(page);
  await shoot(page, `${label}-strike-bolt.png`);
  await page.waitForTimeout(400);
  await shoot(page, `${label}-strike-impact.png`);
  await call(page, "seek", 11000, "owner");
  await settle(page);
  await page.waitForTimeout(450);
  await shoot(page, `${label}-owner-shot-b-glint.png`);
  await call(page, "stop");
  await settle(page);
};

/** Stills at the given real-time offsets (ms) after `begin` runs. */
const timedStills = async (page: Page, label: string, begin: () => Promise<unknown>, stills: [string, number][]) => {
  let elapsed = 0;
  await begin();
  for (const [name, at] of stills) {
    await page.waitForTimeout(at - elapsed);
    elapsed = at;
    await shoot(page, `${label}-${name}.png`);
  }
};

const weatherRun = async (page: Page, label: string) => {
  const clear = await measureFrames(page, 2000);
  await shoot(page, `${label}-weather-0-clear.png`);
  await timedStills(page, label, () => call(page, "weather", "rain", 4000),
    [["weather-1-1s", 1000], ["weather-2-2s", 2000], ["weather-3-4s", 4000]]);
  const rain = await measureFrames(page, 2000);
  await call(page, "weather", "clear", 0);
  return { clear, rain };
};

const hourRun = async (page: Page, label: string) => {
  await shoot(page, `${label}-hour-0-day.png`);
  await timedStills(page, label, () => call(page, "timeOfDay", DUSK_HOUR),
    [["hour-1-1s", 1000], ["hour-2-2s", 2000], ["hour-3-3s", 3000], ["hour-4-dusk", 4500]]);
};

const reviewQuality = async (url: string, quality: string) => {
  const errors: string[] = [];
  const page = await openCinematicGame(browser, url,
    { errors, height: height!, hour, quality, saveText, width: width! });
  await shoot(page, `${quality}-00-before.png`);
  const prewarm = await prewarmRun(page);
  await strikeStills(page, quality);
  const weather = await weatherRun(page, quality);
  await hourRun(page, quality);
  const report = { errors, prewarm, quality, viewport: `${width}x${height}`, weather };
  writeFileSync(resolve(outputDir, `${quality}-report.json`), JSON.stringify(report, null, 2));
  console.log(`${quality}: ${JSON.stringify(prewarm)} (${errors.length} page errors)`);
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
