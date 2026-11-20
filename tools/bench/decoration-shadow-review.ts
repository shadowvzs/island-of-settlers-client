import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ROAD_DECORATION_ITEM_DEFINITIONS,
  type RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { launchBrowser, startDevServer } from "./browser";
import { aimAt, decorationShot, exposeDecorationCasters, type LiveWindow, measureFrames,
  openDecorReviewPage, possessAt, settleDecorations, stageRoadDecorations,
  walkTowards } from "./decor-review-session";

/**
 * D07b review: roadside decorations cast into the sun map. A guest island gets a ring of roads off
 * the HQ door and a mixed set of pots, ground trees, lanterns and arches beside them. Per quality:
 * iso close/normal/far, possessed eye and spyglass shots, each as an A/B pair (decoration casters
 * on, then hidden for one frame: `-on` / `-off`), and on presets with a sun pass a back-to-back GPU
 * A/B of the profiler's shadow pass and whole frame (ROUNDS alternations of SECONDS each).
 *
 * Usage (from island-of-settlers-client, browser via captures/browser-slot.sh):
 *   npx tsx --env-file=<file> tools/bench/decoration-shadow-review.ts
 *   env: OUTPUT_DIR, QUALITIES (default high,medium,minimal), ROUNDS (default 4), SECONDS (default 4)
 */
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR (captures are never committed)");
const output = resolve(outputDir);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,medium,minimal").split(",");
const rounds = Number(process.env.ROUNDS ?? 4);
const measureMs = Number(process.env.SECONDS ?? 4) * 1000;
const KINDS = [
  "plant-bonsai-pine-roadside-pot-1", "plant-boxwood-roadside-pot-1", "plant-red-rose-roadside-pot-1",
  "plant-lavender-roadside-pot-1", "plant-hydrangea-roadside-pot-1", "plant-columnar-cypress-roadside-pot-1",
  "plant-red-maple-standalone-ground-1", "plant-olive-standard-standalone-ground-1",
  "plant-cherry-blossom-standalone-ground-1", "plant-date-palm-standalone-ground-1", "japanese-bamboo-stand",
  "climbing-rose-red", "plant-azalea-roadside-pot-1", "plant-round-myrtle-roadside-pot-1"
];
const ITEMS = [...KINDS, ...KINDS].map(kind => {
  const id = `roadDecoration:${kind}:native` as RoadDecorationItemId;
  const definition = ROAD_DECORATION_ITEM_DEFINITIONS[id];
  assert(definition, `Unknown decoration ${id}`);
  return { id, offerId: definition.offerId };
});

const setCasters = (page: Page, visible: boolean) => page.evaluate(async on => {
  const root = (globalThis as Record<string, any>).__decorationSunCasters;
  if (root) root.visible = on;
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
}, visible);

/** A/B shots of one view: casters on, then hidden (two frames later, same camera). */
const shotPair = async (page: Page, name: string, rows: unknown[], extra: Record<string, unknown> = {}) => {
  await settleDecorations(page);
  await decorationShot(page, output, `${name}-on`, rows, { ...extra, casters: await casterStats(page) });
  await setCasters(page, false);
  await page.screenshot({ path: resolve(output, `${name}-off.png`) });
  await setCasters(page, true);
};

const casterStats = (page: Page) => page.evaluate(() => {
  const root = (globalThis as Record<string, any>).__decorationSunCasters;
  if (!root) return null;
  const twins = root.children as { count: number; geometry: any }[];
  return { meshes: twins.length, instances: twins.reduce((sum, twin) => sum + twin.count, 0),
    triangles: twins.reduce((sum, twin) => sum + twin.count *
      (twin.geometry.index?.count ?? twin.geometry.getAttribute("position").count) / 3, 0) };
});

/** Back-to-back alternation on one page and view: only the decoration casters change. */
const gpuAb = async (page: Page) => {
  const samples: { casters: boolean; frameGpuMs: number; shadowGpuMs: number | null }[] = [];
  for (let round = 0; round < rounds; round++) for (const casters of [false, true]) {
    await setCasters(page, casters);
    samples.push({ casters, ...await measureFrames(page, measureMs) });
  }
  await setCasters(page, true);
  const mean = (on: boolean, key: "frameGpuMs" | "shadowGpuMs") => {
    const values = samples.filter(sample => sample.casters === on).map(sample => sample[key] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return { samples, shadowDeltaMs: mean(true, "shadowGpuMs") - mean(false, "shadowGpuMs"),
    frameDeltaMs: mean(true, "frameGpuMs") - mean(false, "frameGpuMs") };
};

const reviewQuality = async (page: Page, quality: string) => {
  const rows: unknown[] = [], scene = await stageRoadDecorations(page, ITEMS), { centre, placed } = scene;
  const focus = (zoom: number, at = centre) => page.evaluate(([x, z, value]) =>
    (window as LiveWindow).__settlement.focusGround(x, z, value), [at.x, at.z, zoom]);
  const sunPass = quality !== "minimal";
  // A ground tree in open sun is the close subject (the first site often lies in the HQ's shadow).
  const subject = placed.find(entry => entry.item.includes("cherry")) ?? placed[0]!;
  await focus(2.6, subject); await shotPair(page, `${quality}-iso-close`, rows, { zoom: 2.6 });
  // The last pot: the first sites sit by the HQ door, in its shadow.
  const pot = placed.filter(entry => entry.item.includes("roadside-pot")).at(-1);
  if (pot) { await focus(3.6, pot); await shotPair(page, `${quality}-iso-pot`, rows, { zoom: 3.6 }); }
  await focus(1.2); await shotPair(page, `${quality}-iso-normal`, rows, { zoom: 1.2 });
  const isoAb = sunPass ? await gpuAb(page) : null;
  await focus(.7); await shotPair(page, `${quality}-iso-far`, rows, { zoom: .7 });
  await possessAt(page, { x: subject.x + 3, z: subject.z + 3 });
  const reach = await walkTowards(page, subject, 4);
  await aimAt(page, subject, -.35);
  await shotPair(page, `${quality}-possessed-close`, rows, { reach });
  await aimAt(page, centre, -.15);
  await shotPair(page, `${quality}-possessed-normal`, rows);
  const possessedAb = sunPass ? await gpuAb(page) : null;
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.toggleSpyglass());
  for (let step = 0; step < 3; step++)
    await page.evaluate(() => (window as LiveWindow).__exploration.controller.adjustSpyglassZoom(1));
  await aimAt(page, placed.at(-1)!, -.03);
  await settleDecorations(page, 30);
  await shotPair(page, `${quality}-spyglass`, rows);
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.forceExit("session-replacement"));
  return { quality, scene, rows, isoAb, possessedAb };
};

const { server, url } = await startDevServer({ unlockAll: false });
const browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  for (const quality of qualities) {
    const page = await openDecorReviewPage(browser, url, quality, errors,
      "size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1&passes=1", exposeDecorationCasters);
    const report = await reviewQuality(page, quality);
    console.log(JSON.stringify({ quality, isoAb: report.isoAb, possessedAb: report.possessedAb }));
    reports.push(report);
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports }, null, 2));
  await browser.close(); await server.close();
}
assert.deepEqual(errors, []);
console.log(`Decoration shadow review: ${output}`);
