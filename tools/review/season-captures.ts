import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { openFrozenPage, patchReviewRoutes, pinScene, stageFrozenSave } from "../bench/frozen-frame-review";
import {
  CAPTURES, type DiffStats, HIDE_UI, OWNER_SAVE, PARITY_VIEWPORT, settleFrame, writeDiffPng
} from "../bench/parity-helpers";

/**
 * Seasons-1 acceptance captures: the owner town (frozen frame) in summer, full autumn and mid-transition,
 * High and Minimal, at close / normal / far iso zoom, plus summer-vs-autumn diff images (buildings must not
 * change) and an autumn shot on the WebGPU renderer's WebGL2 backend (the TSL twin).
 *
 *   OUTPUT_DIR=<captures>/seasons-1/town <captures>/browser-slot.sh npx tsx tools/review/season-captures.ts
 * Env: SEASON_FOCUS='{"x":170,"z":68}', SEASON_PRESETS=high,minimal, SEASON_ZOOMS=2.6,1.2,.75,
 * SEASON_GARDEN=1 (the ?garden=1 lab: every plant kind and two tree lines beside the start; no save;
 * the camera centres between the plant rows and the tree lines), SEASON_LOOKS=summer,autumn,mid (any of LOOKS;
 * a look with `storm` pins heavy rain, and a monsoon storm also applies the monsoon sky and wind),
 * SEASON_WEBGPU=0 skips and SEASON_WEBGPU_LOOKS=autumn,winter picks the WebGPU (WebGL2 backend) looks.
 */
const GARDEN = process.env.SEASON_GARDEN === "1";
const GARDEN_QUERY = "&size=128&seed=123&garden=1&reveal=1";
const OUT = resolve(process.env.OUTPUT_DIR ?? join(CAPTURES, "seasons-1", "town"));
const FOCUS = JSON.parse(process.env.SEASON_FOCUS ?? '{"x":170,"z":68}') as { x: number; z: number };
const PRESETS = (process.env.SEASON_PRESETS ?? "high,minimal").split(",");
const ZOOMS = (process.env.SEASON_ZOOMS ?? "2.6,1.2,.75").split(",").map(Number);
interface Look {
  /** A live (running) frame instead of the frozen one: falling leaves and other motion (one shot). */
  live?: boolean;
  query: string;
  /** Pinned heavy rain (cloud cover 0.95); the monsoon weight adds its sky and wind. */
  storm?: { monsoon: number };
}
const LOOKS: Readonly<Record<string, Look>> = {
  autumn: { query: "&season=autumn" },
  "autumn-live": { live: true, query: "&season=autumn" },
  "leaf-drop-live": { live: true, query: "&season=winter&seasonFrom=autumn&seasonBlend=0.25" },
  /** Bare, snow-free trees on the way to winter (leaves down, no snow yet; seasons-4). */
  dormant: { query: "&season=winter&seasonFrom=autumn&seasonBlend=0.35" },
  /** T1 winter on the GPU: snowfall over bare trees, the cover building, full winter and the melt. */
  "snow-build": { query: "&season=winter&seasonFrom=autumn&seasonBlend=0.62" },
  "snow-late": { query: "&season=winter&seasonFrom=autumn&seasonBlend=0.8" },
  "snowfall-live": { live: true, query: "&season=winter&seasonFrom=autumn&seasonBlend=0.4" },
  winter: { query: "&season=winter" },
  "melt-early": { query: "&season=spring&seasonFrom=winter&seasonBlend=0.12" },
  "melt-mid": { query: "&season=spring&seasonFrom=winter&seasonBlend=0.22" },
  /** The dry season of the two-season mode (summer after the monsoon). */
  dry: { query: "&season=summer&seasonFrom=monsoon&seasonBlend=1" },
  "dry-storm": { query: "&season=summer", storm: { monsoon: 0 } },
  mid: { query: "&season=autumn&seasonFrom=summer&seasonBlend=0.5" },
  monsoon: { query: "&season=monsoon" },
  "monsoon-storm": { query: "&season=monsoon", storm: { monsoon: 1 } },
  spring: { query: "&season=spring" },
  "spring-early": { query: "&season=spring&seasonFrom=winter&seasonBlend=0.65" },
  "spring-mid": { query: "&season=spring&seasonFrom=winter&seasonBlend=0.8" },
  summer: { query: "&season=summer" }
};
const SEASON_KEYS = (process.env.SEASON_LOOKS ?? "summer,autumn,mid").split(",");
/** Looks shot on the WebGPU renderer's WebGL2 backend (SEASON_WEBGPU_LOOKS, High only). */
const WEBGPU_LOOKS = (process.env.SEASON_WEBGPU_LOOKS ?? "autumn").split(",");
type SeasonKey = string;

