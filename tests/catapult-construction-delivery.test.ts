import { expect, it } from "vitest";

import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it("caps manual construction deliveries, consumes their receipts once and saves after ammunition refill", () => {
  const world = huntingWorld(40), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 12,
    initialStock: { hammer: 1, shovel: 1, stone: 20, planks: 20 } });
  const placed = simulation.placeBuilding(16, 20.5, 10.5);
  expect(placed.ok, placed.reason).toBe(true);
  let tower = placed.building!;
  const cost = { ...tower.required };
  expect(simulation.connectRoads(simulation.headquarters.access, tower.access)).toBe(true);
  expect(simulation.transferWare(simulation.headquarters.uid, tower.uid, "stone", 100)).toBe(true);
  expect(simulation.transferWare(simulation.headquarters.uid, tower.uid, "planks", 100)).toBe(true);
  expect(simulation.transferWare(simulation.headquarters.uid, tower.uid, "coins", 1)).toBe(false);
  let completed = false, hauled = false;
  const savedPhases = new Set<string>();
  const savedCheckpoints = new Set<string>();
  for (let tick = 0; tick < 16_000; tick++) {
    simulation.update(.05);
    if (tower.construction < 1) {
      for (const [ware, required] of Object.entries(tower.required))
        expect((tower.input[ware] ?? 0) + (tower.incoming[ware] ?? 0) +
          (tower.constructionConsumed?.[ware] ?? 0)).toBeLessThanOrEqual(required);
      continue;
    }
    if (!completed) {
      completed = true;
      expect(tower.constructionConsumed).toEqual(cost);
      expect(Object.values(tower.input).reduce((sum, count) => sum + count, 0)).toBe(0);
    }
    expect(catapultLocalStone(tower) + (tower.incoming.stone ?? 0)).toBeLessThanOrEqual(6);
    const phase = tower.catapultSupply?.porter?.phase;
    if (tower.catapultSupply?.porter) hauled = true;
    let checkpointKey: string | undefined = phase;
    if (phase === "stairs-up" || phase === "stairs-down") {
      const actor = simulation.snapshot().actors.find(body => body.uid === tower.catapultSupply!.porter!.actor)!;
      checkpointKey = `${phase}:${actor.visible}`;
    }
    if (phase && checkpointKey && !savedCheckpoints.has(checkpointKey)) {
      savedPhases.add(phase);
      savedCheckpoints.add(checkpointKey);
      const checkpoint = simulation.saveState();
      expect(simulation.loadState(JSON.parse(JSON.stringify(checkpoint))), phase).toEqual({ ok: true });
      expect(simulation.saveState(), phase).toEqual(checkpoint);
      tower = simulation.buildings().find(site => site.uid === tower.uid)!;
    }
    // Owner 2026-11-03: six site stones total, roof capacity two; the porter stops at a full rack.
    if (tower.input.stone === 2 && !tower.catapultSupply?.porter) break;
  }
  expect(completed).toBe(true);
  expect(hauled).toBe(true);
  expect(tower.input.stone ?? 0).toBe(2);
  expect(tower.catapultSupply?.ground).toBe(4);
  expect(catapultLocalStone(tower)).toBe(6);
  expect(savedPhases.size).toBe(8);
  expect(savedCheckpoints.size).toBe(10);
  const saved = simulation.saveState();
  expect(simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
  expect(simulation.saveState()).toEqual(saved);
  expect(simulation.resourceTotal("stone")).toBe(20 - cost.stone! - 6);
  expect(simulation.resourceTotal("planks")).toBe(20 - cost.planks!);
});

it("demolition keeps the Carrier's held stone on the same person until it physically reaches storage", () => {
  const world = huntingWorld(40), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 12,
    initialStock: { stone: 20, planks: 20 } });
  const tower = simulation.placeBuilding(16, 20.5, 10.5).building!;
  Object.assign(tower, { construction: 1, foundationProgress: 1, required: {}, catapultSupply: { ground: 6 } });
  expect(simulation.connectRoads(simulation.headquarters.access, tower.access)).toBe(true);
  simulation.receiveTroops([{ hp: 100, rank: 0, type: "heavy" }, { hp: 100, rank: 0, type: "shield" }]);
  simulation.setMilitaryComposition(tower.uid, { archer: 0, heavy: 1, shield: 1 });
  for (let tick = 0; tick < 2_000 && !tower.catapultSupply!.porter?.carrying; tick++) simulation.update(.05);
  const id = tower.catapultSupply!.porter!.actor;
  expect(tower.catapultSupply!.porter!.phase).toBe("inbound");
  const before = simulation.resourceTotal("stone") + catapultLocalStone(tower);
  expect(simulation.demolishBuilding(tower.uid)).toEqual({ ok: true });
  expect(simulation.resourceTotal("stone") + 1).toBe(before);
  expect(simulation.snapshot().actors.find(actor => actor.uid === id)?.ware).toBe("stone");
  expect(simulation.resourceTotal("stone")).toBe(25);
  for (let tick = 0; tick < 2_000 && simulation.resourceTotal("stone") < 26; tick++) simulation.update(.05);
  expect(simulation.resourceTotal("stone")).toBe(26);
  expect(simulation.saveState().actors.find(actor => actor.uid === id)?.ware ?? null).toBeNull();
});

it("authored hostile tower removal never credits its ground, dropped or roof ammunition to the player", () => {
  const world = huntingWorld(40), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialStock: { stone: 20 } });
  const placed = simulation.placeMilitaryScenarioBuilding(16, 20.5, 10.5);
  expect(placed.ok).toBe(true);
  const tower = placed.building!;
  tower.input.stone = 2;
  tower.catapultSupply = { ground: 3, drops: [{ x: tower.access.x, y: tower.y, z: tower.access.z }] };
  expect(simulation.removeMilitaryScenarioBuilding(tower.uid)).toEqual({ ok: true });
  expect(simulation.resourceTotal("stone")).toBe(20);
});
