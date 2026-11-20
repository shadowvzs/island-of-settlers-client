import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";

import { patchReviewRoutes } from "./frozen-frame-review";

/**
 * Shared inputs of the frozen-frame parity captures (WG-0 `wg0-webgl-parity`, WG-1b
 * `review/renderer-parity`): the owner save, the deterministic seed-123 save, the possessed entry
 * and the one image-diff implementation both tools use.
 */
export const CAPTURES = process.env.CAPTURES ??
  "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures";
export const OWNER_SAVE = process.env.OWNER_SAVE ?? join(CAPTURES, "perf", "owner-laggy-2026-11-07.json");
export const PARITY_VIEWPORT = { height: 900, width: 1400 };
/** Per-channel level above which a pixel counts as visibly different. */
export const DIFF_THRESHOLD = 4;
/** The x16 factor of the written difference image. */
export const DIFF_AMPLIFY = 16;

export type ParityRenderer = "webgl" | "webgpu" | "webgpu-gl";

/** Hides the HUD so only the WebGL and WebGPU canvases are captured. */
export const HIDE_UI = `#viewport > :not(#view, #webgpu-view, #loading-screen) { display: none !important; }
body > :not(#viewport) { display: none !important; }`;

/**
 * Re-draw the frozen frame after a >=1 s gap: the camera rig's target-height easing resets to the
 * exact value on its first update after a long interval, so both runs share the same camera.
 */
export const settleFrame = async (page: Page, draws = 4) => {
  await page.waitForTimeout(1100);
  for (let index = 0; index < draws; index++) {
    await page.evaluate(() => (globalThis as any).__atmosphereLiveDebug.draw());
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);
};

/**
 * The app falls back to WebGL2 when the requested node renderer cannot start. The diff numbers are
 * meaningless then, so the run fails instead of reporting a WebGL-vs-WebGL comparison.
 */
export const assertRendererActive = async (page: Page, renderer: ParityRenderer) => {
  if (renderer === "webgl") return;
  const mode = await page.evaluate(() =>
    (globalThis as { __webgpuSpike?: { stats(): { mode?: string } } }).__webgpuSpike?.stats().mode);
  assert.equal(mode, renderer, `${renderer} is not active; the page fell back to WebGL2`);
};

export interface DiffStats {
  changedPixels: number;
  maxChannel: number;
  meanChannel: number;
  overThreshold: number;
}

export interface SeedSaveOptions {
  /** Save name recorded in the generated file. */
  name: string;
  /** Destination of the generated save (reused by later runs while it exists). */
  path: string;
}

/**
 * A cold base worktree can take longer than the shared helper's 60 s to load the possessed body; the
 * node renderer also compiles the possessed pipelines here (LOAD_TIMEOUT_MS raises the limit).
 */
const POSSESS_TIMEOUT_MS = Math.max(180_000, Number(process.env.LOAD_TIMEOUT_MS ?? 0));

export const enterPossessed = async (page: Page) => {
  await page.evaluate(() => (globalThis as any).__exploration.controller.enter());
  await page.waitForFunction(() => (globalThis as any).__exploration.controller.phase() === "possessed",
    null, { timeout: POSSESS_TIMEOUT_MS });
  await page.waitForTimeout(4000);
};

/** Creates the deterministic seed-123 save through the game's own save serialization. */
export const createSeedSave = async (browser: Browser, url: string, options: SeedSaveOptions) => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: PARITY_VIEWPORT });
  await patchReviewRoutes(page);
  await page.goto(`${url}?quality=high&cache=0&skipLogin=1&seed=123&size=128&reveal=1&view=100,52,2.2`);
  await page.waitForFunction(() => (globalThis as any).__islandReady === true, null, { timeout: 300_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 300_000 });
  await page.waitForTimeout(2500);
  const save = await page.evaluate(async (name) => {
    const debug = (globalThis as any).__atmosphereLiveDebug;
    const path = "/src/shared/settlement/game-save.ts";
    const { createGameSave } = await import(/* @vite-ignore */ path);
    return JSON.stringify(await createGameSave(debug.world,
      (globalThis as any).__settlement.simulation.saveState(),
      { animals: [], name, savedAt: Date.now(), source: "generated" }));
  }, options.name);
  writeFileSync(options.path, save);
  await page.close();
  return save;
};

/**
 * Statistics and the amplified x16 difference of two PNG files, decoded and compared in a scratch
 * page. This is the single image-diff implementation of the parity tools (the WG-0 Python copy was
 * removed); a run compares reloaded captures with it.
 */
export const diffPngs = async (browser: Browser, before: string, after: string) => {
  const page = await browser.newPage();
  try {
    await page.setContent("<canvas id='diff'></canvas>");
    // Install the Playwright helper once as a plain script; no function wrapper can reference it first.
    await page.evaluate("globalThis.__name = (value) => value;");
    const result = await page.evaluate(async ({ afterUrl, amplify, beforeUrl, threshold }) => {
      const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const [before, after] = await Promise.all([load(beforeUrl), load(afterUrl)]);
      if (before.width !== after.width || before.height !== after.height)
        throw new Error(`size ${before.width}x${before.height} != ${after.width}x${after.height}`);
      const width = before.width, height = before.height;
      const canvas = (texture: CanvasImageSource) => {
        const target = document.createElement("canvas");
        target.width = width;
        target.height = height;
        const context = target.getContext("2d")!;
        context.drawImage(texture, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const a = canvas(before), b = canvas(after);
      const output = new ImageData(width, height);
      let changed = 0, over = 0, max = 0, total = 0;
      for (let index = 0; index < a.length; index += 4) {
        let pixelMax = 0;
        for (let channel = 0; channel < 3; channel++) {
          const value = Math.abs(a[index + channel]! - b[index + channel]!);
          pixelMax = Math.max(pixelMax, value);
          total += value;
        }
        max = Math.max(max, pixelMax);
        if (pixelMax > 0) changed++;
        if (pixelMax > threshold) over++;
        output.data[index] = Math.min(255, pixelMax * amplify);
        output.data[index + 1] = Math.min(255, pixelMax * amplify);
        output.data[index + 2] = Math.min(255, pixelMax * amplify);
        output.data[index + 3] = 255;
      }
      const target = document.getElementById("diff") as HTMLCanvasElement;
      target.width = width;
      target.height = height;
      target.getContext("2d")!.putImageData(output, 0, 0);
      const pixels = width * height;
      return {
        diffUrl: target.toDataURL("image/png") as string,
        stats: {
          changedPixels: changed / pixels * 100,
          maxChannel: max,
          meanChannel: total / (pixels * 3),
          overThreshold: over / pixels * 100
        } satisfies DiffStats
      };
    }, { afterUrl: `data:image/png;base64,${readFileSync(after).toString("base64")}`,
      amplify: DIFF_AMPLIFY, beforeUrl: `data:image/png;base64,${readFileSync(before).toString("base64")}`,
      threshold: DIFF_THRESHOLD });
    return result;
  } finally {
    await page.close();
  }
};

/** Writes the x16 difference image and returns its statistics. */
export const writeDiffPng = async (browser: Browser, before: string, after: string, path: string) => {
  const result = await diffPngs(browser, before, after);
  writeFileSync(path, Buffer.from(result.diffUrl.split(",")[1]!, "base64"));
  return result.stats;
};