/** A storm look: heavy rain pinned on the frozen frame's daylight, plus the monsoon sky and wind. */
const pinStorm = (page: Page, monsoon: number) => page.evaluate(async weight => {
  const debug = (globalThis as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { computeEnvironment, TIME_PRESETS } = await load("/src/render-common/environment.ts");
  const { applyMonsoonWeather } = await load("/src/render-common/seasonal-appearance/monsoon-weather.ts");
  debug.pinned = applyMonsoonWeather(computeEnvironment(debug.world.sun, TIME_PRESETS.day, 1, 0, 0.95, 0), weight, 3);
}, monsoon);

const shoot = async (page: Page, zoom: number, file: string) => {
  await page.evaluate(({ focus, zoom: level }) => {
    const debug = (globalThis as any).__atmosphereLiveDebug;
    const frame = debug.frozenFrame;
    if (focus) Object.assign(frame.camera, { centerX: focus.x, centerZ: focus.z });
    else Object.assign(frame.camera, { centerX: frame.camera.centerX - 7, centerZ: frame.camera.centerZ - 7 });
    Object.assign(frame.camera, { tilt: 0, yaw: 0, zoom: level });
    frame.time = 12;
    debug.draw();
  }, { focus: GARDEN ? null : FOCUS, zoom });
  await settleFrame(page);
  await page.screenshot({ clip: { height: PARITY_VIEWPORT.height, width: PARITY_VIEWPORT.width, x: 0, y: 0 },
    path: file });
};

/** A running frame (the leaves keep falling): the start view after a few seconds of play. */
const shootLive = async (page: Page, file: string) => {
  await page.addStyleTag({ content: HIDE_UI });
  await page.waitForTimeout(8000);
  await page.screenshot({ clip: { height: PARITY_VIEWPORT.height, width: PARITY_VIEWPORT.width, x: 0, y: 0 },
    path: file });
  return file;
};

/** The garden lab: a generated island, no save, the camera on its start. */
const openGardenPage = async (browser: Browser, url: string, query: string) => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: PARITY_VIEWPORT });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  await patchReviewRoutes(page);
  await page.goto(`${url}?cache=0&skipLogin=1${query}${GARDEN_QUERY}`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  return { errors, page };
};

const captureSeason = async (browser: Browser, url: string, save: string, preset: string, season: SeasonKey,
  renderer = "webgl") => {
  const look = LOOKS[season];
  if (!look) throw new Error(`Unknown look ${season}`);
  const query = `&renderer=${renderer}&hdr=off${look.query}${process.env.SEASON_QUERY ?? ""}`;
  const { errors, page } = GARDEN ? await openGardenPage(browser, url, `&quality=${preset}${query}`)
    : await openFrozenPage(browser, url, { quality: preset, query, stagedSave: stageFrozenSave(save),
      viewport: PARITY_VIEWPORT });
  try {
    if (!GARDEN)
      await page.evaluate(({ x, z }) => (globalThis as any).__settlement?.focusGround?.(x, z, 1.2), FOCUS);
    await page.waitForTimeout(1500);
    if (look.live) return { errors, files: [await shootLive(page, join(OUT, `${preset}-${season}-${renderer}.png`))] };
    await pinScene(page, "day", true);
    if (look.storm) await pinStorm(page, look.storm.monsoon);
    await page.evaluate(() => {
      const debug = (globalThis as any).__atmosphereLiveDebug;
      debug.freeze();
      debug.stripDynamic(debug.frozenFrame);
    });
    await page.addStyleTag({ content: HIDE_UI });
    const files: string[] = [];
    for (const zoom of ZOOMS) {
      const file = join(OUT, `${preset}-${season}-${renderer}-z${zoom}.png`);
      await shoot(page, zoom, file);
      files.push(file);
    }
    return { errors, files };
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const save = readFileSync(OWNER_SAVE, "utf8");
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const errors: string[] = [];
  const diffs: Array<{ file: string; stats: DiffStats }> = [];
  try {
    for (const preset of PRESETS) {
      const shots: Partial<Record<SeasonKey, string[]>> = {};
      for (const season of SEASON_KEYS) {
        const result = await captureSeason(browser, url, save, preset, season);
        shots[season] = result.files;
        errors.push(...result.errors.map(error => `${preset}/${season}: ${error}`));
      }
      for (const [index, zoom] of ZOOMS.entries()) {
        if (!shots.summer || !shots.autumn) break;
        const file = join(OUT, `diff-${preset}-summer-autumn-z${zoom}.png`);
        diffs.push({ file, stats: await writeDiffPng(browser, shots.summer![index]!, shots.autumn![index]!, file) });
      }
    }
    if (process.env.SEASON_WEBGPU !== "0") {
      for (const season of WEBGPU_LOOKS) {
        const result = await captureSeason(browser, url, save, "high", season, "webgpu-gl");
        errors.push(...result.errors.map(error => `webgpu-gl/${season}: ${error}`));
      }
    }
    writeFileSync(join(OUT, "season-captures.json"), JSON.stringify({ diffs, errors, focus: FOCUS }, null, 2));
    console.log(JSON.stringify({ diffs, errors }, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
