/**
 * Possessed-sky cloud shimmer review (owner bug 2026-11-13: "champagne" fizz on cloud edges).
 * Real home island, possessed body looking up at the clouds. Per preset it records consecutive
 * frames (a strip of the first few plus a temporal-noise metric over all of them) while steady,
 * after a simulated tab switch (document hidden and rAF paused for HIDDEN_MS, then possession
 * re-entered), after a rAF stall without a visibility event (a long hitch while possessed), right after
 * a resize (as a dynamic-resolution step) and while turning. Flicker = mean |frame - neighbour mean|,
 * boil = per-pixel deviation over all frames (sky and cloud pixels only).
 *
 * Env: OUTPUT (folder), QUALITIES (default high,minimal), HIDDEN_MS (default 5000), FRAMES (24),
 * COVER (pinned possessed-sky cloud cover, default 0.5), PITCH (look-up pitch, default 0.55),
 * SLOW_RATE (CPU throttling of the slow-frame row, default 20), STEADY_ONLY=1 (steady row only).
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  type HookWindow,
  look,
  pauseFrames,
  pinCloudCover,
  possessAndLookUp,
  recordFrames,
  savePng,
  waitForIslandPage
} from "./cloud-review-page";

type RenderBudgetWindow = Window & { __renderBudget: { setRenderScale: (scale: number) => void;
  snapshot: () => unknown } };

const output = resolve(process.env.OUTPUT ?? "cloud-shimmer-review");
const frameCount = Number(process.env.FRAMES ?? 24);
const hiddenMs = Number(process.env.HIDDEN_MS ?? 5000);
const cover = Number(process.env.COVER ?? 0.5);
const slowRate = Number(process.env.SLOW_RATE ?? 20);
const steadyOnly = process.env.STEADY_ONLY === "1";
const lookPitch = Number(process.env.PITCH ?? 0.55);
mkdirSync(output, { recursive: true });

const setRenderScale = (page: Page, scale: number) => page.evaluate(scale =>
  (window as unknown as RenderBudgetWindow).__renderBudget.setRenderScale(scale), scale);

const reviewQuality = async (page: Page, url: string, quality: string) => {
  await page.goto(`${url}?quality=${quality}&size=64&seed=123&cache=0&time=day`);
  await waitForIslandPage(page);
  await possessAndLookUp(page, lookPitch);
  await page.screenshot({ path: resolve(output, `${quality}-full.png`) });
  const rows: Record<string, unknown> = {};
  rows.budget = await page.evaluate(() => (window as unknown as RenderBudgetWindow).__renderBudget.snapshot());
  const record = async (name: string) => {
    const { strip, zoom: _zoom, ...metric } = await recordFrames(page, { count: frameCount });
    savePng(output, `${quality}-${name}-strip`, strip);
    rows[name] = metric;
  };
  await record("steady");
  if (steadyOnly) return { quality, rows };
  await pauseFrames(page, hiddenMs, false);
  await record("after-stall");
  await page.waitForTimeout(1000);
  await record("after-stall-settled");
  await pauseFrames(page, hiddenMs, true);
  await page.waitForTimeout(500);
  const phase = await page.evaluate(() =>
    (window as unknown as HookWindow).__exploration.controller.snapshot().phase);
  if (phase !== "possessed") {
    await page.waitForFunction(() =>
      (window as unknown as HookWindow).__exploration.controller.snapshot().phase === "idle",
    null, { timeout: 30_000 });
    await possessAndLookUp(page, lookPitch);
  }
  await record("after-tab");
  // A dynamic-resolution step resizes the scene target: emulate it with a slightly smaller viewport.
  await page.setViewportSize({ height: 790, width: 1264 });
  await record("after-resize");
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.waitForTimeout(1000);
  // Slow frames (a weak device, or the catch-up right after a tab returns): throttle the CPU.
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: slowRate });
  await page.waitForTimeout(1500);
  await record("slow-frames");
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.waitForTimeout(1500);
  // Dynamic resolution at a low step (weak GPU) and one step change while recording.
  await setRenderScale(page, 0.6);
  await record("scale-60-step");
  await page.waitForTimeout(1000);
  await record("scale-60-steady");
  await setRenderScale(page, 1);
  await page.waitForTimeout(1000);
  await look(page, 0.35, 0);
  await record("turning");
  await look(page, 0, 0);
  await page.screenshot({ path: resolve(output, `${quality}-after-tab-full.png`) });
  return { phaseAfterHidden: phase, quality, rows };
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const results = [];
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
    await page.addInitScript("window.__name = value => value;");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    // The dry sky cycles its cover over minutes; pin it so every run looks at the same clouds.
    await pinCloudCover(page, cover);
    results.push({ ...(await reviewQuality(page, url, quality)), errors });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  assert(results.every(result => result.errors.length === 0), "page errors");
} finally {
  await browser.close();
  await server.close();
}
