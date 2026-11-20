import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/** One real Economy click, using canonical save/load to arrange mixed public road tiers. */
const output = resourcesPath("project-reviews", "debug-road-upgrade-2026-11-04");
mkdirSync(output, { recursive: true });
const sources = ["src/shared/settlement/road-network.ts", "src/shared/settlement/settlement-debug-roads.ts",
  "src/app/island-development-tools.ts", "src/app/settlement/settlement-debug-actions.ts",
  "src/app/settings/development/messages.ts", "src/app/settlement-ui/icons.ts"];
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const initial = hashes(), errors: string[] = [];
const { server, url } = await startDevServer();
const browser = await launchBrowser();
let status = "running", result: unknown;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => undefined);
  await page.goto(`${url}admin.html?quality=minimal&seed=123&size=96&forest=0&cache=0&time=day`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
    null, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  const before = await page.evaluate(() => {
    const live = (window as any).__settlement, simulation = live.simulation;
    simulation.update = () => undefined;
    const save = simulation.saveState(), home = simulation.headquarters;
    const tiers = ["dirt", "stone", "marble", "limestone", "basalt", "granite"];
    const x = Math.round(home.x), z = Math.round(home.z) + 5;
    save.roads = tiers.map((tier, index) => ({ tier,
      start: { x: x + index * .5, z }, end: { x: x + .5 + index * .5, z } }));
    const loaded = simulation.loadState(save);
    if (!loaded.ok) throw new Error(`Fixture save failed: ${loaded.reason}`);
    if (!save.roads.every((edge: any) => simulation.ownsTerritory(edge.start) && simulation.ownsTerritory(edge.end)))
      throw new Error("Fixture roads are outside owned territory");
    const original = simulation.debugUpgradeRoads.bind(simulation);
    (window as any).__roadUpgradeClicks = 0;
    simulation.debugUpgradeRoads = () => { (window as any).__roadUpgradeClicks++; return original(); };
    return { tiers: simulation.roadSegments().map((edge: any) => edge.tier), save: simulation.saveState() };
  });
  await page.getByRole("button", { name: "Development tools", exact: true }).click();
  const panel = page.locator(".development-menu:not([hidden])");
  await panel.getByRole("tab", { name: "Economy", exact: true }).click();
  const button = panel.getByRole("button", { name: "Upgrade owned roads", exact: true });
  const dimensions = await button.boundingBox();
  assert(dimensions && dimensions.width === 48 && dimensions.height === 48, "Shared compact icon must be 48px");
  await button.click();
  const after = await page.evaluate(() => ({ calls: (window as any).__roadUpgradeClicks,
    save: (window as any).__settlement.simulation.saveState(),
    tiers: (window as any).__settlement.simulation.roadSegments().map((edge: any) => edge.tier) }));
  assert.equal(after.calls, 1);
  assert.deepEqual(after.tiers, ["stone", "marble", "limestone", "basalt", "granite", "granite"]);
  assert.deepEqual({ ...after.save, navigationRevisions: before.save.navigationRevisions, roads: before.save.roads },
    before.save, "Only roads and their navigation revision may change");
  await page.screenshot({ path: resolve(output, "economy-one-click.png") });
  assert.deepEqual(hashes(), initial, "Captured source graph changed during the review");
  assert.deepEqual(errors, []);
  result = { before: before.tiers, after: after.tiers, calls: after.calls, dimensions, economyUnchanged: true };
  status = "passed";
} finally {
  await browser.close();
  await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, result, errors, sources: initial }, null, 2));
}
