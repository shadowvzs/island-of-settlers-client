import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import type { EmigratedTroop } from "../../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

type Simulation = ReturnType<typeof createSettlementSimulation>;

const WIDTH = 150, DEPTH = 60, STRAIT_WEST = 40, STRAIT_EAST = 103;

/** The naval passenger strait (two shores of one map), dry land west and east of a 64-tile sea. */
export const straitWorld = () => {
  const heights = new Float32Array((WIDTH + 1) * (DEPTH + 1));
  // Both shores slope alike: the first dry cell of each has one wet corner (a beach, not a cliff).
  for (let z = 0; z <= DEPTH; z++)
    for (let x = STRAIT_WEST; x <= STRAIT_EAST + 1; x++) heights[z * (WIDTH + 1) + x] = -2;
  const world = { seed: 1, cellsX: WIDTH, cellsZ: DEPTH, seaLevel: -1, start: { x: 8.5, z: 10.5 }, heights,
    blocking: new Uint8Array(WIDTH * DEPTH), walkCost: new Uint8Array(WIDTH * DEPTH).fill(10),
    buildClass: new Uint8Array(WIDTH * DEPTH).fill(BUILD.large),
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < DEPTH; z++) for (let x = STRAIT_WEST; x <= STRAIT_EAST; x++) {
    world.blocking[z * WIDTH + x] = 1; world.walkCost[z * WIDTH + x] = 0; world.buildClass[z * WIDTH + x] = 0;
  }
  return world;
};

/** A finished building of `type` near `x`, `z`, joined to the headquarters by road. */
export const finishedBuilding = (simulation: Simulation, type: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const result = simulation.placeBuilding(type, Math.floor(x - width / 2) + width / 2,
    Math.floor(z - depth / 2) + depth / 2, 0);
  expect(result.ok, result.reason).toBe(true);
  const building = result.building!;
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  Object.assign(building, { construction: 1, foundationProgress: 1, required: {} });
  return building;
};

/**
 * MIL-SHIPS-SIM fixture: two finished harbours on the west shore, one idle own ship at the first, and stored
 * soldiers in the headquarters. The east shore is another landmass (a second island of the same map).
 */
export const troopShipFixture = (world: WorldData = straitWorld()) => {
  let simulation: Simulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 30,
    initialStock: { planks: 200, stone: 100 }, roads, world });
  const source = finishedBuilding(simulation, 39, 35, 10), destination = finishedBuilding(simulation, 39, 34, 39);
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  expect(simulation.debugEnsureFreeShips(source.uid, 1).free).toBe(1);
  const shipId = simulation.ships()[0]!.id;
  return { destination, roads, shipId, simulation, source, world };
};

/** Stored soldiers granted to the headquarters; returns their actor ids in grant order. */
export const grantSoldiers = (simulation: Simulation, types: readonly EmigratedTroop["type"][]) => {
  const before = new Set(simulation.militarySoldiers().map(soldier => soldier.actor));
  simulation.receiveTroops(types.map(type => ({ hp: 90, rank: 0, type })));
  return simulation.militarySoldiers().map(soldier => soldier.actor).filter(uid => !before.has(uid));
};

export const advanceUntil = (simulation: Simulation, done: () => boolean, maximumTicks = 12000) => {
  for (let tick = 0; tick < maximumTicks && !done(); tick++) simulation.update(.05);
  return done();
};
