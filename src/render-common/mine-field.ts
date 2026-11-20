import { DMath } from "../shared/math/deterministic-math";
import { type CellRegion,isRegionEmpty } from "../shared/world/grid-geometry";
import { BLOCKING, BUILD, NO_MINE_ZONE, ORE, SLOPE, type WorldData } from "../shared/world/world-data";

/** Byte step between ore codes in the splatC attribute (decoded in ground-glsl.ts). */
export const ORE_CODE_STEP = 40;
/** Cells around a vertex searched for its zone: covers the feathered edge of the mine ground. */
export const ZONE_REACH = 2;

/** Per vertex mine data for the ground shader: ore code (0 unsurveyed) and ore left (bytes). */
export interface MineVertexField {
  amount: Uint8Array;
  /** Conservative buildable mine-zone coverage, independent of ore tint/amount. */
  glint: Uint8Array;
  ore: Uint8Array;
}

const cache = new WeakMap<WorldData, MineVertexField>();

/** Zone cell nearest to the vertex within the reach (its cell index), or -1. */
const findZoneCell = (world: WorldData, vertexX: number, vertexZ: number) => {
  let best = -1;
  let bestDistance = Infinity;
  for (let cellZ = vertexZ - ZONE_REACH; cellZ < vertexZ + ZONE_REACH; cellZ += 1) {
    for (let cellX = vertexX - ZONE_REACH; cellX < vertexX + ZONE_REACH; cellX += 1) {
      if (cellX < 0 || cellZ < 0 || cellX >= world.cellsX || cellZ >= world.cellsZ) continue;
      const cell = cellZ * world.cellsX + cellX;
      if (world.mineZone[cell] === NO_MINE_ZONE) continue;
      const distance = DMath.hypot(cellX + 0.5 - vertexX, cellZ + 0.5 - vertexZ);
      if (distance >= bestDistance) continue;
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
};

/** All adjacent cells must be usable deposit ground: no spill into cliffs or the apron. */
const glintCoverage = (world: WorldData, vertexX: number, vertexZ: number) => {
  for (let z = vertexZ - 1; z <= vertexZ; z++) {
    for (let x = vertexX - 1; x <= vertexX; x++) {
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return 0;
      const cell = z * world.cellsX + x;
      const capacity = world.buildCap?.[cell] ?? world.buildClass?.[cell] ?? BUILD.none;
      if (world.mineZone[cell] === NO_MINE_ZONE || capacity < BUILD.flag ||
        world.blocking?.[cell] === BLOCKING.water || world.blocking?.[cell] === BLOCKING.cliff ||
        world.slopeClass?.[cell] === SLOPE.cliff) return 0;
    }
  }
  return 255;
};

/** Writes one vertex's ore code and amount from its nearest zone cell (zero outside zones). */
const writeVertex = (
  world: WorldData,
  field: MineVertexField,
  vertexX: number,
  vertexZ: number
) => {
  const vertex = vertexZ * (world.cellsX + 1) + vertexX;
  field.glint[vertex] = glintCoverage(world, vertexX, vertexZ);
  const cell = findZoneCell(world, vertexX, vertexZ);
  if (cell < 0) {
    field.amount[vertex] = 0;
    field.ore[vertex] = 0;
    return;
  }
  const zone = world.mineZones[world.mineZone[cell]! - 1]!;
  field.amount[vertex] = world.oreAmount[cell]!;
  field.ore[vertex] = (zone.surveyed ? zone.ore : ORE.none) * ORE_CODE_STEP;
};

/**
 * Ore code and ore amount per world vertex, taken from the nearest zone cell, so the values stay
 * constant across the soft mine ground edge. Unsurveyed zones get ORE.none (neutral glints, no
 * ore stain). Cached per world (all chunk builds share it).
 */
export const getMineVertexField = (world: WorldData): MineVertexField => {
  const cached = cache.get(world);
  if (cached) return cached;
  const count = (world.cellsX + 1) * (world.cellsZ + 1);
  const field: MineVertexField = {
    amount: new Uint8Array(count), glint: new Uint8Array(count), ore: new Uint8Array(count)
  };
  for (let vertexZ = 0; vertexZ <= world.cellsZ; vertexZ += 1) {
    for (let vertexX = 0; vertexX <= world.cellsX; vertexX += 1) {
      writeVertex(world, field, vertexX, vertexZ);
    }
  }
  cache.set(world, field);
  return field;
};

/** Mine land or ore changed in the cells (map editor): their vertices and reach are re-read. */
export const refreshMineVertexField = (world: WorldData, cells: CellRegion) => {
  const field = cache.get(world);
  if (!field || isRegionEmpty(cells)) return;
  const maxX = Math.min(world.cellsX, cells.maxX + 1 + ZONE_REACH);
  const maxZ = Math.min(world.cellsZ, cells.maxZ + 1 + ZONE_REACH);
  for (let vertexZ = Math.max(0, cells.minZ - ZONE_REACH); vertexZ <= maxZ; vertexZ += 1) {
    for (let vertexX = Math.max(0, cells.minX - ZONE_REACH); vertexX <= maxX; vertexX += 1) {
      writeVertex(world, field, vertexX, vertexZ);
    }
  }
};
