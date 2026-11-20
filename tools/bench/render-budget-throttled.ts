/**
 * R09/C13 budget controller on the owner save: frame rate and frame-time p95 with Adaptive
 * performance Auto off ("before") and on ("after"), under CDP CPU throttling and/or a weak GPU,
 * plus review captures of fixed render scales on High and Minimal.
 *
 * OWNER_SAVE=<save.json> OUTPUT_DIR=<dir> [GPU=igpu] [CPU_THROTTLE=4] [QUALITIES=high,minimal]
 * [VIEWS=iso,possessed] [MODES=off,auto] [SETTLE_MS=30000] [MEASURE_MS=10000]
 * npx tsx tools/bench/render-budget-throttled.ts
 * SCALES=1,0.75,0.6 additionally captures each fixed scale (Auto off) at close and normal iso zoom.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

const sourcePath = process.env.OWNER_SAVE;
assert(sourcePath, "Set OWNER_SAVE to the read-only save to measure");
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR");
const save = readFileSync(sourcePath, "utf8");
const output = resolve(outputDir);
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const throttle = Number(process.env.CPU_THROTTLE ?? 1);
const settleMs = Number(process.env.SETTLE_MS ?? 30000);
const measureMs = Number(process.env.MEASURE_MS ?? 10000);
const list = (value: string | undefined, fallback: string) => (value ?? fallback).split(",").filter(Boolean);
const tag = process.env.REPORT_TAG ?? (process.env.GPU === "igpu" ? "igpu" : `cpu${throttle}x`);
mkdirSync(output, { recursive: true });

interface FrameWindow {
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  frames: number;
}

/** rAF intervals measured in the page itself (independent of the game's own statistics). */
const measureFrames = (page: Page, milliseconds: number) => page.evaluate((duration) =>
  new Promise<FrameWindow>(done => {
    const intervals: number[] = [];
    let last = performance.now();
    const end = last + duration;
    const step = (now: number) => {
      intervals.push(now - last);
      last = now;
      if (now < end) return requestAnimationFrame(step);
      const sorted = [...intervals].sort((left, right) => left - right);
      const total = intervals.reduce((sum, value) => sum + value, 0);
      done({
        fps: intervals.length / (total / 1000),
        frameMsP50: sorted[Math.floor(sorted.length * 0.5)]!,
        frameMsP95: sorted[Math.floor(sorted.length * 0.95)]!,
        frames: intervals.length
      });
    };
    requestAnimationFrame(step);
  }), milliseconds);

const openGame = async (browser: Browser, url: string, quality: string, auto: boolean) => {
  const page = await browser.newPage({ viewport: { height: height!, width: width! } });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log(`pageerror: ${error.message}`);
  });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript((adaptive) => {
    (window as any).__name = (value: unknown) => value;
    localStorage.setItem("island-of-settlers.graphics.adaptive", adaptive);
  }, JSON.stringify({ auto, frameRateLimit: "display", lowestScale: "detail" }));
  await stageStartupSave(page, url, save);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 480000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(6000);
  return { errors, page };
};

const enterPossessedView = async (page: Page) => {
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null,
    { timeout: 60000 });
  await page.waitForTimeout(4000);
};

const throttleCpu = async (page: Page, rate: number) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
};

/** One Auto off / on run of a view: settle, then measure; the controller state is read after. */
const measureRun = async (browser: Browser, url: string, quality: string, view: string, mode: string) => {
  const { errors, page } = await openGame(browser, url, quality, mode === "auto");
  if (view === "possessed") await enterPossessedView(page);
  const cdp = await throttleCpu(page, throttle);
  const trace: unknown[] = [];
  const started = Date.now();
  while (Date.now() - started < settleMs) {
    await page.waitForTimeout(2000);
    trace.push(await page.evaluate(() => window.__renderBudget?.snapshot()));
  }
  const frames = await measureFrames(page, measureMs);
  const budget = await page.evaluate(() => window.__renderBudget?.snapshot());
  const buffer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    return gl ? `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` : "";
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const label = `${quality}-${view}-${tag}-${mode}`;
  await page.screenshot({ path: resolve(output, `${label}.png`) });
  const report = { budget, buffer, errors, frames, mode, quality, throttle, trace, view };
  writeFileSync(resolve(output, `${label}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ budget, buffer, frames, label }));
  await page.close();
};

/** Fixed scales (Auto off) at close and normal iso zoom: is the resolution change acceptable? */
const captureScales = async (browser: Browser, url: string, quality: string, scales: readonly number[]) => {
  const { page } = await openGame(browser, url, quality, false);
  for (const [zoomName, zoom] of [["normal", 1], ["close", 2.2]] as const) {
    await page.evaluate((value) => {
      const settlement = (window as any).__settlement;
      const buildings = settlement.simulation.buildings();
      const focus = buildings.find((entry: any) => /headquarter|hq/i.test(String(entry.type))) ?? buildings[0];
      settlement.focusGround(focus.x, focus.z, value);
    }, zoom);
    for (const scale of scales) {
      await page.evaluate((value) => window.__renderBudget?.setRenderScale(value), scale);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(output, `${quality}-scale${Math.round(scale * 100)}-${zoomName}.png`) });
    }
  }
  await page.close();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const scales = list(process.env.SCALES, "").map(Number);
  for (const quality of list(process.env.QUALITIES, "high,minimal")) {
    if (scales.length > 0) {
      await captureScales(browser, url, quality, scales);
      continue;
    }
    for (const view of list(process.env.VIEWS, "iso"))
      for (const mode of list(process.env.MODES, "off,auto")) await measureRun(browser, url, quality, view, mode);
  }
} finally {
  await browser.close();
  await server.close();
}
