import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ROAD_DECORATION_ITEM_DEFINITIONS,
  type RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { launchBrowser, startDevServer } from "./browser";
import { aimAt, centreOn, decorationShot, exposeDecorationCasters, type LiveWindow, measureFrames,
  openDecorReviewPage, possessAt, settleDecorations, stageRoadDecorations,
  walkTowards } from "./decor-review-session";

/**
 * D08 review: decoration plants sway with the world wind on High only. Per quality and weather
 * (calm; storm = `?rain=1`): frame sequences (FRAMES shots, 250 ms apart) of a ground tree, a potted
 * plant and a climber on its frame in iso close and possessed close views, plus iso normal; on
 * presets with sway a back-to-back GPU A/B where the swaying twins are swapped for their static
 * sources (whole frame and sun shadow pass, ROUNDS alternations of SECONDS each).
 *
 * Usage (from island-of-settlers-client, browser via captures/browser-slot.sh):
 *   npx tsx --env-file=<file> tools/bench/decoration-wind-review.ts
 *   env: OUTPUT_DIR, QUALITIES (default high,minimal), WEATHERS (default calm,storm), ROUNDS (4),
 *   SECONDS (4), FRAMES (4)
 */
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR (captures are never committed)");
const output = resolve(outputDir);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const weathers = (process.env.WEATHERS ?? "calm,storm").split(",");
const rounds = Number(process.env.ROUNDS ?? 4);
const measureMs = Number(process.env.SECONDS ?? 4) * 1000;
const frameCount = Number(process.env.FRAMES ?? 4);
/** Fillers first (sites fill outwards from the HQ door), the three review subjects last, in the open. */
const KINDS = [
  "plant-date-palm-standalone-ground-1", "ivy-lattice", "plant-red-rose-roadside-pot-1",
  "plant-fan-palm-roadside-ground-0", "plant-cherry-blossom-standalone-ground-1", "plant-bonsai-pine-roadside-pot-1",
  "plant-olive-standard-standalone-ground-1", "plant-boxwood-roadside-pot-1", "climbing-rose-red"
];
const ITEMS = KINDS.map(kind => {
  const id = `roadDecoration:${kind}:native` as RoadDecorationItemId;
  const definition = ROAD_DECORATION_ITEM_DEFINITIONS[id];
  assert(definition, `Unknown decoration ${id}`);
  return { id, offerId: definition.offerId };
});

/**
 * Records each swaying twin with its static source (and one plain depth material for the caster
 * twins), so the A/B can draw the same batches without the sway.
 */
const SWAY_MODULE = "**/src/renderers/three/plants/decoration-wind-sway.ts*";
const exposeSway = async (page: Page) => {
  await exposeDecorationCasters(page);
  await page.route(SWAY_MODULE, async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = "const { depth, material } = twinFor(mesh.material);";
    assert(source.includes(anchor), "Missing sway observation anchor");
    const body = source.replace(anchor, `${anchor} (globalThis.__swayStatic ??= new Map())` +
      ".set(material, mesh.material).set(depth, globalThis.__swayStaticDepth ??= " +
      "new MeshDepthMaterial({ side: DoubleSide }));");
    await route.fulfill({ response, body });
  });
};

/** Swaps every batch (and caster twin) between its swaying twin and its static source. */
const setSway = (page: Page, on: boolean) => page.evaluate(async swaying => {
  const live = globalThis as Record<string, any>, statics: Map<unknown, unknown> | undefined = live.__swayStatic;
  if (!statics) return 0;
  let swapped = 0;
  const roots = [live.__decorationLayer?.root, live.__decorationSunCasters];
  for (const root of roots) for (const mesh of root?.children ?? []) {
    const twin = mesh.userData.swayTwin ?? mesh.material;
    if (!statics.has(twin)) continue;
    mesh.userData.swayTwin = twin; mesh.material = swaying ? twin : statics.get(twin); swapped++;
  }
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  return swapped;
}, on);

