import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { enterPossessedView, stageStartupSave } from "./frame-profile";

/**
 * R08 possessed shadow cascades: per Detail level and variant (`?cascades=`, "default" keeps the
 * preset, 1 is the rollback; a "+pcf3" / "+poisson12" suffix switches the filter live through the
 * dev hook) the shadow pass cost (main-thread mean/p95 of the pass,
 * the profiler's shadow CPU/GPU means and the receiving passes' GPU) in the iso and possessed
 * views, plus captures: iso, possessed straight ahead, a slow turn and a walk across the cascade
 * borders. The sky is frozen (no cycle, clear) so every variant sees the same sun; the source
 * save is only read.
 *
 * Usage (browser via captures/browser-slot.sh):
 *   OWNER_SAVE=<save> OUTPUT_DIR=<dir> [QUALITIES=high,medium,minimal] [VARIANTS=default,1]
 *   [HOUR=16.5] [SECONDS=8] [SEQUENCES=1] [FILTER_AB=0] npx tsx tools/bench/shadow-cascade-review.ts
 * FILTER_AB=n alternates pcf3 / poisson12 n times on the same possessed page (GPU noise of other
 * lanes hits both alike) and reports the frame and receiving-pass GPU of each.
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const sourceText = readFileSync(sourcePath, "utf8");
const qualities = (process.env.QUALITIES ?? "high,medium,minimal").split(",");
const variants = (process.env.VARIANTS ?? "default,1").split(",");
const measureMs = Number(process.env.SECONDS ?? 8) * 1000;
const sequences = process.env.SEQUENCES !== "0";
const filterRounds = Number(process.env.FILTER_AB ?? 0);
mkdirSync(outputDir, { recursive: true });

const frozenSave = () => {
  const save = JSON.parse(sourceText);
  const environment = save.runtime.environment;
  const hour = process.env.HOUR ? Number(process.env.HOUR) : environment.hour;
  Object.assign(environment, { cycling: false, hour, targetHour: hour, weatherState: "clear" });
  return JSON.stringify(save);
};

const RECEIVING_PASSES = ["world", "buildings", "workers"];

const measure = async (page: Page) => {
  await page.evaluate(() => {
    (globalThis as any).__frameProfiler.resetSession();
    window.__sunShadows?.resetTiming();
  });
  await page.waitForTimeout(measureMs);
  return page.evaluate((receiving) => {
    const root = globalThis as any;
    const report = root.__frameProfiler.sessionReport();
    const pass = (name: string) => report.passes.find((entry: any) => entry.name === name);
    const shadow = pass("shadows");
    const details = root.__profileDetails ?? {};
    const timing = window.__sunShadows?.timing();
    return {
      frameCpuMs: report.frameCpuMs, frameGpuMs: report.frameGpuMs, frames: report.frames,
      receiversGpuMs: Object.fromEntries(receiving.map(name => [name, pass(name)?.gpuMs ?? null])),
      shadowCascades: details.shadowCascades, shadowCasterMs: details.shadowCasterMs,
      shadowCpuMs: shadow?.cpuMs ?? null, shadowDrawCalls: shadow?.drawCalls ?? null,
      shadowGpuMs: shadow?.gpuMs ?? null, shadowPassMeanMs: timing?.mean, shadowPassP95Ms: timing?.p95,
      shadowTriangles: shadow?.triangles ?? null, vegetationCpuMs: pass("build.vegetation")?.cpuMs ?? null
    };
  }, RECEIVING_PASSES);
};

/** Same page, same view: the filter alone changes between the alternating samples. */
const alternateFilters = async (page: Page) => {
  const samples: { filter: string; frameGpuMs: number; receiversGpuMs: unknown }[] = [];
  for (let round = 0; round < filterRounds; round++) {
    for (const filter of ["pcf3", "poisson12"] as const) {
      await page.evaluate(name => window.__sunShadows?.filter(name), filter);
      const { frameGpuMs, receiversGpuMs } = await measure(page);
      samples.push({ filter, frameGpuMs, receiversGpuMs });
    }
  }
  return samples;
};

/** Holds `key` for `holdMs` per step and captures after each step. */
const captureSequence = async (page: Page, key: string, steps: number, holdMs: number, prefix: string) => {
  for (let step = 0; step < steps; step++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${prefix}-${String(step).padStart(2, "0")}.png` });
  }
};

const openGame = async (url: string, quality: string, variant: string, errors: string[]) => {
  const browser = await browserPromise;
  const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
  page.on("pageerror", error => { errors.push(error.message); console.log(error.message); });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  await stageStartupSave(page, url, frozenSave());
  const [cascadeVariant, filter] = variant.split("+");
  const cascades = cascadeVariant === "default" ? "" : `&cascades=${cascadeVariant}`;
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&passes=1${cascades}`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  if (filter) await page.evaluate(name => window.__sunShadows?.filter(name as "pcf3" | "poisson12"), filter);
  await page.waitForTimeout(6000);
  return page;
};

const reviewVariant = async (url: string, quality: string, variant: string) => {
  const errors: string[] = [];
  const page = await openGame(url, quality, variant, errors);
  const label = `${quality}-c${variant}`;
  const iso = await measure(page);
  await page.screenshot({ path: resolve(outputDir, `${label}-iso.png`) });
  await enterPossessedView(page);
  const possessed = await measure(page);
  const filterAb = filterRounds > 0 ? await alternateFilters(page) : [];
  await page.screenshot({ path: resolve(outputDir, `${label}-possessed.png`) });
  if (sequences) {
    await captureSequence(page, "ArrowLeft", 8, 400, resolve(outputDir, `${label}-turn`));
    await captureSequence(page, "ArrowUp", 8, 450, resolve(outputDir, `${label}-walk`));
  }
  await page.close();
  const row = { errors, filterAb, iso, possessed, quality, variant };
  console.log(JSON.stringify(row));
  return row;
};

const { server, url } = await startDevServer();
const browserPromise = launchBrowser();
try {
  const rows = [];
  for (const quality of qualities) {
    for (const variant of variants) rows.push(await reviewVariant(url, quality, variant));
  }
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(rows, null, 2));
  assert.deepEqual(rows.flatMap(row => row.errors), []);
  assert.equal(readFileSync(sourcePath, "utf8"), sourceText, "Source save stays unchanged");
} finally {
  await (await browserPromise).close();
  await server.close();
}
