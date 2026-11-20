import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { constructNaturally } from "./natural-cases";
import { clickGround } from "./natural-ui-helpers";
import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
export const NAMES = { shield: "swordsmen", heavy: "axemen", archer: "archers", cavalry: "cavalry" } as const;
type Troop = keyof typeof NAMES;

const readMilitary = (page: Page) => page.evaluate(() => {
  const live = (window as any).__settlement, sim = live.simulation;
  const state = sim.snapshot(), territory = sim.territory();
  return { ...state, soldiers: sim.militarySoldiers(), reserve: sim.militaryStoredTroops(),
    garrisons: sim.militaryBuildings(), queue: sim.tavernOrders(), rally: sim.militaryRally(),
    territory: { sources: territory.sources, owned: Array.from(territory.owned as Uint8Array) } };
});

const openBuilding = async (page: Page, building: { x: number; z: number; uid: number }, title: string) => {
  await page.keyboard.press("Escape");
  await clickGround(page, building);
  await page.getByRole("button", { exact: true, name: "Close building details window" })
    .waitFor({ state: "visible", timeout: 10_000 });
  const selected = await page.evaluate((uid) => (window as any).__settlement.simulation.buildings()
    .some((entry: any) => entry.uid === uid && entry.selected), building.uid);
  assert(selected, `Map click did not select intended ${title} ${building.uid}`);
};

const ensureTavern = async (page: Page) => {
  const before = await readMilitary(page);
  let tavern = before.buildings.find((building: any) => building.typeId === 40 && building.construction === 1);
  if (!tavern) {
    const supplies = before.buildings.filter((b: any) => [0, 29, 39].includes(b.typeId))
      .reduce((sum: Record<string, number>, b: any) => {
        for (const [ware, count] of Object.entries(b.inventory)) sum[ware] = (sum[ware] ?? 0) + Number(count);
        return sum;
      }, {});
    const { getConstructionCost } = await import("../../../src/shared/settlement/construction-costs");
    const missing = Object.entries(getConstructionCost(40)).filter(([ware, count]) => (supplies[ware] ?? 0) < count);
    if (missing.length) throw new MissingPrerequisite(`Natural Tavern materials missing: ${JSON.stringify(missing)}`);
    await constructNaturally(page, 40);
    tavern = (await readMilitary(page)).buildings.find((building: any) => building.typeId === 40);
  }
  return tavern;
};

