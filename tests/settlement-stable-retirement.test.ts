import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40;
  const world = { seed: 7, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }, mineZones: [], oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2) } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: { planks: 20, stone: 20 } });
  return { get simulation() { return simulation; }, set simulation(next) { simulation = next; }, world, roads };
};

it("rejects removed Stable and specialist sawmill construction and save identities", () => {
  const { simulation } = fixture();
  for (const typeId of [38, 44, 48, 52, 56, 63]) {
    expect(BUILDING_CATALOG.some(building => building.id === typeId)).toBe(false);
    expect(simulation.placeBuilding(typeId, 18, 18).ok).toBe(false);
    expect(simulation.allowsBuilding(typeId)).toBe(false);
  }
});
