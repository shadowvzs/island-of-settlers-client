import { expect, it } from "vitest";

import {
  ARCHER_SCAFFOLD_SITE, banditCampPlan, placedBanditCamp
} from "../src/render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementColony } from "../src/shared/settlement/settlement-colony";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("does not award conquest while a fallen tower archer survives", () => {
  const soldiers = [
    { actor: 1, building: -3, stationed: false, combat: { faction: 0 } },
    { actor: 2, building: -3, stationed: false, combat: { faction: 1, fallenTowerArcher: true, hp: 1 } }
  ];
  const context = { buildings: [], actors: [], options: { world: { cellsX: 40, cellsZ: 40 } } };
  const military = { soldiers: () => soldiers, combat: { doors: () => [] },
    commander: { recordMissionFailure: () => undefined, recordMissionResult: () => undefined } };
  const colony = createSettlementColony(context as never, military as never, () => 5000);
  colony.restore({
    version: 1,
    forts: 1,
    status: "contested",
    island: {
      kind: "colony",
      difficulty: "easy"
    } as never
  });
  colony.update(0.5);
  expect(colony.snapshot()?.status).toBe("contested");
  soldiers.pop();
  colony.update(0.5);
  expect(colony.snapshot()).toMatchObject({ status: "conquered", conqueredAt: 5000 });
});

const fixture = (type: "heavy" | "archer" = "heavy") => {
  const size = 40;
  const world = {
    seed: 9,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: {
      count: 0,
      types: new Uint8Array(),
      x: new Float32Array(),
      z: new Float32Array(),
      scale: new Float32Array()
    }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    world,
    roads,
    initialSettlers: 20,
    initialStock: { planks: 80, stone: 80 },
    canWorkerEnterPlot: () => true
  });
  simulation.receiveTroops([{ type, rank: 2, hp: militaryHealth(type, 2) }]);
  simulation.callOutMilitary([type], { x: 20, z: 24.5 });
  for (let second = 0; second < 90; second++) simulation.update(1);
  const [width, depth] = getBuildingDefinition(4).gridFootprint;
  const placed = simulation.placeBuilding(4, 20 + (width % 2) / 2, 20 + (depth % 2) / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const saved = simulation.saveState(),
    site = saved.buildings.find((building) => building.uid === placed.building!.uid)!;
  Object.assign(
    site,
    {
      x: 20,
      z: 20,
      bandit: ARCHER_SCAFFOLD_SITE,
      militaryFaction: 1,
      construction: 1,
      required: {},
      hasDoor: false
    },
    placedBanditCamp(ARCHER_SCAFFOLD_SITE, 20, 20)
  );
  saved.military!.combat!.doors.push({
    building: site.uid,
    faction: 1,
    hp: 200,
    maximum: 200,
    structure: { hp: 50, maximum: 35000 }
  });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const guard = simulation.spawnMilitaryOpponent({ x: 18, z: 20 }, "archer")!;
  expect(
    simulation.registerMilitaryGarrison(site.uid, [guard], 1, 200, { hp: 50, maximum: 35000 })
  ).toBe(true);
  const attacker = simulation
    .militarySoldiers()
    .find((soldier) => soldier.combat?.faction === 0)!.actor;
  return { simulation, site, guard, attacker };
};

it("melee destroys an occupied open tower, releases a damaged survivor, and resumes a saved fall", () => {
  const { attacker, guard, simulation, site } = fixture();
  expect(banditCampPlan(ARCHER_SCAFFOLD_SITE)).toMatchObject({ kind: "tower", cells: [2, 2], capacity: 3 });
  expect(simulation.siegeMilitary([attacker], site.uid)).toBe(true);
  let falling = false;
  for (let tick = 0; tick < 1200 && !falling; tick++) {
    simulation.update(0.05);
    falling = Boolean(
      simulation.militarySoldiers().find((soldier) => soldier.actor === guard)?.combat?.towerFall
    );
  }
  expect(falling).toBe(true);
  const saved = simulation.saveState(),
    survivor = saved.military!.soldiers.find((soldier) => soldier.actor === guard)!;
  expect(survivor).toMatchObject({
    building: -3,
    stationed: false,
    combat: { fallenTowerArcher: true, hp: militaryHealth("archer", 0) * .75 }
  });
  const invalid = structuredClone(saved);
  invalid.military!.soldiers.find(
    (soldier) => soldier.actor === guard
  )!.combat!.towerFall!.remaining = 2;
  expect(simulation.loadState(invalid)).toMatchObject({
    ok: false,
    reason: "Invalid tower collapse recovery"
  });
  expect(
    saved.military!.combat!.doors.find((door) => door.building === site.uid)!.structure!.hp
  ).toBe(0);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  for (let tick = 0; tick < 20; tick++) simulation.update(0.05);
  const landed = simulation.militarySoldiers().find((soldier) => soldier.actor === guard)!;
  expect(landed.combat?.towerFall).toBeUndefined();
  expect(landed.combat?.hp).toBeLessThanOrEqual(militaryHealth("archer", 0));
  const actor = simulation.snapshot().actors.find((actor) => actor.uid === guard)!;
  expect(actor.visible).toBe(true);
  expect(actor.y).toBeCloseTo(0);
  expect(simulation.isOccupied(actor.x, actor.z)).toBe(false);
});

it("ground archers exchange arrows with elevated archers while the occupied supports remain intact", () => {
  const { attacker, guard, simulation, site } = fixture("archer");
  const before = simulation.militarySoldiers().find((soldier) => soldier.actor === guard)!.combat!
    .hp;
  for (let tick = 0; tick < 240; tick++) simulation.update(0.05);
  const defender = simulation.militarySoldiers().find((soldier) => soldier.actor === guard);
  expect(defender?.combat?.hp ?? 0).toBeLessThan(before);
  expect(simulation.militaryDoors().find((door) => door.building === site.uid)!.structure!.hp).toBe(
    50
  );
  expect(
    simulation.militarySoldiers().find((soldier) => soldier.actor === attacker)?.combat?.hp ?? 0
  ).toBeLessThan(militaryHealth("archer", 2));
});