const gpuAb = async (page: Page) => {
  const samples: { sway: boolean; frameGpuMs: number; shadowGpuMs: number | null }[] = [];
  let swapped = 0;
  for (let round = 0; round < rounds; round++) for (const sway of [false, true]) {
    swapped = await setSway(page, sway);
    samples.push({ sway, ...await measureFrames(page, measureMs) });
  }
  await setSway(page, true);
  const mean = (on: boolean, key: "frameGpuMs" | "shadowGpuMs") => {
    const values = samples.filter(sample => sample.sway === on).map(sample => sample[key] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return { samples, swapped, frameDeltaMs: mean(true, "frameGpuMs") - mean(false, "frameGpuMs"),
    shadowDeltaMs: mean(true, "shadowGpuMs") - mean(false, "shadowGpuMs") };
};

/**
 * FRAMES screenshots of one unchanged view, 250 ms apart (only swaying parts differ between them),
 * then the same view with the static sources (`-static`) where the sway is active.
 */
const sequence = async (page: Page, name: string, rows: unknown[], extra: Record<string, unknown> = {}) => {
  await decorationShot(page, output, `${name}-f0`, rows, extra);
  for (let frame = 1; frame < frameCount; frame++) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(output, `${name}-f${frame}.png`) });
  }
  if (!await setSway(page, false)) return;
  await page.screenshot({ path: resolve(output, `${name}-static.png`) });
  await setSway(page, true);
};

type Site = { item: string; x: number; z: number };

const reviewPossessed = async (page: Page, prefix: string, rows: unknown[], subjects: Site[], measure: boolean) => {
  const [tree, climber] = subjects;
  await possessAt(page, { x: tree!.x + 3, z: tree!.z + 3 });
  const reach = await walkTowards(page, tree!, 4);
  await aimAt(page, tree!, -.05);
  await sequence(page, `${prefix}-possessed-tree`, rows, { reach });
  if (climber) {
    const climberReach = await walkTowards(page, climber, 3);
    await aimAt(page, climber, -.12);
    await sequence(page, `${prefix}-possessed-climber`, rows, { reach: climberReach });
  }
  const possessedAb = measure ? await gpuAb(page) : null;
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.forceExit("session-replacement"));
  return possessedAb;
};

const review = async (page: Page, quality: string, weather: string) => {
  const rows: unknown[] = [], scene = await stageRoadDecorations(page, ITEMS), prefix = `${quality}-${weather}`;
  const { centre, placed } = scene;
  const focus = (zoom: number, at: { x: number; z: number } = centre) => page.evaluate(([x, z, value]) =>
    (window as LiveWindow).__settlement.focusGround(x, z, value), [at.x, at.z, zoom]);
  const last = (fragment: string) => placed.filter(entry => entry.item.includes(fragment)).at(-1);
  const subjects = { climber: last("climbing-rose"), pot: last("boxwood-roadside-pot"), tree: last("olive-standard") };
  for (const [view, site] of Object.entries(subjects)) {
    if (!site) continue;
    await centreOn(page, site, view === "tree" ? 3 : 4.5);
    await sequence(page, `${prefix}-iso-${view}`, rows, { site });
  }
  await focus(1.2); await decorationShot(page, output, `${prefix}-iso-normal`, rows);
  const swaying = await page.evaluate(() => (globalThis as Record<string, any>).__swayStatic?.size ?? 0);
  const measure = swaying > 0 && weather === "calm";
  const isoAb = measure ? await gpuAb(page) : null;
  const climber = subjects.climber ? [subjects.climber] : [];
  const possessedAb = await reviewPossessed(page, prefix, rows, [subjects.tree ?? placed[0]!, ...climber], measure);
  return { quality, weather, scene, rows, swayingMaterials: swaying, isoAb, possessedAb };
};

const { server, url } = await startDevServer({ unlockAll: false });
const browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  for (const quality of qualities) for (const weather of weathers) {
    const rain = weather === "storm" ? "&rain=1" : "";
    const page = await openDecorReviewPage(browser, url, quality, errors,
      `size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1&passes=1${rain}`, exposeSway);
    await settleDecorations(page, 30);
    const report = await review(page, quality, weather);
    console.log(JSON.stringify({ quality, weather, swaying: report.swayingMaterials, isoAb: report.isoAb,
      possessedAb: report.possessedAb }));
    reports.push(report);
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports }, null, 2));
  await browser.close(); await server.close();
}
assert.deepEqual(errors, []);
console.log(`Decoration wind review: ${output}`);
