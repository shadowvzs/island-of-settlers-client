import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** 2000 simulated seconds of a real sawmill, with and without the level-I +10% speed upgrade. */
const sawmillCycles = (upgraded: boolean) => {
  const size = 64;
  const world = { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: { planks: 20, stone: 200, saw: 1 }, resourceTargets: () => [] });
  const [width, depth] = getBuildingDefinition(33).gridFootprint;
  const building = simulation.placeBuilding(33, 30 + width % 2 / 2, 9 + depth % 2 / 2).building!;
  Object.assign(building, { construction: 1, required: {}, input: { logs: 200 } });
  if (upgraded) building.workshopUpgrade = { level: 1 };
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  for (let tick = 0; tick < 2000 * 20; tick++) simulation.update(.05);
  // Inputs per output are unchanged: one log per completed cycle.
  expect(200 - building.input.logs!).toBeGreaterThanOrEqual(building.cycle);
  return building.cycle;
};

it("measures the real throughput gain of an upgraded indoor workshop", () => {
  const base = sawmillCycles(false), upgraded = sawmillCycles(true);
  // The in-place sawing and rest run 10% faster; courtyard input/output walks do not. Since BAL-01
  // halved production times (80 → 108 base cycles) the walks weigh more: measured 108 → 112 (+3.7%).
  expect(upgraded / base).toBeGreaterThan(1.03);
  expect(upgraded / base).toBeLessThanOrEqual(1.1 + 1 / base);
});
