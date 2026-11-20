import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ROAD_DECORATION_ITEM_DEFINITIONS,
  type RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { BAMBOO_CONTENT_IDS } from "../../src/render-common/plants/bamboo-grove-species";
import { launchBrowser, startDevServer } from "./browser";
import { aimAt, decorationShot, type LiveWindow, openDecorReviewPage, possessAt,
  settleDecorations, walkTowards } from "./decor-review-session";

/**
 * Real game-path review of the four bamboo groves beside a released maple for scale: actual island
 * renderer, lights and LOD selection; isometric close/normal/far, possessed close/normal and the
 * spyglass, on every requested quality. Not a benchmark.
 *
 * Usage (from island-of-settlers-client): npx tsx tools/bench/bamboo-game-review.ts --out <dir>
 */
const outAt = process.argv.indexOf("--out");
assert(outAt >= 0, "--out <directory> is required (captures are never committed)");
const output = resolve(process.argv[outAt + 1]!);
mkdirSync(output, { recursive: true });
const qualityArgument = process.argv.find(value => value.startsWith("--quality="))?.split("=")[1];
const qualities = (qualityArgument ?? "high,minimal").split(",");
const contents = [...BAMBOO_CONTENT_IDS, "plant-red-maple-standalone-ground-0"];
const items = contents.map(content => {
  const id = `roadDecoration:${content}:native` as RoadDecorationItemId;
  return { id, offerId: ROAD_DECORATION_ITEM_DEFINITIONS[id]!.offerId };
});

/** Buys and plants each item on free owned terrain, camera side of the HQ, at least 4.5 cells apart. */
const stageScene = (page: Page) => page.evaluate(async (entries: { id: string; offerId: string }[]) => {
  const live = window as LiveWindow, settlement = live.__settlement, sim = settlement.simulation;
  settlement.removeFog?.();
  if (!settlement.playerSession.grantGems(1000)) throw new Error("Guest fixture cannot seed gems");
  const door = sim.headquarters.access, candidates: { x: number; z: number }[] = [];
  for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) {
    const distance = Math.hypot(dx, dz);
    if (distance >= 5 && distance <= 16) candidates.push({ x: door.x + dx + .5, z: door.z + dz + .5 });
  }
  candidates.sort((a, b) => b.x + b.z - (a.x + a.z));
  const placed: { item: string; x: number; z: number }[] = [];
  for (const { id, offerId } of entries) {
    if (await settlement.playerSession.buyGemOffer(offerId) !== true) throw new Error(`Offer refused: ${offerId}`);
    const site = candidates.find(position => !placed.some(other =>
      Math.hypot(other.x - position.x, other.z - position.z) < 4.5) &&
      sim.planRoadDecoration({ item: id, position, yaw: 0 }).ok);
    if (!site || !sim.placeRoadDecoration({ item: id, position: site, yaw: 0 }).ok)
      throw new Error(`No valid terrain site for ${id}`);
    placed.push({ item: id, ...site });
  }
  const x = placed.reduce((sum, entry) => sum + entry.x, 0) / placed.length;
  const z = placed.reduce((sum, entry) => sum + entry.z, 0) / placed.length;
  return { placed, centre: { x, z } };
}, items);

const focus = (page: Page, at: { x: number; z: number }, zoom: number) => page.evaluate(([x, z, value]) =>
  (window as LiveWindow).__settlement.focusGround(x, z, value), [at.x, at.z, zoom]);

const reviewQuality = async (page: Page, quality: string) => {
  const rows: unknown[] = [], scene = await stageScene(page), { centre, placed } = scene;
  await focus(page, centre, 2.6); await decorationShot(page, output, `${quality}-iso-close`, rows, { zoom: 2.6 });
  await page.waitForTimeout(700);
  await decorationShot(page, output, `${quality}-iso-close-later`, rows, { zoom: 2.6, note: "wind sway frame" });
  await focus(page, centre, 1.2); await decorationShot(page, output, `${quality}-iso-normal`, rows, { zoom: 1.2 });
  await focus(page, centre, .7); await decorationShot(page, output, `${quality}-iso-far`, rows, { zoom: .7 });
  for (const [index, entry] of placed.slice(0, 4).entries()) {
    await focus(page, entry, 4.5);
    await decorationShot(page, output, `${quality}-iso-detail-${index}`, rows, { item: entry.item, zoom: 4.5 });
  }
  // A tall single culm (index 2) seen from the possessed eye: normal distance, then close.
  const culm = placed[2]!;
  await possessAt(page, { x: culm.x + 8, z: culm.z + 8 });
  rows.push({ name: "walk-normal", remaining: await walkTowards(page, culm, 9) });
  await aimAt(page, culm, .32);
  await decorationShot(page, output, `${quality}-possessed-normal`, rows);
  rows.push({ name: "walk-close", remaining: await walkTowards(page, culm, 3.5) });
  await aimAt(page, culm, .55);
  await decorationShot(page, output, `${quality}-possessed-close`, rows);
  await aimAt(page, placed[0]!, .3);
  await decorationShot(page, output, `${quality}-possessed-clump`, rows);
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.toggleSpyglass());
  for (let step = 0; step < 3; step++)
    await page.evaluate(() => (window as LiveWindow).__exploration.controller.adjustSpyglassZoom(1));
  await aimAt(page, placed[3]!, .25);
  await decorationShot(page, output, `${quality}-spyglass`, rows);
  await page.evaluate(() => (window as LiveWindow).__exploration.controller.forceExit("session-replacement"));
  await settleDecorations(page, 10);
  return { quality, scene, rows };
};

/**
 * Review only: bamboo is building/editor content and never sold, so the review page offers it in the
 * guest shop to reach the real placement custody path. Models, LOD and rendering are untouched.
 */
const offerBambooForReview = async (page: Page) => {
  const anchor = "BUILDING_EDITOR_DECORATIONS.has(decoration) ? { uses: BUILDING_EDITOR_USES } : {}";
  await page.route("**/island-of-settlers-shared/src/road-decoration-items.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes(anchor), "Missing bamboo uses anchor");
    await route.fulfill({ response, body: source.replace(anchor,
      "BUILDING_EDITOR_DECORATIONS.has(decoration) ? { shopAvailable: true } : {}") });
  });
};

const { server, url } = await startDevServer({ unlockAll: false });
const browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  for (const quality of qualities) {
    const page = await openDecorReviewPage(browser, url, quality, errors, undefined, offerBambooForReview);
    reports.push(await reviewQuality(page, quality));
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports,
    scope: "Actual island renderer (game shading path)." }, null, 2));
  await browser.close(); await server.close();
}
assert.deepEqual(errors, []);
console.log(`Bamboo game review: ${output}`);
