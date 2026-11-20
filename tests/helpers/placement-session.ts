import { createRoadPlotReservation } from "../../src/app/settlement/road-plot-reservation";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BLOCKING, BUILD, type WorldData } from "../../src/shared/world/world-data";

export const PLACEMENT_SIZE = 120;

export interface PlacementSessionOptions {
  clockStart?: number;
  initialSettlers?: number;
  initialStock?: Record<string, number>;
}

/** A flat buildable island with a lake east of the start (the headquarters' territory covers both). */
export const createPlacementSession = (options: PlacementSessionOptions = {}) => {
  const size = PLACEMENT_SIZE;
  const world = {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 50, z: 50 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    fog: new Uint8Array(size ** 2).fill(2),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: {
      count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array()
    }
  } as unknown as WorldData;
  for (let z = 40; z < 60; z++)
    for (let x = 64; x < 72; x++) {
      world.blocking[z * size + x] = BLOCKING.water;
      world.buildClass[z * size + x] = BUILD.none;
    }
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const reservation = createRoadPlotReservation();
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => reservation.blocks(x, z) || (simulation?.isOccupied(x, z) ?? false)
  });
  simulation = createSettlementSimulation({ world, roads,
    ...(options.clockStart === undefined ? {} : { clockStart: options.clockStart }),
    initialSettlers: options.initialSettlers ?? 4,
    initialStock: options.initialStock ?? { planks: 200, stone: 200 },
    canWorkerEnterPlot: () => true });
  return { reservation, roads, simulation, world };
};