const recruit = async (page: Page, uid: number, type: Troop) => {
  const before = await readMilitary(page), tavern = before.buildings.find((b: any) => b.uid === uid);
  await openBuilding(page, tavern, "Military Academy");
  await page.locator(`[data-tavern-troop='${type}']`).click();
  const orderCount = page.getByLabel("Recruits to order", { exact: true });
  const count = Number(await orderCount.innerText());
  assert(Number.isInteger(count) && count >= 1 && count <= 50, "Unexpected finite Tavern order count");
  for (let index = count; index > 1; index--)
    await page.getByRole("button", { exact: true, name: "One recruit fewer" }).click();
  const insufficient = await page.locator(".settlement-ui__tavern-ingredient[data-enough='false']").allTextContents();
  if (insufficient.length) throw new MissingPrerequisite(`Finite ${type} recruitment supply missing: ${insufficient.join("; ")}`);
  const beforeIds = new Set(before.soldiers.map((soldier: any) => soldier.actor));
  await page.locator(`[data-tavern-order='${type}']`).click();
  const phases = new Set<string>(), deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const after = await readMilitary(page);
    const order = after.queue.find((entry: any) => entry.uid === uid);
    if (order?.current) phases.add(order.current.stage);
    const newTroop = after.soldiers.find((soldier: any) => !beforeIds.has(soldier.actor) &&
      (soldier.combat?.faction ?? 0) === 0 && (soldier.combat?.type ?? "shield") === type);
    if (newTroop) {
      await page.getByRole("button", { exact: true, name: "Close building details window" }).click();
      return { type, actor: newTroop.actor, phases: [...phases], beforeSettlers: before.settlersInside,
        afterSettlers: after.settlersInside, proof: "New finite recruit through Tavern UI; no debug troop action" };
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Tavern ${uid} ${type} order did not yield a real troop within 180 wall seconds; stages ${[...phases].join(",")}`);
};

/** Pick a legal visible plot whose military radius extends actual current ownership. Read-only. */
const frontierPlot = async (page: Page, type: number) => {
  const point = await page.evaluate(async (typeId) => {
  const live = (window as any).__settlement, sim = live.simulation;
  const full = (window as any).__fullE2E, world = full.world;
  const url = "/src/shared/balance/territory.ts";
  const { TERRITORY_RADII } = await import(/* @vite-ignore */ url);
  const geometryUrl = "/src/render-common/buildings/building-grid-metrics.ts";
  const catalogUrl = "/src/render-common/buildings/building-catalog.ts";
  const { getPlacedBuildingLogistics } = await import(/* @vite-ignore */ geometryUrl);
  const { getBuildingDefinition } = await import(/* @vite-ignore */ catalogUrl);
  const territory = sim.territory(), home = sim.buildings().find((b: any) => b.typeId === 0);
  const rotation = live.controls.rotation();
  const footprint = getBuildingDefinition(typeId).gridFootprint;
  const width = footprint[rotation % 2 ? 1 : 0], depth = footprint[rotation % 2 ? 0 : 1];
  let best: { x: number; z: number; rotation: number; gain: number } | null = null;
  for (let iz = Math.max(1, Math.floor(home.z - 40)); iz < Math.min(world.cellsZ - 1, home.z + 40); iz += 2)
    for (let ix = Math.max(1, Math.floor(home.x - 40)); ix < Math.min(world.cellsX - 1, home.x + 40); ix += 2) {
      const x = ix + width % 2 / 2, z = iz + depth % 2 / 2;
      if (sim.validatePlacement(typeId, x, z, rotation)) continue;
      const screen = live.projectGround(x, z);
      if (screen.x < 120 || screen.x > innerWidth - 120 || screen.y < 120 || screen.y > innerHeight - 120) continue;
      const logistics = getPlacedBuildingLogistics(typeId, x, z, rotation);
      if (!sim.planRoad(home.access, logistics.road, "dirt")) continue;
      let gain = 0;
      const radius = TERRITORY_RADII[typeId];
      for (let cz = Math.floor(z - radius); cz <= Math.ceil(z + radius); cz++)
        for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
        if (cx < 0 || cz < 0 || cx >= world.cellsX || cz >= world.cellsZ ||
          (cx + .5 - x) ** 2 + (cz + .5 - z) ** 2 > radius ** 2) continue;
        if (!territory.owned[cz * world.cellsX + cx]) gain++;
      }
      if (gain > (best?.gain ?? 0)) best = { x, z, rotation, gain };
    }
  return best;
  }, type);
  if (!point) throw new MissingPrerequisite("No legal visible frontier plot with a real entrance road and additional territory");
  return point;
};

export const runMilitaryCases = async (page: Page, runCase: RunCase) => {
  let tavernUid: number | undefined;
  await runCase("E2E-08-natural-tavern", "Finite natural Tavern prerequisite", async () => {
    const tavern = await ensureTavern(page); tavernUid = tavern.uid;
    return { uid: tavernUid, construction: tavern.construction };
  });
  for (const type of Object.keys(NAMES) as Troop[]) await runCase(`E2E-08-recruit-${type}`,
    `Recruit one finite ${type} troop through Tavern UI`, async () => {
      if (tavernUid === undefined) throw new MissingPrerequisite("Completed Tavern prerequisite missing");
      return recruit(page, tavernUid, type);
    });
  await runCase("E2E-08-frontier-garrison", "Natural military building and real garrison expand territory", async () => {
    const before = await readMilitary(page);
    if (!before.reserve.some((row: any) => row.type !== "cavalry" && row.count > 0))
      throw new MissingPrerequisite("No finite recruited infantry in storage for frontier garrison");
    if (before.buildings.some((b: any) => b.typeId === 1))
      throw new MissingPrerequisite("Frontier branch needs a new Barracks, not a prebuilt catalog instance");
    const construction = await constructNaturally(page, 1, frontierPlot);
    const deadline = Date.now() + 180_000;
    let after = await readMilitary(page);
    while (!after.territory.sources.some((source: any) => source.uid === construction.uid) && Date.now() < deadline) {
      await page.waitForTimeout(500); after = await readMilitary(page);
    }
    const site = after.garrisons.find((b: any) => b.uid === construction.uid);
    assert(site?.stationed > 0, "Military building never received a physically stationed soldier");
    assert(after.territory.sources.some((source: any) => source.uid === construction.uid), "Occupied building did not claim land");
    const gained = after.territory.owned.reduce((sum: number, value: number, index: number) =>
      sum + Number(value > 0 && !before.territory.owned[index]), 0);
    assert(gained > 0, "New frontier garrison claimed no additional territory");
    return { construction, site, gained, scope: "Barracks and stationed expansion; empty pre-arrival claim timing not yet sampled" };
  });
  await runCase("E2E-08-rally-cancel", "Actual rally, gather and cancel icons preserve troops", async () => {
    const before = await readMilitary(page);
    if (!before.reserve.some((row: any) => row.count > 0)) throw new MissingPrerequisite("No reserve troops left to gather");
    const home = before.buildings.find((b: any) => b.typeId === 0);
    await page.getByRole("button", { exact: true, name: "Choose rally point" }).click();
    await clickGround(page, { x: home.access.x + 4, z: home.access.z + 3 });
    await page.waitForFunction(() => Boolean((window as any).__settlement.simulation.militaryRally()), null, { timeout: 10_000 });
    await page.getByRole("button", { exact: true, name: "Select troops" }).click();
    await page.getByRole("button", { exact: true, name: "Send the chosen troops to the rally banner" }).click();
    const gathered = await readMilitary(page);
    await page.getByRole("button", { exact: true, name: "Cancel rally point" }).click();
    await page.waitForFunction(() => !(window as any).__settlement.simulation.militaryRally(), null, { timeout: 10_000 });
    const after = await readMilitary(page);
    assert.equal(after.soldiers.length, before.soldiers.length, "Rally/cancel lost or duplicated troops on peaceful home");
    return { rally: gathered.rally, troopCount: after.soldiers.length,
      scope: "Banner/gather/cancel UI; large formations, return, upgrades and all ranks remain separate cases" };
  });
};
