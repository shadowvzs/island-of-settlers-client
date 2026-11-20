import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { enterPossessedView, stageStartupSave } from "./frame-profile";

/**
 * R01/C01 baseline with the built-in dev profiler (`?passes=1`, no source patching): per stage and
 * render pass CPU ms, GPU ms (sequential timer queries), draw calls and triangles; character
 * counters (crowd stage ms, Skeleton.update per pass, bone-texture bytes, LOD/tier counts);
 * estimated GPU bytes. The source save is only read.
 *
 * Usage (browser via captures/browser-slot.sh):
 *   [OWNER_SAVE=<save>] OUTPUT_DIR=<dir> [VIEWPORT=1920x1080] [QUALITIES=high,minimal]
 *   [VIEWS=iso,possessed] [SECONDS=8] [QUERY=crowd=skinned] [BUILDING_BATCH=0]
 *   npx tsx tools/bench/render-pass-profile.ts
 * `QUERY` appends extra dev switches to the game URL (A/B runs of one build, e.g. the C06 rollback).
 * BUILDING_BATCH=0 draws every building part on its own (the cross-building batches stay hidden).
 * Without OWNER_SAVE the tool starts the standard 128² seed-123 island instead of a save.
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR");
const saveText = sourcePath ? readFileSync(sourcePath, "utf8") : null;
const extraQuery = process.env.QUERY ? `&${process.env.QUERY}` : "";
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const views = (process.env.VIEWS ?? "iso,possessed").split(",");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const measureMs = Number(process.env.SECONDS ?? 8) * 1000;
const unbatched = process.env.BUILDING_BATCH === "0";
/** INIT: an extra page init script (for example to pin a dev switch before the first frame). */
const initScript = process.env.INIT;
mkdirSync(outputDir, { recursive: true });

const resetProfiles = (page: Page) => page.evaluate(() => {
  const root = globalThis as any;
  root.__frameProfiler.resetSession();
  root.__characterProfile.reset();
});

const readProfiles = (page: Page) => page.evaluate(() => {
  const root = globalThis as any;
  const gl = document.querySelector("canvas")?.getContext("webgl2");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    characters: root.__characterProfile.report(),
    details: root.__profileDetails,
    frame: root.__frameProfiler.sessionReport(),
    gpu: debug && gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL),
    scene: { actors: root.__settlement.simulation.frames().length,
      buildings: root.__settlement.simulation.buildings().length }
  };
});

const measureView = async (page: Page, quality: string, view: string) => {
  if (view === "possessed") await enterPossessedView(page);
  await resetProfiles(page);
  const started = Date.now();
  await page.waitForTimeout(measureMs);
  const profiles = await readProfiles(page);
  const fps = profiles.frame.frames / ((Date.now() - started) / 1000);
  const label = `${quality}-${view}${unbatched ? "-unbatched" : ""}`;
  await page.screenshot({ path: resolve(outputDir, `${label}.png`) });
  const report = { quality, view, fps, viewport: `${width}x${height}`, ...profiles };
  writeFileSync(resolve(outputDir, `${label}.json`), JSON.stringify(report, null, 2));
  console.log(`${label}: ${fps.toFixed(1)} fps, cpu ${profiles.frame.frameCpuMs.toFixed(2)} ms, ` +
    `gpu ${profiles.frame.frameGpuMs?.toFixed(2) ?? "?"} ms`);
};

const openGame = async (url: string, quality: string, errors: string[]) => {
  const page = await (await browser).newPage({ viewport: { height: height!, width: width! } });
  page.on("pageerror", error => { errors.push(error.message); console.log(error.message); });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  if (initScript) await page.addInitScript(initScript);
  if (unbatched) await page.addInitScript(() => { (window as any).__probeNoBuildingBatch = true; });
  if (saveText !== null) await stageStartupSave(page, url, saveText);
  const freshWorld = saveText === null ? "&reveal=1&size=128&seed=123" : "";
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&passes=1${freshWorld}${extraQuery}`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(6000);
  return page;
};

const { server, url } = await startDevServer();
const browser = launchBrowser();
try {
  for (const quality of qualities) {
    const errors: string[] = [];
    const page = await openGame(url, quality, errors);
    for (const view of views) await measureView(page, quality, view);
    assert.deepEqual(errors, []);
    await page.close();
  }
  if (sourcePath !== undefined) {
    assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
  }
} finally {
  await (await browser).close();
  await server.close();
}
