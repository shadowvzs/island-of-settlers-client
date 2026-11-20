import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { exposeWeather } from "../bench/cloud-review-page";
import { centreOn, type LiveWindow, settleDecorations } from "../bench/decor-review-session";
import { openFixturePage, writeFlatIslandGame } from "../bench/flat-island-fixture";
import { HIDE_UI } from "../bench/parity-helpers";

/**
 * Maya HQ statue/prop review: the portico gilded columns and the yard figurine, close and at
 * normal gameplay distance, through WebGL and the `webgpu-gl` node renderer.
 *
 *   OUTPUT_DIR=<captures>/hq-statue-detail/before \
 *     <captures>/browser-slot.sh npx tsx tools/review/hq-statue-detail.ts
 */
const CAPTURES = process.env.CAPTURES ??
  "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures";
const OUT = resolve(process.env.OUTPUT_DIR ?? resolve(CAPTURES, "hq-statue-detail"));
const RENDERERS = (process.env.MATRIX_RENDERERS ?? "webgl,webgpu-gl").split(",").filter(Boolean);
const QUALITY = process.env.QUALITY ?? "high";
const VIEWPORT = { height: 900, width: 1400 };
const CELLS = 96;
/** The fixture island's headquarters stands at the island centre; these are its local subjects. */
const VIEWS = [
  { lift: 2, name: "hq-close", x: 51, z: 52, zoom: 2.6 },
  { lift: 1.55, name: "hq-columns", x: 48.55, z: 49.9, zoom: 6.2 },
  { lift: 1.1, name: "hq-figure", x: 50.15, z: 46.72, zoom: 8.5 }
] as const;

/** Every finished fixture building counts as occupied (daylight is pinned, occupancy is irrelevant). */
const writeIsland = (page: Page) => writeFlatIslandGame(page, {
  buildings: [], cells: CELLS, grassGround: true, name: "HQ statue detail review", nation: "maya",
  settlers: 12, stockAll: 200
});

const setHour = (page: Page, hour: number) => page.evaluate(hour => {
  const { controller } = (window as LiveWindow).__weather;
  const saved = controller.saveState();
  controller.loadState({ ...saved, cycling: false, hour, rain: 0, snow: 0, targetHour: hour, targetRain: 0,
    targetSnow: 0 });
}, hour);

const openGame = async (browser: Browser, url: string, renderer: string, errors: string[]): Promise<Page> => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: VIEWPORT });
  page.on("pageerror", error => errors.push(`${renderer} pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && /shader|tsl|webgpu|THREE/i.test(message.text()))
      errors.push(`${renderer} ${message.text().slice(0, 300)}`);
  });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value;");
  await exposeWeather(page);
  await openFixturePage(page, url);
  await writeIsland(page);
  await page.goto(`${url}?quality=${QUALITY}&cache=0&skipLogin=1&time=day&reveal=1&renderer=${renderer}`);
  await page.waitForFunction(() => (window as LiveWindow).__islandReady === true, null, { timeout: 300_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 300_000 });
  await page.addStyleTag({ content: HIDE_UI });
  if (renderer !== "webgl") {
    const mode = await page.evaluate(() => (window as LiveWindow).__webgpuSpike?.stats().mode);
    assert.equal(mode, renderer, `${renderer} is not active; the page fell back to WebGL2`);
  }
  return page;
};

const captureView = async (page: Page, renderer: string, name: string,
  view: { lift: number; x: number; z: number; zoom: number }, rows: unknown[]) => {
  await centreOn(page, { x: view.x, z: view.z }, view.zoom, view.lift);
  await settleDecorations(page, 20);
  await page.waitForTimeout(300);
  const file = `${renderer}-${name}-day.png`;
  await page.screenshot({ path: resolve(OUT, file) });
  rows.push({ file, renderer, view: name });
};

const captureRenderer = async (browser: Browser, url: string, renderer: string, errors: string[],
  rows: unknown[]) => {
  const page = await openGame(browser, url, renderer, errors);
  try {
    await setHour(page, 12);
    for (const view of VIEWS) await captureView(page, renderer, view.name, view, rows);
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [], rows: unknown[] = [];
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    for (const renderer of RENDERERS) await captureRenderer(browser, url, renderer, errors, rows);
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(resolve(OUT, "capture.json"),
    JSON.stringify({ errors, generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(JSON.stringify({ errors: errors.length, out: OUT }));
  if (errors.length) process.exitCode = 1;
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
