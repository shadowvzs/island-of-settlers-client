import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { enterPossessedView, stageStartupSave } from "./frame-profile";

/**
 * C06b visual A/B: the owner save at iso wide and in the possessed view, each shot twice on one
 * frozen simulation state: the far prop path (default) and the exact rollback
 * (`__farProps = "exact"`). Writes `<quality>-<view>-far.png`, `<quality>-<view>-exact.png`,
 * an enlarged top/bottom crop of both and `report.json` (counters and differing pixels).
 *
 * Usage (browser via captures/browser-slot.sh):
 *   OWNER_SAVE=<save> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080]
 *   npx tsx tools/bench/far-props-capture.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
mkdirSync(outputDir, { recursive: true });

const ISO_WIDE_ZOOM = 0.5;
const SETTLE_MS = 1500;
/** Enlarged road crop around the settlement centre (the workers walk through it). */
const CROP = { height: 420, scale: 2, width: 600, x: 580, y: 430 };
const COUNTER_KEYS = ["workerDrawCalls", "workerGpuCrowd", "workerGpuSkipped", "workerLods", "workerPoseTiers",
  "workerPoseUpdates", "characterStageMs", "characterSkeletonUpdates", "pass.workers", "pass.build.workers"];

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

const setFarProps = (page: Page, mode: "exact" | "far") =>
  page.evaluate(value => { (globalThis as any).__farProps = value; }, mode);

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

/** Enlarged crop of both shots stacked (far on top, exact below), as a PNG buffer. */
const cropPair = async (page: Page, far: Buffer, exact: Buffer) => {
  const base64 = await page.evaluate(async ({ crop, exactData, farData }) => {
    const load = (data: string) => new Promise<HTMLImageElement>((done, fail) => {
      const image = new Image();
      image.onload = () => done(image);
      image.onerror = fail;
      image.src = `data:image/png;base64,${data}`;
    });
    const [imageA, imageB] = await Promise.all([load(farData), load(exactData)]);
    const canvas = document.createElement("canvas");
    canvas.width = crop.width * crop.scale;
    canvas.height = crop.height * crop.scale * 2;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.drawImage(imageA, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height / 2);
    context.drawImage(imageB, crop.x, crop.y, crop.width, crop.height,
      0, canvas.height / 2, canvas.width, canvas.height / 2);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, { crop: CROP, exactData: exact.toString("base64"), farData: far.toString("base64") });
  return Buffer.from(base64, "base64");
};

const shootPair = async (page: Page, quality: string, view: string) => {
  await page.waitForTimeout(SETTLE_MS);
  await freezeSimulation(page);
  await setFarProps(page, "far");
  // Longer than the 0.5 s stats window, so its counters only cover frames of this mode.
  await page.waitForTimeout(900);
  const far = await readCounters(page);
  const farShot = await page.screenshot({ path: resolve(outputDir, `${quality}-${view}-far.png`) });
  await setFarProps(page, "exact");
  await page.waitForTimeout(900);
  const exact = await readCounters(page);
  const exactShot = await page.screenshot({ path: resolve(outputDir, `${quality}-${view}-exact.png`) });
  await setFarProps(page, "far");
  await thawSimulation(page);
  writeFileSync(resolve(outputDir, `${quality}-${view}-crop-far-top-exact-bottom.png`),
    await cropPair(page, farShot, exactShot));
  const result = { diff: await differingPixels(page, farShot, exactShot), exact, far };
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
    // The C06 order: focus the settlement for the wide crowd, then possess from that focus so the
    // eye view stands in the village street where the near (skinned) props can be inspected.
    await focusIso(page, ISO_WIDE_ZOOM);
    shots["iso-wide"] = await shootPair(page, quality, "iso-wide");
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
