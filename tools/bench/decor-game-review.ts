import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ROAD_DECORATION_ITEM_DEFINITIONS,
  type RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { launchBrowser, startDevServer } from "./browser";
import { aimAt, awayFromHeadquarters, centreOn, decorationShot, exposeDecorationCasters, type LiveWindow,
  measureFrames, middle, openDecorReviewPage, type Point, possessAt, stageRoadDecorations, walkTowards, walkToStand,
  yawAwayFromHeadquarters } from "./decor-review-session";

/**
 * Real game-path review of road decorations (default: the climber arches, owner O9): the actual island
 * renderer, lights, shadows and LOD selection, in the isometric view, the possessed eye view and
 * the possessed spyglass, close and at normal distance, on High and Minimal. Not a benchmark.
 *
 * `--items=<kind,...>` reviews other road decorations (e.g. plant-date-palm-roadside-ground-0);
 * `--lift=<units>` makes the possessed views look up at that height (a palm crown).
 *
 * Usage (from island-of-settlers-client): npx tsx tools/bench/decor-game-review.ts --out <dir>
 */
const outAt = process.argv.indexOf("--out");
assert(outAt >= 0, "--out <directory> is required (captures are never committed)");
const output = resolve(process.argv[outAt + 1]!);
mkdirSync(output, { recursive: true });
const option = (name: string, fallback: string) =>
  (process.argv.find(value => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback).split(",").filter(Boolean);
const qualities = option("quality", "high,minimal");
const toOrder = (kind: string) => {
  const id = `roadDecoration:${kind}:native` as RoadDecorationItemId;
  const definition = ROAD_DECORATION_ITEM_DEFINITIONS[id];
  assert(definition, `Unknown decoration ${id}`);
  return { id, offerId: definition.offerId };
};
/** Possessed views look up at this height (world units) above the ground, e.g. a palm crown. */
const lift = Number(option("lift", "0")[0]);
/** `--measure`: GPU A/B only (no captures); the RTX 3060 run of owner O10. */
const measure = process.argv.includes("--measure");
const MEASURE_ROUNDS = 4, MEASURE_MS = 4000;
const MEASURE_QUERY = "size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1&passes=1";
const subjects = option("items", "climbing-rose-red,climbing-rose-white,ivy-lattice").map(toOrder);
const subjectIds = new Set(subjects.map(subject => subject.id));

type Site = { item: string; x: number; z: number };
const shortName = (site: Site) => site.item.split(":")[1]!;

/** Iso close per subject, then normal and far over all subjects. */
const isoShots = async (page: Page, quality: string, rows: unknown[], sites: Site[]) => {
  for (const site of sites) {
    await yawAwayFromHeadquarters(page, site);
    await centreOn(page, site, 2.2);
    await decorationShot(page, output, `${quality}-iso-close-${shortName(site)}`, rows, { zoom: 2.2 });
  }
  const centre = middle(sites);
  await yawAwayFromHeadquarters(page, centre);
  await centreOn(page, centre, 1.2);
  await decorationShot(page, output, `${quality}-iso-normal`, rows, { zoom: 1.2 });
  await centreOn(page, centre, .7);
  await decorationShot(page, output, `${quality}-iso-far`, rows, { zoom: .7 });
};

/** Possessed eye from the open side: normal distance, close per subject, then the spyglass. */
const possessedShots = async (page: Page, quality: string, rows: unknown[], sites: Site[]) => {
  const headquarters: Point = await page.evaluate(() => {
    const { x, z } = (window as LiveWindow).__settlement.simulation.headquarters;
    return { x, z };
  });
  const centre = middle(sites), normal = awayFromHeadquarters(centre, headquarters, 10);
  await possessAt(page, normal);
  rows.push({ name: `${quality}-possessed-normal`, remaining: await walkTowards(page, normal, .8) });
  await aimAt(page, centre, .05 + Math.atan2(lift, 10));
  await decorationShot(page, output, `${quality}-possessed-normal`, rows);
  for (const site of sites) {
    const remaining = await walkToStand(page, site, headquarters);
    await aimAt(page, site, .1 + Math.atan2(lift, 4));
    await decorationShot(page, output, `${quality}-possessed-close-${shortName(site)}`, rows, { remaining });
  }
  await walkTowards(page, normal, .8);
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.toggleSpyglass());
  for (let step = 0; step < 3; step++)
    await page.evaluate(() => (window as LiveWindow).__exploration.controller.adjustSpyglassZoom(1));
  await aimAt(page, sites.at(-1)!, .05 + Math.atan2(lift, 10));
  await decorationShot(page, output, `${quality}-spyglass`, rows);
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.forceExit("session-replacement"));
};

const setDecorationsVisible = (page: Page, visible: boolean) => page.evaluate(async shown => {
  const live = window as LiveWindow;
  live.__decorationLayer.root.visible = shown;
  if (live.__decorationSunCasters) live.__decorationSunCasters.visible = shown;
  for (let frame = 0; frame < 10; frame++) await new Promise(requestAnimationFrame);
}, visible);

/** Back-to-back GPU A/B at the iso normal view: the staged decorations (and their sun casters) on/off. */
const measureDecorations = async (page: Page, sites: Site[]) => {
  const samples: { frameGpuMs: number; shadowGpuMs: number | null; visible: boolean }[] = [];
  await centreOn(page, middle(sites), 1.2);
  for (let round = 0; round < MEASURE_ROUNDS; round++) for (const visible of [false, true]) {
    await setDecorationsVisible(page, visible);
    samples.push({ visible, ...await measureFrames(page, MEASURE_MS) });
  }
  await setDecorationsVisible(page, true);
  const mean = (visible: boolean, key: "frameGpuMs" | "shadowGpuMs") => {
    const values = samples.filter(sample => sample.visible === visible).map(sample => sample[key] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return { frameGpuMs: { off: mean(false, "frameGpuMs"), on: mean(true, "frameGpuMs") },
    samples, shadowGpuMs: { off: mean(false, "shadowGpuMs"), on: mean(true, "shadowGpuMs") } };
};

const reviewQuality = async (page: Page, quality: string) => {
  const rows: unknown[] = [];
  const scene = await stageRoadDecorations(page, subjects, 3.2);
  const sites = scene.placed.filter(site => subjectIds.has(site.item as RoadDecorationItemId));
  assert(sites.length > 0, `No subject placed: ${scene.skipped.join(", ")}`);
  const gpu = measure ? await measureDecorations(page, sites) : null;
  if (measure) return { gpu, quality, scene };
  await isoShots(page, quality, rows, sites);
  await possessedShots(page, quality, rows, sites);
  return { quality, scene, rows };
};

const { server, url } = await startDevServer({ unlockAll: false });
const browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  for (const quality of qualities) {
    const page = measure
      ? await openDecorReviewPage(browser, url, quality, errors, MEASURE_QUERY, exposeDecorationCasters)
      : await openDecorReviewPage(browser, url, quality, errors);
    reports.push(await reviewQuality(page, quality));
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports,
    scope: "Actual island renderer (game shading path, no bench lights or Three shadow map)." }, null, 2));
  await browser.close(); await server.close();
}
assert.deepEqual(errors, []);
console.log(`Decor game review: ${output}`);
