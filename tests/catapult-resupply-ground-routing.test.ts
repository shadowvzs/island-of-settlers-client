import { expect, it } from "vitest";

import { garrisonViewActors } from "../src/app/settlement/garrison-view";
import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { CATAPULT_BLOCK_REST_LIFT } from "../src/render-common/buildings/catapult-stone-presentation";
import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { defaultMilitaryGarrisonTarget } from "../src/shared/settlement/settlement-military-garrison-scheduler";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

it.each([0, 1, 2, 3])("hauls actual ground-pile contacts through the unchanged door at rotation %s", rotation => {
  const world = huntingWorld(40);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const stockContact = createIslandStockContacts(world, (x, z) => simulation?.isOccupied(x, z) ?? false);
  simulation = createSettlementSimulation({ world, roads, stockContact, initialSettlers: 12,
    initialStock: { stone: 20, planks: 20 } });
  const tower = simulation.placeBuilding(16, 20.5, 10.5, rotation).building!;
  Object.assign(tower, { accepts: { stone: false }, construction: 1, foundationProgress: 1, required: {},
    catapultSupply: { ground: 1 } });
  expect(simulation.connectRoads(simulation.headquarters.access, tower.access)).toBe(true);
  let atPile = false;
  for (let tick = 0; tick < 2_000; tick++) {
    simulation.update(.05);
    expect(catapultLocalStone(tower)).toBe(1);
    const porter = tower.catapultSupply!.porter;
    if (porter?.phase === "pickup") {
      const actor = simulation.snapshot().actors.find(body => body.uid === porter.actor)!;
      const contact = stockContact(tower, "input", "stone", 0)!;
      expect(actor.x).toBeCloseTo(contact.approach.x);
      expect(actor.z).toBeCloseTo(contact.approach.z);
      expect(contact.stock.y).toBeCloseTo(tower.y + CATAPULT_BLOCK_REST_LIFT);
      expect(actor.y).toBeCloseTo(tower.y); atPile = true;
    }
    if (tower.input.stone === 1 && !porter) break;
  }
  expect(atPile).toBe(true); expect(tower.catapultSupply!.ground).toBe(0);
  expect(tower.input.stone).toBe(1); expect(tower.catapultSupply!.porter).toBeUndefined();
});

it("employs one civilian without taking any of three guard/operator slots, including under threat", () => {
  const world = huntingWorld(40), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 12,
    initialStock: { stone: 20, planks: 20, sword: 1, shield: 1, beer: 1 } });
  const tower = simulation.placeBuilding(16, 20.5, 10.5).building!;
  Object.assign(tower, { accepts: { stone: false }, construction: 1, foundationProgress: 1, required: {},
    catapultSupply: { ground: 0 } });
  expect(simulation.connectRoads(simulation.headquarters.access, tower.access)).toBe(true);
  simulation.receiveTroops([{ hp: 100, rank: 0, type: "heavy" },
    { hp: 100, rank: 0, type: "shield" }, { hp: 100, rank: 0, type: "shield" }]);
  simulation.setMilitaryComposition(tower.uid, { archer: 0, heavy: 1, shield: 2 });
  for (let tick = 0; tick < 2_000 && simulation.militarySoldiers().filter(soldier =>
    soldier.building === tower.uid && soldier.stationed).length < 3; tick++) simulation.update(.05);
  const initialIds = simulation.militarySoldiers().filter(soldier => soldier.building === tower.uid)
    .map(soldier => soldier.actor).sort((a, b) => a - b);
  expect(initialIds).toHaveLength(3);
  tower.catapultSupply!.ground = 1; simulation.update(.05);
  const porter = tower.catapultSupply!.porter!;
  expect(porter.phase).toBe("outbound");
  const body = simulation.snapshot().actors.find(actor => actor.uid === porter.actor)!;
  expect(body.visible).toBe(true); expect(body.phase).toBe("inputApproach");
  expect(body.job).toBe("Carrier"); expect(tower.worker).toBe(body.uid);
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === porter.actor)).toBeUndefined();
  expect(simulation.militarySoldiers().filter(soldier => soldier.building === tower.uid && soldier.stationed)).toHaveLength(3);
  expect(garrisonViewActors([tower], simulation.militarySoldiers(), simulation.snapshot().actors)
    .filter(actor => actor.uid === porter.actor)).toEqual([]);
  const extra = simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
  expect(extra).not.toBeNull(); expect(simulation.garrisonMilitary([extra!], tower.uid)).toBe(0);
  const foe = simulation.spawnMilitaryOpponent({ x: tower.access.x + .8, z: tower.access.z }, "shield");
  expect(foe).not.toBeNull();
  for (let tick = 0; tick < 100 && tower.catapultSupply!.porter; tick++) {
    simulation.update(.05);
    expect(simulation.militarySoldiers().filter(soldier => soldier.building === tower.uid)
      .map(soldier => soldier.actor).sort((a, b) => a - b)).toEqual(initialIds);
    expect(simulation.garrisonMilitary([extra!], tower.uid)).toBe(0);
  }
  expect(tower.catapultSupply!.porter).toBeUndefined();
  expect(simulation.snapshot().actors.find(actor => actor.uid === porter.actor)?.phase).toBe("inside");
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === extra)?.building).toBe(-1);
  expect(tower.catapultSupply!.ground).toBe(1);
});

it("preserves the current Catapult garrison defaults and manual targets independently of civilian employment", () => {
  const tower = { typeId: 16 } as SettlementBuilding, watchtower = { typeId: 4 } as SettlementBuilding;
  expect(defaultMilitaryGarrisonTarget(tower)).toBe(2);
  expect(defaultMilitaryGarrisonTarget(tower, 39)).toBe(2);
  expect(defaultMilitaryGarrisonTarget(watchtower, 39)).toBe(1);
  expect(defaultMilitaryGarrisonTarget(watchtower)).toBe(6);
  const world = huntingWorld(40), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialStock: { stone: 20, planks: 20 } });
  const site = simulation.placeBuilding(16, 20.5, 10.5).building!;
  Object.assign(site, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.militaryBuildings().find(row => row.uid === site.uid)?.target).toBe(2);
  simulation.setMilitaryTarget(site.uid, 1);
  expect(simulation.militaryBuildings().find(row => row.uid === site.uid)?.target).toBe(1);
  expect(simulation.setMilitaryComposition(site.uid, { archer: 0, heavy: 1, shield: 2 })).toBe(true);
  expect(simulation.militaryBuildings().find(row => row.uid === site.uid)?.target).toBe(3);
});
