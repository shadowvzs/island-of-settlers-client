import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { enterPossessedView, stageStartupSave } from "./frame-profile";

/**
 * C06 visual A/B: the owner save at iso wide / normal / close zoom and in the possessed view, each
 * shot twice on one frozen simulation state: GPU crowd (default) and the skinned rollback
 * (`__crowdMode = "skinned"`). Writes `<quality>-<view>-gpu.png`, `<quality>-<view>-skinned.png` and
 * `report.json` (stats-overlay counters of both and the differing pixel count between the pair).
 *
 * Usage (browser via captures/browser-slot.sh):
 *   OWNER_SAVE=<save> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080]
 *   npx tsx tools/bench/crowd-gpu-capture.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
mkdirSync(outputDir, { recursive: true });

const ISO_ZOOMS = { "iso-close": 3, "iso-normal": 1, "iso-wide": 0.5 } as const;
const SETTLE_MS = 1500;
const COUNTER_KEYS = ["workerGpuCrowd", "workerGpuBakeMs", "workerGpuSkipped", "workerLods", "workerDrawCalls",
  "workerTriangles", "workerPoseTiers",
  "workerPoseUpdates", "pass.workers", "pass.build.workers", "characterStageMs", "characterSkeletonUpdates"];

const readCounters = (page: Page) => page.evaluate(keys => {
  const details = (globalThis as any).__profileDetails ?? {};
  return Object.fromEntries(keys.map(key => [key, details[key] ?? null]));
}, COUNTER_KEYS);

/** Freezes the simulation so both shots of a pair show the same actors, poses and times. */
const freezeSimulation = (page: Page) => page.evaluate(() => {
  const simulation = (globalThis as any).__settlement.simulation;
  simulation.__frozenUpdate ??= simulation.update;
  simulation.update = () => undefined;
});

const thawSimulation = (page: Page) => page.evaluate(() => {
  const simulation = (globalThis as any).__settlement.simulation;
  if (simulation.__frozenUpdate) simulation.update = simulation.__frozenUpdate;
});

const setCrowdMode = (page: Page, mode: "gpu" | "skinned") =>
  page.evaluate(value => { (globalThis as any).__crowdMode = value; }, mode);

/** Differing pixels (any channel off by more than 8) between two PNGs, counted in the page. */
const differingPixels = (page: Page, first: Buffer, second: Buffer) => page.evaluate(async ([a, b]) => {
  const load = (data: string) => new Promise<HTMLImageElement>((done, fail) => {
    const image = new Image();
    image.onload = () => done(image);
    image.onerror = fail;
    image.src = `data:image/png;base64,${data}`;
  });
  const [imageA, imageB] = await Promise.all([load(a!), load(b!)]);
  const canvas = document.createElement("canvas");
  canvas.width = imageA.width; canvas.height = imageA.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(imageA, 0, 0);
  const pixelsA = context.getImageData(0, 0, canvas.width, canvas.height).data;
  context.drawImage(imageB, 0, 0);
  const pixelsB = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let differing = 0;
  for (let index = 0; index < pixelsA.length; index += 4) {
    if (Math.abs(pixelsA[index]! - pixelsB[index]!) > 8 || Math.abs(pixelsA[index + 1]! - pixelsB[index + 1]!) > 8 ||
      Math.abs(pixelsA[index + 2]! - pixelsB[index + 2]!) > 8) differing++;
  }
  return { differing, total: pixelsA.length / 4 };
}, [first.toString("base64"), second.toString("base64")]);

const shootPair = async (page: Page, quality: string, view: string) => {
  await page.waitForTimeout(SETTLE_MS);
  await freezeSimulation(page);
  await setCrowdMode(page, "gpu");
  await page.waitForTimeout(400);
  const gpu = await readCounters(page);
  const gpuShot = await page.screenshot({ path: resolve(outputDir, `${quality}-${view}-gpu.png`) });
  await setCrowdMode(page, "skinned");
  await page.waitForTimeout(400);
  const skinned = await readCounters(page);
  const skinnedShot = await page.screenshot({ path: resolve(outputDir, `${quality}-${view}-skinned.png`) });
  await setCrowdMode(page, "gpu");
  await thawSimulation(page);
  const diff = await differingPixels(page, gpuShot, skinnedShot);
  const result = { diff, gpu, skinned };
  console.log(quality, view, JSON.stringify(result));
  return result;
};

const focusIso = (page: Page, zoom: number) => page.evaluate(zoomLevel => {
  const live = (globalThis as any).__settlement;
  const home = live.simulation.headquarters;
  live.focusGround(home.x, home.z, zoomLevel);
}, zoom);

const openGame = async (url: string, quality: string, errors: string[]) => {
  const page = await (await browser).newPage({ viewport: { height: height!, width: width! } });
  page.on("pageerror", error => { errors.push(error.message); console.log(error.message); });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  await stageStartupSave(page, url, saveText);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&passes=1`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.addStyleTag({ content: ".stats-overlay { opacity: 0 !important; pointer-events: none; }" });
  await page.waitForTimeout(4000);
  return page;
};

const { server, url } = await startDevServer();
const browser = launchBrowser();
const report: Record<string, Record<string, unknown>> = {};
try {
  for (const quality of qualities) {
    const errors: string[] = [];
    const page = await openGame(url, quality, errors);
    const shots: Record<string, unknown> = {};
    report[quality] = shots;
    for (const [view, zoom] of Object.entries(ISO_ZOOMS)) {
      await focusIso(page, zoom);
      shots[view] = await shootPair(page, quality, view);
    }
    await enterPossessedView(page);
    shots.possessed = await shootPair(page, quality, "possessed");
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await (await browser).close();
  await server.close();
}
