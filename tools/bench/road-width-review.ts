import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Wider stone roads (owner, 2026-10-14) in the real game on High and Minimal: a new dirt road
 * (0.8), the same road upgraded in place (1.2), and a crowded junction from an old save whose
 * road runs half a cell in front of the plots, upgraded (it narrows only where plots intrude).
 * Close and gameplay views. Usage: npx tsx tools/bench/road-width-review.ts
 */
const output = resourcesPath("settlement-previews", "road-width-2026-10-14");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
const ZOOMS = { close: 2.4, gameplay: 1.25 } as const;

const capture = async (page: Page, name: string, focus: { x: number; z: number }) => {
  for (const [view, zoom] of Object.entries(ZOOMS)) {
    await page.evaluate(({ focus, zoom }) => (window as any).__settlement.focusGround(focus.x, focus.z, zoom),
      { focus, zoom });
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(output, `${name}-${view}.png`) });
  }
};

/** Places a finished Woodcutter on the nearest plot the shared rules allow and joins it by dirt. */
const connectWoodcutter = (page: Page) => page.evaluate(() => {
  const live = (window as any).__settlement;
  const hq = live.simulation.headquarters;
  const candidates: { distance: number; x: number; z: number }[] = [];
  for (let dz = -12; dz <= 12; dz++) for (let dx = -12; dx <= 12; dx++) {
    const x = Math.floor(hq.x) + dx, z = Math.floor(hq.z) + dz;
    if (live.simulation.validatePlacement(17, x, z, 1)) continue;
    candidates.push({ distance: Math.hypot(x - hq.x, z - hq.z), x, z });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const plot of candidates) {
    const result = live.simulation.placeBuilding(17, plot.x, plot.z, 1);
    if (!result.ok) continue;
    Object.assign(result.building, { construction: 1, required: {}, status: "Waiting for worker" });
    if (!live.simulation.connectRoads(hq.access, result.building.access)) continue;
    live.update(.05);
    return { building: result.building, edges: live.roads.segments().length, hq };
  }
  return null;
});

/**
 * An old save's crowded junction: a straight road half a cell in front of the headquarters and its
 * Woodcutter neighbour (allowed before 2026-10-14), plus a branch, loaded like a save does.
 */
const crowdedOldJunction = (page: Page) => page.evaluate(() => {
  const live = (window as any).__settlement;
  const hq = live.simulation.headquarters;
  const front = hq.z + hq.depth / 2, row = front + .5;
  const from = hq.x - hq.width / 2 - 6, to = hq.x + hq.width / 2 + 3;
  const segments = [...live.roads.segments()];
  const has = (a: any, b: any) => segments.some((segment: any) =>
    (segment.start.x === a.x && segment.start.z === a.z && segment.end.x === b.x && segment.end.z === b.z) ||
    (segment.start.x === b.x && segment.start.z === b.z && segment.end.x === a.x && segment.end.z === a.z));
  const add = (a: any, b: any) => { if (!has(a, b)) segments.push({ end: b, start: a, tier: "dirt" }); };
  for (let x = from; x < to; x += .5) add({ x, z: row }, { x: x + .5, z: row });
  for (let z = row; z < row + 3; z += .5) add({ x: hq.x + 1, z }, { x: hq.x + 1, z: z + .5 });
  if (!live.roads.replaceSegments(segments)) throw new Error("Old road layout rejected");
  live.update(.05);
  const upgraded = live.roads.upgradeRoad({ x: from, z: row }, { x: to, z: row }, () => true) &&
    live.roads.upgradeRoad({ x: hq.x + 1, z: row }, { x: hq.x + 1, z: row + 3 }, () => true);
  const frame = live.update(.05);
  const narrowed = frame.roads.filter((road: any) => road.startWidth !== undefined && !road.doorway &&
    Math.min(road.startWidth, road.endWidth ?? 1.2) < 1.2).length;
  return { focus: { x: hq.x, z: row }, narrowed, upgraded };
});

const review = async (quality: string) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.addInitScript("window.__name = (value) => value;");
  await page.goto(`${url}?quality=${quality}&seed=123&reveal=1&cache=0`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
    null, { timeout: 300000 }).catch(error => { throw new Error(`${error.message}\n${errors.join("\n")}`); });
  const connected = await connectWoodcutter(page);
  assert(connected, "No Woodcutter plot near the headquarters");
  const focus = { x: (connected.building.x + connected.hq.x) / 2, z: (connected.building.z + connected.hq.z) / 2 };
  await capture(page, `${quality}-dirt`, focus);
  const upgraded = await page.evaluate(({ building }) => {
    const live = (window as any).__settlement;
    const done = live.roads.upgradeRoad(live.simulation.headquarters.access, building.access, () => true);
    const frame = live.update(.05);
    return { done, stoneWidths: frame.roads.filter((road: any) => road.tier === "stone").length };
  }, connected);
  assert(upgraded.done, "The upgrade must never be refused");
  await capture(page, `${quality}-stone`, focus);
  const crowded = await crowdedOldJunction(page);
  assert(crowded.upgraded, "Upgrading an old crowded road must never be refused");
  assert(crowded.narrowed > 0, "Old intruding stretches must narrow");
  await capture(page, `${quality}-crowded-junction`, crowded.focus);
  assert.deepEqual(errors, []);
  reports.push({ connected: { building: connected.building.uid, edges: connected.edges }, crowded, errors,
    quality, upgraded });
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  await page.close();
};

try {
  await review("high");
  await review("minimal");
  console.log(`Road width review saved: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
