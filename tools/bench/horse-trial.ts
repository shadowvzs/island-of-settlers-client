/**
 * The horse + rider trial (`?horse=1`): the two horses circling the start,
 * one screenshot while they trot, plus the downloaded mount files, into
 * docs/terrain-benchmarks/horse-trial-2026-10-07/ (OUT_DIR to change it).
 *   npx tsx tools/bench/horse-trial.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { openWorkerMap } from "./worker-bench";

const OUTPUT = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/horse-trial-2026-10-07";
const QUALITY = process.env.QUALITY ?? "high";
const MAP = `size=64&seed=42&cache=0&time=day&horse=1&quality=${QUALITY}`;
const ZOOM_WHEEL = -500;
/** Seconds after the start: the trial plan trots from 9 to 15 s. */
const SHOT_AT = Number(process.env.SHOT_AT ?? 11.5);

/** Zooms on the workers' start, the centre of the horses' circle. */
const zoomOnStart = async (page: Page) => {
  const point = await page.evaluate(() => {
    const states = window.__workers!.getStates();
    const x = states.reduce((sum, state) => sum + state.x, 0) / states.length;
    const z = states.reduce((sum, state) => sum + state.z, 0) / states.length;
    return window.__worker!.projectGround(x, z);
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, ZOOM_WHEEL);
};

const readMountDownloads = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => new URL(entry.name).pathname.startsWith("/workers/mounts/"))
      .map((entry) => ({
        bytes: entry.encodedBodySize,
        file: new URL(entry.name).pathname.slice("/workers/mounts/".length)
      }))
  );

const shoot = async (page: Page, url: string, errors: string[]) => {
  const opened = Date.now();
  await openWorkerMap(page, url, MAP);
  const ready = (Date.now() - opened) / 1000;
  await zoomOnStart(page);
  await page.waitForTimeout(Math.max(500, SHOT_AT * 1000));
  await page.screenshot({ path: `${OUTPUT}/horse-trial.png` });
  await page.mouse.wheel(0, 350);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUTPUT}/horse-trial-normal.png` });
  const downloads = await readMountDownloads(page);
  return {
    downloadBytes: downloads.reduce((sum, file) => sum + file.bytes, 0),
    downloads,
    errors: [...errors],
    quality: QUALITY,
    readySeconds: ready
  };
};

await mkdir(OUTPUT, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const isFavicon = message.location().url.endsWith("/favicon.ico");
    if (message.type() === "error" && !isFavicon) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const result = await shoot(page, url, errors);
  await writeFile(`${OUTPUT}/horse-trial-validation.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ downloadBytes: result.downloadBytes, errors: result.errors }));
} finally {
  await browser.close();
  await server.close();
}
