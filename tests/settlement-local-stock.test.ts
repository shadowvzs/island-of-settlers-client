import { expect, it } from "vitest";

import { COMMANDER_LODGE_TYPE_ID, TAVERN_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { commanderRecruitAvailability } from "../src/shared/settlement/settlement-commander-recruitment";
import { localConstructionStock, payLocalConstructionGoods } from "../src/shared/settlement/settlement-local-stock";
import { createSettlementTavern } from "../src/shared/settlement/settlement-tavern";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { reconcileStorageAccess } from "../src/shared/settlement/shared-storage";
import { TAVERN_RECIPES } from "../src/shared/settlement/tavern-rules";
import { workshopUpgradeAvailability, workshopUpgradeCost } from "../src/shared/settlement/workshop-upgrades";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";
import { createPlacementSession } from "./helpers/placement-session";

const fixture = () => {
  const world = { seed: 1, cellsX: 7, cellsZ: 3, blocking: new Uint8Array(21), terrainRevision: 0 } as unknown as WorldData;
  for (let z = 0; z < 3; z++) world.blocking[z * 7 + 4] = BLOCKING.water;
  const building = (uid: number, typeId: number, x: number) => ({ uid, typeId, x, z: 1,
    access: { x, z: 1 }, construction: 1, inventory: {}, input: {}, output: {}, required: {},
    incoming: {}, accepts: {}, shipReserve: {}, idleSettlers: 3 }) as unknown as SettlementBuilding;
  const home = building(0, 0, 1), local = building(1, 29, 2), offshore = building(2, 29, 5);
  home.inventory.stone = 7; local.inventory.stone = 3; offshore.inventory.stone = 100;
  const context = { options: { world, roads: { route: () => ({ cost: 1, points: [] }) } },
    buildings: [home, local, offshore], actors: [] } as unknown as SettlementContext;
  reconcileStorageAccess(context);
  return { context, home, local, offshore, building };
};

it("pays complete construction sets once per local pool without overseas borrowing or partial debit", () => {
  const { context, home, local, offshore } = fixture();
  expect(localConstructionStock(context, "stone", local.access)).toBe(10);
  expect(payLocalConstructionGoods(context, local.access, { stone: 15 })).toBe(false);
  expect(home.inventory.stone).toBe(10);
  expect(offshore.inventory.stone).toBe(100);
  home.inventory.planks = 1;
  expect(payLocalConstructionGoods(context, local.access, { stone: 5, planks: 2 })).toBe(false);
  expect(home.inventory.stone).toBe(10);
  expect(payLocalConstructionGoods(context, local.access, { stone: 10 })).toBe(true);
  expect(local.inventory.stone ?? 0).toBe(0);
  expect(payLocalConstructionGoods(context, home.access, { stone: 1 })).toBe(false);
  expect(offshore.inventory.stone).toBe(100);
});

it("counts local construction and future incoming holds once without reserving overseas projects", () => {
  const { building, context, home } = fixture();
  const localSite = building(3, 33, 3), overseasSite = building(4, 33, 6);
  localSite.required.stone = 5;
  localSite.incoming.stone = 1;
  overseasSite.required.stone = 90;
  context.buildings.push(localSite, overseasSite);
  context.actors.push({ nextDelivery: { source: home.uid, destination: localSite.uid,
    ware: "stone", units: 1 } } as unknown as SettlementActor);
  expect(localConstructionStock(context, "stone", home.access)).toBe(5);
  expect(payLocalConstructionGoods(context, home.access, { stone: 6 })).toBe(false);
  expect(home.inventory.stone).toBe(10);
});

it("upgrades an actual 15-stone road only after its one shared 10-stone balance is sufficient", () => {
  const { roads, simulation } = createPlacementSession();
  const home = simulation.buildings()[0]!;
  simulation.buildings().push({ ...home, uid: 90, typeId: 29, x: 35, z: 50,
    access: { x: 35, z: 54 }, inventory: {}, input: {}, incoming: {}, output: {}, required: {} });
  simulation.update(.05);
  const start = { x: 40, z: 60 }, end = { x: 47.5, z: 60 };
  expect(roads.addRoad(start, end)).toBe(true);
  expect(simulation.planRoad(start, end, "stone")?.segments).toHaveLength(15);
  home.inventory.stone = 10;
  const before = roads.segments();
  expect(simulation.upgradeRoad(start, end)).toBe(false);
  expect(home.inventory.stone).toBe(10);
  expect(roads.segments()).toEqual(before);
  home.inventory.stone = 15;
  expect(simulation.upgradeRoad(start, end)).toBe(true);
  expect(home.inventory.stone ?? 0).toBe(0);
});

it("reports commander and workshop shortages once while preserving each access's settlers", () => {
  const { building, context, home, offshore } = fixture();
  const lodge = building(3, COMMANDER_LODGE_TYPE_ID, 3);
  context.buildings.push(lodge);
  const cost = commanderRecruitAvailability(context, lodge.uid, false).cost;
  Object.assign(home.inventory, cost);
  const [ware, count] = Object.entries(cost).find(([, amount]) => amount >= 2)!;
  home.inventory[ware] = count - 1;
  offshore.inventory[ware] = 100;
  const recruit = commanderRecruitAvailability(context, lodge.uid, false);
  expect(recruit.missing[ware]).toBe(1);
  expect(recruit.idleSettlers).toBe(6);
  expect(recruit.available).toBe(false);
  const workshop = building(4, 33, 3);
  context.buildings.push(workshop);
  const upgradeCost = workshopUpgradeCost(workshop);
  Object.assign(home.inventory, upgradeCost);
  const [material, needed] = Object.entries(upgradeCost).find(([, amount]) => amount >= 2)!;
  home.inventory[material] = needed - 1;
  expect(workshopUpgradeAvailability(context, workshop).supply[material]).toBe(needed - 1);
  expect(workshopUpgradeAvailability(context, workshop).available).toBe(false);
});

it("does not accept two recruits against two doors into one recruit's equipment", () => {
  const { building, context, home } = fixture();
  const academy = building(3, TAVERN_TYPE_ID, 3);
  context.buildings.push(academy);
  Object.assign(home.inventory, TAVERN_RECIPES.archer);
  const tavern = createSettlementTavern(context, {} as Parameters<typeof createSettlementTavern>[1]);
  expect(tavern.orderRecruits(academy.uid, "archer", 2).ok).toBe(false);
  expect(tavern.orderRecruits(academy.uid, "archer", 1).ok).toBe(true);
  expect(tavern.orderRecruits(academy.uid, "archer", 1).ok).toBe(false);
});
