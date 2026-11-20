import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { MAP_SIZES } from "../../../src/app/map-generator/helpers";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
export interface GeneratorCaseOptions {
  width?: number;
  height?: number;
  seed?: number;
}

const setLevelThroughKeyboard = async (page: Page, name: string, level: number) => {
  const slider = page.getByRole("slider", { name: new RegExp(`^${name}:`) });
  await slider.focus();
  await page.keyboard.press("Home");
  for (let index = 0; index < level; index++) await page.keyboard.press("ArrowRight");
  assert.equal(await slider.inputValue(), String(level), `${name} slider did not accept its UI setting`);
};

const inspectGeneratedResources = async (page: Page) => page.evaluate(() => {
  const world = (window as any).__fullE2E?.world;
  if (!world) throw new Error("Read-only __fullE2E.world diagnostics are unavailable");
  const ores = ["none", "coal", "iron", "gold", "granite"];
  const deposits = ores.slice(1).map((ore, index) => {
    const zones = world.mineZones.filter((zone: any) => zone.ore === index + 1);
    const ids = new Set(zones.map((zone: any) => zone.id));
    let cells = 0;
    let remaining = 0;
    for (let cell = 0; cell < world.mineZone.length; cell++) {
      if (!ids.has(world.mineZone[cell])) continue;
      if (world.oreAmount[cell] > 0) cells++;
      remaining += world.oreAmount[cell];
    }
    return { ore, cells, remaining, zones: zones.map((zone: any) => ({ ...zone })) };
  });
  let trees = 0;
  let rocks = 0;
  for (let index = 0; index < world.props.count; index++) {
    const type = world.props.types[index];
    if ([0, 1, 2, 18].includes(type)) trees++;
    if ([4, 5].includes(type)) rocks++;
  }
  let freshwaterVertices = 0;
  let nonFiniteHeights = 0;
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    if (!Number.isFinite(world.heights[vertex])) nonFiniteHeights++;
    if (world.waterDepth[vertex] > 0.05 && world.waterSurface[vertex] > world.seaLevel + 0.05) freshwaterVertices++;
  }
  const settlement = (window as any).__settlement;
  const hq = settlement?.simulation.buildings().find((building: any) => building.typeId === 0);
  const resourceGaps = deposits.filter((deposit: any) => deposit.remaining === 0).map((deposit: any) => deposit.ore);
  if (!trees) resourceGaps.push("existing forest");
  if (!rocks) resourceGaps.push("existing quarry boulders");
  if (!freshwaterVertices) resourceGaps.push("river/freshwater");
  return { seed: world.seed, width: world.cellsX, height: world.cellsZ,
    sites: world.playableIslands?.sites.map((site: any) => ({ ...site })),
    hq: hq && { uid: hq.uid, x: hq.x, z: hq.z, access: { ...hq.access }, construction: hq.construction },
    deposits, trees, rocks, freshwaterVertices, nonFiniteHeights, resourceGaps,
    uiGaps: [
      "Mine resource authoring and geologist access need separate editor/survey cases",
      "Hardwood, marble, fish and wildlife need target/reachability validation in resource cases"] };
});

/** Destructive only inside the runner's isolated test profile; generates by the real World UI. */
export const runGeneratorCases = async (page: Page, runCase: RunCase, options: GeneratorCaseOptions = {}) => {
  const { height = 512, width = 512 } = options;
  assert((MAP_SIZES as readonly number[]).includes(width), `Unsupported generator width ${width}`);
  assert((MAP_SIZES as readonly number[]).includes(height), `Unsupported generator height ${height}`);
  let generated = false;
  await runCase("E2E-03-generator-ui", `Generate ${width}×${height} single island through UI`, async () => {
    await page.keyboard.press("Escape");
    // The Map generator opener lives in Development tools > World.
    await page.getByRole("button", { name: "Development tools", exact: true }).click();
    await page.getByRole("tab", { name: "World", exact: true }).click();
    await page.getByRole("button", { name: "Map generator", exact: true }).click();
    if (options.seed !== undefined) await page.getByRole("spinbutton", { name: "Seed (optional)", exact: true })
      .fill(String(options.seed));
    await page.getByLabel("Landform", { exact: true }).selectOption({ label: "Islands" });
    await page.getByLabel("Width", { exact: true }).selectOption({ label: String(width) });
    await page.getByLabel("Height", { exact: true }).selectOption({ label: String(height) });
    await page.getByLabel("Number of islands", { exact: true }).selectOption({ label: "1" });
    await page.getByLabel("Theme", { exact: true }).selectOption({ label: "Meadow" });
    await page.getByLabel("Themes", { exact: true }).selectOption({ label: "One theme" });
    await setLevelThroughKeyboard(page, "Rivers", 1);
    await setLevelThroughKeyboard(page, "Forest", 2);
    await setLevelThroughKeyboard(page, "Mountains", 2);
    const navigation = page.waitForEvent("framenavigated", {
      predicate: frame => frame === page.mainFrame(), timeout: 30_000
    });
    await page.getByRole("button", { name: "Recreate island", exact: true }).click();
    await navigation;
    await page.waitForFunction(() => (window as any).__islandReady === true && (window as any).__fullE2E?.world,
      null, { timeout: 240_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
    const evidence = await inspectGeneratedResources(page);
    if (options.seed !== undefined) assert.equal(evidence.seed, options.seed, "Generated seed differs from requested seed");
    assert.equal(evidence.width, width, "Generated width differs from actual UI choice");
    assert.equal(evidence.height, height, "Generated height differs from actual UI choice");
    assert.equal(evidence.sites?.length, 1, "Single-island generation must retain exactly one playable site");
    assert.equal(evidence.nonFiniteHeights, 0, "Generator produced non-finite terrain heights");
    assert(evidence.hq?.construction === 1, "Generated island did not initialize a normal HQ");
    generated = true;
    return { ...evidence, actions: { landform: "Islands", count: 1, width, height,
      theme: "Meadow", themes: "One theme", rivers: "Few", forest: "Normal", mountains: "Normal" } };
  });
  await runCase("E2E-03-generator-resources", "Retained island has finite ore fields and existing natural targets", async () => {
    assert(generated, "Prerequisite generator UI case did not pass");
    const evidence = await inspectGeneratedResources(page);
    assert.equal(evidence.resourceGaps.length, 0,
      `Retain this seed and record fixture rejection; missing resources: ${evidence.resourceGaps.join(", ")}`);
    return evidence;
  });
};
