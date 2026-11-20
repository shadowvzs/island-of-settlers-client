import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getPlacedBuildingSignpost } from "../../src/render-common/buildings/building-road-signpost";
import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/entrance-roads");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];

const clickSign = async (page: Page, building: any) => {
  const { post } = getPlacedBuildingSignpost(building.typeId, building.x, building.z, building.rotation);
  const screen = await page.evaluate(({ post, y }) =>
    (window as any).__settlement.project(post.x, y + .78, post.z), { post, y: building.y });
  const bounds = await page.locator("canvas").first().boundingBox();
  assert(bounds);
  await page.mouse.click(bounds.x + screen.x, bounds.y + screen.y);
};

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
    null, { timeout: 120000 });
  const initial = await page.evaluate(() => {
    const live = (window as any).__settlement;
    const frame = live.update(.05);
    return { headquarters: live.simulation.headquarters, roads: frame.roads,
      graph: live.roads.segments(), revision: frame.roadRevision };
  });
  assert.equal(initial.graph.length, 0);
  assert(initial.roads.some((road: any) => road.doorway), "Unconnected HQ must have an entrance road");
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(output, `${quality}-headquarters-dirt.png`) });

  const [baseWidth, baseDepth] = getBuildingDefinition(17).gridFootprint;
  const planned = await page.evaluate(({ baseDepth, baseWidth }) => {
    const live = (window as any).__settlement;
    const hq = live.simulation.headquarters;
    const candidates: any[] = [];
    for (let dz = -12; dz <= 12; dz++) for (let dx = -12; dx <= 12; dx++) {
      const x = Math.floor(hq.x) + dx + baseDepth % 2 * .5;
      const z = Math.floor(hq.z) + dz + baseWidth % 2 * .5;
      if (live.simulation.validatePlacement(17, x, z, 1)) continue;
      candidates.push({ x, z, distance: Math.hypot(x - hq.x, z - hq.z) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const plot = candidates[0];
    if (!plot) return null;
    const result = live.simulation.placeBuilding(17, plot.x, plot.z, 1);
    if (!result.ok) return null;
    const frame = live.update(.05);
    return { building: result.building, roads: frame.roads, revision: frame.roadRevision };
  }, { baseWidth, baseDepth });
  assert(planned);
  assert.equal(planned.roads.length, initial.roads.length + 2, "Placed site must show its local entrance stub");
  assert(planned.building.construction < 1);
  const site = await page.evaluate(uid => {
    const live = (window as any).__settlement;
    const building = live.simulation.buildings().find((entry: any) => entry.uid === uid);
    const frame = live.update(.05);
    live.focusGround((building.x + live.simulation.headquarters.x) / 2,
      (building.z + live.simulation.headquarters.z) / 2);
    return { building, roads: frame.roads, revision: frame.roadRevision,
      connected: live.roads.route(building.access, live.simulation.headquarters.access) !== null };
  }, planned.building.uid);
  assert.equal(site.connected, false);
  assert.equal(site.revision, planned.revision, "Unconnected stub must not create graph edits");
  assert.equal(site.roads.length, initial.roads.length + 2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, `${quality}-separate-entrances.png`) });

  await page.evaluate(() => (window as any).__settlement.controls.selectRoad("dirt"));
  await clickSign(page, initial.headquarters);
  await clickSign(page, site.building);
  const connected = await page.evaluate(() => {
    const live = (window as any).__settlement;
    const building = live.simulation.buildings().find((entry: any) => entry.typeId === 17);
    return { route: live.roads.route(live.simulation.headquarters.access, building.access),
      frame: live.update(.05), graph: live.roads.segments() };
  });
  assert(connected.route, "Actual sign-board clicks must manually connect the unfinished site");
  await page.evaluate(() => (window as any).__settlement.controls.cancel());
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, `${quality}-connected-dirt.png`) });
  const beforeStone = await page.evaluate(() => (window as any).__settlement.simulation.headquarters.inventory.stone);
  await page.evaluate(() => (window as any).__settlement.controls.selectRoad("stone"));
  await clickSign(page, initial.headquarters);
  await clickSign(page, site.building);
  const upgraded = await page.evaluate(() => {
    const live = (window as any).__settlement;
    return { frame: live.update(.05), graph: live.roads.segments(),
      stones: live.simulation.headquarters.inventory.stone };
  });
  assert(upgraded.graph.length > 0);
  assert(upgraded.frame.roads.every((road: any) => road.tier === "stone"),
    "Both entrance spurs must upgrade together with the connected road");
  assert.equal(beforeStone - upgraded.stones, connected.graph.length);
  await page.evaluate(() => (window as any).__settlement.controls.cancel());
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, `${quality}-connected-stone.png`) });
  assert.deepEqual(errors, []);
  reports.push({ quality, initial, planned, site, graphSegments: connected.graph.length,
    stoneSegments: upgraded.frame.roads.length, paid: beforeStone - upgraded.stones, errors });
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  await page.close();
};

try {
  await review("high");
  await review("minimal");
  console.log(`Native entrance roads and sign-board connection/upgrade passed: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
