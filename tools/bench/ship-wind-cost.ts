import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { emitBenchJson } from "./bench-json";
import { fleetIsoView, stageShipWind } from "./ship-wind-stage";
import { openReviewPage, pinLight, prepareScene, stageReviewSave } from "./water-review-page";

/**
 * SHIP-WIND frame cost (for the TOOL-4 A/B runner): the frozen owner-save frame with the four-ship review
 * fleet in storm wind at the close iso zoom, where the sails cover most pixels. Each sample draws
 * the frame and waits for the GPU (a one-pixel read), so it is CPU + GPU time of a whole frame.
 * The dev server serves the checkout the bench runs in (its own renderer).
 *
 *   SAVE=<save.json> [QUALITY=high] [FRAMES=240] [VIEWPORT=1280x800]
 */
const sourcePath = process.env.SAVE;
assert(sourcePath, "Set SAVE");
const quality = process.env.QUALITY ?? "high";
const frames = Number(process.env.FRAMES ?? 240);
const [width, height] = (process.env.VIEWPORT ?? "1280x800").split("x").map(Number);
const WARMUP_FRAMES = 40;
const MODEL_LOAD_MS = 3000;

const sample = (page: Page, count: number, start: number) => page.evaluate(async ({ count, start }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const pixel = new Uint8Array(4), times: number[] = [];
  for (let frame = 0; frame < count; frame++) {
    debug.frozenFrame.time = start + frame / 30;
    const begin = performance.now();
    debug.draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    times.push(performance.now() - begin);
    if (frame % 20 === 0) await new Promise(next => requestAnimationFrame(next));
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)]!, p90: times[Math.floor(times.length * .9)]! };
}, { count, start });

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const { page } = await openReviewPage(browser, url, quality, stageReviewSave(readFileSync(sourcePath, "utf8")),
    { height: height!, width: width! });
  await prepareScene(page);
  await pinLight(page, "day");
  await fleetIsoView(page, 1, 1.6);
  await stageShipWind(page, "strong", 12);
  // Lazily loaded ship models (the raiders' pirate pack) finish loading before the warm-up.
  await page.waitForTimeout(MODEL_LOAD_MS);
  await stageShipWind(page, "strong", 12);
  await sample(page, WARMUP_FRAMES, 0);
  const result = await sample(page, frames, 12);
  console.log(`ship-wind ${quality} frame median ${result.median.toFixed(3)} ms p90 ${result.p90.toFixed(3)} ms`);
  emitBenchJson({ frame: result });
} finally {
  await browser.close();
  await server.close();
}
