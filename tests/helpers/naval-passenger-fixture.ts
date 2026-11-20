import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

/**
 * Shared harbour-to-harbour fixture of the naval passenger tests (split across files for parallel
 * slow-project workers, TEST-01): a strait between two harbours, a shipyard with one finished ship.
 */
export const navalPassengerFixture = (base?: WorldData) => {
  const width = 150, depth = 60, heights = new Float32Array((width + 1) * (depth + 1));
  for (let z = 0; z <= depth; z++) for (let x = 0; x <= width; x++)
    if (x >= 40 && x <= 103) heights[z * (width + 1) + x] = -2;
  // `base`: a generated world of the same size whose other layers let the island be saved as a game.
  const world = { ...base, seed: base?.seed ?? 1, cellsX: width, cellsZ: depth, seaLevel: -1, start: { x: 8.5, z: 10.5 }, heights,
    blocking: new Uint8Array(width * depth), walkCost: new Uint8Array(width * depth).fill(10),
    buildClass: new Uint8Array(width * depth).fill(BUILD.large),
    props: base ? { ...base.props, count: 0 }
      : { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < depth; z++) for (let x = 40; x <= 103; x++) {
    world.blocking[z * width + x] = 1; world.walkCost[z * width + x] = 0;
    world.buildClass[z * width + x] = 0;
  }
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads,
    initialStock: { cloth: 4, planks: 200, stone: 100, hammer: 8, shovel: 4 } });
  const place = (type: number, x: number, z: number, rotation = 0) => {
    const [baseWidth, baseDepth] = getBuildingDefinition(type).gridFootprint;
    const width = rotation % 2 ? baseDepth : baseWidth, depth = rotation % 2 ? baseWidth : baseDepth;
    const result = simulation.placeBuilding(type, Math.floor(x - width / 2) + width / 2,
      Math.floor(z - depth / 2) + depth / 2, rotation);
    expect(result.ok, result.reason).toBe(true);
    const building = result.building!;
    expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
    return building;
  };
  const source = place(39, 35, 10), destination = place(39, 34, 39), yard = place(36, 24, 25);
  simulation.setShipyardMode(yard.uid, "ships");
  for (let i = 0; i < 24000 && (!simulation.ships().length || source.construction < 1 ||
    destination.construction < 1); i++) simulation.update(.05);
  expect(simulation.ships()).toHaveLength(1);
  simulation.setProductionPaused(yard.uid, true);
  return { simulation, world, roads, yard, source, destination, place };
};
export const advance = (simulation: ReturnType<typeof createSettlementSimulation>, seconds: number) => {
  for (let time = 0; time < seconds; time += .05) simulation.update(.05);
};
export const population = (simulation: ReturnType<typeof createSettlementSimulation>) =>
  simulation.availableSettlers() + simulation.frames().filter(actor => actor.phase !== "retired").length -
  simulation.settlerBirths();

