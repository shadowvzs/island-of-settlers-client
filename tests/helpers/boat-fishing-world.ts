import { isBuildingCourtyardPointWalkable } from "../../src/render-common/buildings/building-courtyard";
import { claimBuilding, makeBuilding } from "../../src/shared/settlement/settlement-placement";
import type {
  SettlementBuilding, SettlementContext, SettlementPoint
} from "../../src/shared/settlement/settlement-types";
import { BLOCKING, BUILD, type WorldData } from "../../src/shared/world/world-data";

export const BOAT_WORLD_SIZE = 48;
const DRY_HEIGHT = .15;
const WATERLINE_HEIGHT = -.2;
const DEEP_HEIGHT = -1;

const vertexHeight = (wetCorners: number) => {
  if (wetCorners === 4) return DEEP_HEIGHT;
  return wetCorners ? WATERLINE_HEIGHT : DRY_HEIGHT;
};

/** Paints water cells onto a flat world at sea level 0: banks slope gently into deep water. */
export const paintBoatWater = (world: WorldData, water: (x: number, z: number) => boolean) => {
  const size = world.cellsX, stride = size + 1;
  world.seaLevel = 0;
  world.flow ??= new Float32Array(stride * (world.cellsZ + 1) * 2);
  world.riverDistance ??= new Float32Array(stride * (world.cellsZ + 1)).fill(99);
  const wet = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < world.cellsZ && water(x, z);
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < size; x++) if (wet(x, z)) {
    world.blocking[z * size + x] = BLOCKING.water; world.walkCost[z * size + x] = 0;
  }
  for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x <= size; x++) {
    const corners = [wet(x - 1, z - 1), wet(x, z - 1), wet(x - 1, z), wet(x, z)];
    world.heights[z * stride + x] = vertexHeight(corners.filter(Boolean).length);
  }
  return world;
};

/** A flat dry world with `water(x, z)` cells. */
export const boatFishingWorld = (water: (x: number, z: number) => boolean) => {
  const size = BOAT_WORLD_SIZE, stride = size + 1;
  const world = { cellsX: size, cellsZ: size, seaLevel: 0, seed: 1,
    heights: new Float32Array(stride ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0 }, mineZones: [], oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2) } as unknown as WorldData;
  return paintBoatWater(world, water);
};

/** A settlement around `world` with a completed Fishery at `x`, `z`. */
export const boatFishingSettlement = (world: WorldData, x = 16, z = 20) => {
  const size = world.cellsX;
  const context = { options: { world,
    roads: { route: () => null, addRoad: () => true, upgradeRoad: () => true },
    resourceTargets: () => undefined,
    canWorkerEnterPlot: (building: SettlementBuilding, point: SettlementPoint) =>
      isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation, point)
  }, buildings: [], actors: [], occupied: new Uint8Array(size * world.cellsZ), reservations: new Set(),
  nextActor: 0, nextBuilding: 0, settlers: 1, resourceAmounts: new Map(), transfers: [],
  accumulator: 0, scheduling: 0 } as unknown as SettlementContext;
  const fishery = makeBuilding(context, 18, x, z, 0);
  fishery.construction = 1; claimBuilding(context, fishery);
  return { context, fishery };
};
