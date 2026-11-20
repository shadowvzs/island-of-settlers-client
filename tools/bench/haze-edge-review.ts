/**
 * Dusk depth-edge review (haze-depth-edge): an iso dusk shot, then per R06c sun shaft variant the
 * possessed view beside a near wall over the sea, a turn strip and the same spot looking into and
 * across the dusk sun. A variant is "off" (`__godRays(false)`) or a `__godRaysTuning` patch
 * ({} = the shipped tuning). Real home island (seed 123), pinned cover and clock. Saves full frames
 * and strips. TIMING=1 instead measures the `godRays` pass (march + blur) in the wall view with the
 * dev profiler for SECONDS and prints BENCH_JSON for tools/bench/ab-runner.ts.
 *
 * Env: OUTPUT (folder), QUALITIES (default high,minimal), COVER (0.6), DUSK_HOUR (17.7),
 * DUSK_WATER_YAW (3.14), VARIANTS (JSON { name: patch | null }, default { on: {}, off: null }),
 * QUERY (extra dev switches), TIMING=1, SECONDS (8).
 * Run from island-of-settlers-client of the checkout to review (the dev server serves the cwd).
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { emitBenchJson } from "./bench-json";
import { launchBrowser, startDevServer } from "./browser";
import {
  driveEye,
  enterPossession,
  exposeWeather,
  pinCloudCover,
  recordFrames,
  savePng,
  setHour,
  waitForIslandPage
} from "./cloud-review-page";

const output = resolve(process.env.OUTPUT ?? "haze-edge-review");
const cover = Number(process.env.COVER ?? 0.6);
const duskHour = Number(process.env.DUSK_HOUR ?? 17.7);
const duskWaterYaw = Number(process.env.DUSK_WATER_YAW ?? 3.14);
type TuningPatch = Record<string, unknown> | null;
const variants: Record<string, TuningPatch> = JSON.parse(process.env.VARIANTS ?? '{"on":{},"off":null}');
const timing = process.env.TIMING === "1";
const measureMs = Number(process.env.SECONDS ?? 8) * 1000;
mkdirSync(output, { recursive: true });

/** The wall's left silhouette over the sea and ground (the dusk-water view). */
const EDGE_CROP = { height: 0.6, left: 0.35, top: 0.35, width: 0.4 };
const WATER_PITCH = -0.05;
/** Views by yaw from the sun: into it (shafts at full phase) and across it (the shadow bound applies). */
const SUN_VIEWS: [string, number][] = [["into-sun", 0], ["across-sun", Math.PI / 2]];

const settle = (page: Page, ms: number) => page.waitForTimeout(ms);

interface ShaftHooks {
  __godRays?: (active?: boolean) => boolean;
  __godRaysTuning?: (patch?: Record<string, unknown>) => unknown;
}

/** Applies a variant on top of the shipped tuning (read once); null switches the shafts off. */
const applyVariant = (page: Page, patch: TuningPatch) => page.evaluate(patch => {
  const hooks = window as unknown as ShaftHooks & { __shippedGodRays?: unknown };
  if (!hooks.__godRays || !hooks.__godRaysTuning) return null;
  hooks.__shippedGodRays ??= structuredClone(hooks.__godRaysTuning());
  hooks.__godRaysTuning({ ...(hooks.__shippedGodRays as object), ...(patch ?? {}) });
  return hooks.__godRays(patch !== null);
}, patch);

const openIsland = async (page: Page, url: string, quality: string) => {
  const extra = process.env.QUERY ? `&${process.env.QUERY}` : "";
  const profile = timing ? "&passes=1" : "";
  await page.goto(`${url}?quality=${quality}&size=64&seed=123&cache=0&time=day${profile}${extra}`);
  await waitForIslandPage(page);
  const duskSun = await setHour(page, duskHour);
  await settle(page, 2500);
  // The strategic view never runs the shafts (possession weight 0): a parity shot.
  if (!timing) await page.screenshot({ path: resolve(output, `${quality}-iso-dusk-full.png`) });
  await enterPossession(page);
  return duskSun;
};

const shoot = async (page: Page, name: string, turning: boolean) => {
  const { strip } = await recordFrames(page, { count: 8, crop: EDGE_CROP, stripFrames: turning ? 8 : 4 });
  savePng(output, `${name}-strip`, strip);
  await page.screenshot({ path: resolve(output, `${name}-full.png`) });
};

const measureShaftPass = async (page: Page, yaw: number) => {
  await driveEye(page, { pitch: WATER_PITCH, yaw });
  await settle(page, 3000);
  await page.evaluate(() => (globalThis as any).__frameProfiler.resetSession());
  await settle(page, measureMs);
  return page.evaluate(() => {
    const report = (globalThis as any).__frameProfiler.sessionReport();
    const pass = report.passes.find((entry: { name: string }) => entry.name === "godRays");
    return { frameGpuMs: report.frameGpuMs as number | null, frames: report.frames as number,
      godRaysGpuMs: pass?.gpuMs as number | null | undefined };
  });
};

const reviewQuality = async (page: Page, url: string, quality: string) => {
  const duskSun = await openIsland(page, url, quality);
  const yaw = duskSun.yaw + duskWaterYaw;
  if (timing) return { quality, timing: await measureShaftPass(page, yaw) };
  const shafts: Record<string, boolean | null> = {};
  for (const [name, patch] of Object.entries(variants)) {
    shafts[name] = await applyVariant(page, patch);
    await driveEye(page, { pitch: WATER_PITCH, yaw });
    await settle(page, 2500);
    await shoot(page, `${quality}-${name}-edge`, false);
    await driveEye(page, { pitch: WATER_PITCH, yaw: yaw - 0.3, yawRate: 0.3 });
    await settle(page, 200);
    await shoot(page, `${quality}-${name}-turn`, true);
    for (const [view, yawToSun] of SUN_VIEWS) {
      await driveEye(page, { pitch: duskSun.elevation + 0.05, yaw: duskSun.yaw + yawToSun });
      await settle(page, 2500);
      await shoot(page, `${quality}-${name}-${view}`, false);
    }
  }
  return { quality, shafts };
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
    await pinCloudCover(page, cover);
    await exposeWeather(page);
    results.push({ ...(await reviewQuality(page, url, quality)), errors });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  for (const result of results)
    if ("timing" in result) emitBenchJson({ [result.quality]: result.timing });
  assert(results.every(result => result.errors.length === 0), "page errors");
} finally {
  await browser.close();
  await server.close();
}
