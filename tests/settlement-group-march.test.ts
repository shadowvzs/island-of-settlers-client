import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const session = () => {
  const size = 96;
  const world = {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 30, z: 48 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { planks: 200, stone: 200 }, canWorkerEnterPlot: () => true });
  const advance = (seconds: number) => { for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05); };
  const tower = (typeId: number) => {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    const { x, z } = simulation.headquarters;
    const result = simulation.placeBuilding(typeId, x + 14 + width % 2 / 2, z + depth % 2 / 2);
    if (!result.ok || !result.building) throw new Error(result.reason);
    Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectRoads(simulation.headquarters.access, result.building.access)).toBe(true);
    return result.building;
  };
  const inside = (uid: number) => simulation.militaryBuildings().find(entry => entry.uid === uid)!;
  return { advance, inside, simulation, tower };
};

it("marches a group ordered together at its slowest member's pace, and single units at their own", () => {
  const { advance, simulation } = session();
  simulation.receiveTroops([{ hp: 125, rank: 0, type: "shield" }, { hp: 100, rank: 0, type: "heavy" }]);
  const { x, z } = simulation.headquarters;
  expect(simulation.callOutMilitary(["shield", "heavy"], { x: x + 6, z: z + 6 })).toBe(2);
  advance(20);
  const field = () => simulation.militarySoldiers().map(soldier =>
    ({ soldier, body: simulation.frames().find(actor => actor.uid === soldier.actor)! }));
  const [first, second] = field();
  const target = { x: first!.body.x + 20, z: first!.body.z };
  expect(simulation.commandMilitary([first!.soldier.actor, second!.soldier.actor], target, "move")).toBe(true);
  advance(6);
  const [a, b] = field();
  // Same pace: the gap between them stays small instead of the swordsman racing ahead.
  expect(Math.abs(a!.body.x - b!.body.x)).toBeLessThan(2);
  expect(simulation.commandMilitary([a!.soldier.actor], { x: a!.body.x, z: a!.body.z + 12 }, "move")).toBe(true);
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === a!.soldier.actor)!.combat!.marchSpeed)
    .toBeUndefined();
});
