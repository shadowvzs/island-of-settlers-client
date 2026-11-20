import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

const SIZE = 64;
/** Land in the north, a narrow sea along the south map edge: the berth is close to the way out. */
const SHORE = 48;

export const edgeBayWorld = () => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = SHORE; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const world = { seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 32.5, z: 36.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() }
  } as unknown as WorldData;
  for (let z = SHORE; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    world.walkCost[z * SIZE + x] = 0; world.blocking[z * SIZE + x] = 1;
  }
  return world;
};

/** A settlement whose headquarters stands near a sea bay on the south map edge. */
export const edgeBaySettlement = (world = edgeBayWorld()) => {
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 30, roads, world });
  return simulation;
};
