import { RESOURCE_TIERS } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { workshopUpgradeCost } from "../src/shared/settlement/workshop-upgrades";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

/** Every tier's planks, logs and stone, enough for levels 2–5 plus one spare of each (upgrade amounts 4-7 / 2-5). */
const tierStock = () => Object.fromEntries(RESOURCE_TIERS.slice(1).flatMap((tier, index) => {
  const [stone, wood] = [index + 2, index + 4];
  return [[tier.planks, wood + 1], [tier.logs, wood + 1], [tier.stone, stone + 1]];
}));

/** One building of each family: producer, sawmill, storehouse, HQ, military, lookout, tavern, residence. */
it.each([25, 33, 29, 0, 4, 14, 40, 57])("raises building %i to level 5 with carriers, escrow and builders", type => {
  // The HQ is the fixture's own; any placed building serves as the island around it.
  const { advance, building, simulation, total } = workshopUpgradeFixture(type || 33, tierStock());
  // One settling tick forms the storage pool, so a Storehouse reserves its upgrade from the pooled balance.
  advance(.05);
  const target = type === 0 ? simulation.headquarters : building;
  const expected = tierStock();
  for (const level of [1, 2, 3, 4]) {
    for (const [ware, count] of Object.entries(workshopUpgradeCost(target))) expected[ware]! -= count;
    expect(simulation.requestWorkshopUpgrade(target.uid), `request level ${level + 1}`).toBe(true);
    advance(400, () => target.workshopUpgrade?.level === level && !target.workshopUpgrade.requested);
    expect(target.workshopUpgrade).toEqual({ level });
  }
  // Each level consumed exactly its own cost, nothing else.
  for (const [ware, count] of Object.entries(expected)) expect(total(ware), ware).toBe(count);
  expect(simulation.requestWorkshopUpgrade(target.uid)).toBe(false);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.buildings().find(entry => entry.uid === target.uid)!.workshopUpgrade).toEqual({ level: 4 });
});

it("cancels a level-4 upgrade in transit and refunds every item once, keeping level 3", () => {
  const { advance, building, simulation, total } = workshopUpgradeFixture(25, tierStock());
  building.workshopUpgrade = { level: 2 };
  expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
  advance(60, () => (building.incoming.walnutPlanks ?? 0) > 0);
  expect(simulation.cancelWorkshopUpgrade(building.uid)).toBe(true);
  advance(300);
  expect(building.workshopUpgrade).toEqual({ level: 2 });
  expect(total("walnutPlanks")).toBe(7); expect(total("basalt")).toBe(5);
});
