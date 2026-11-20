import { type CellRegion, getVertexCount, type GridSize,readVertex } from "./grid-geometry";
import { clamp, smoothstep } from "./noise";

/** Heights above the hills count as mountain: 0 at MOUNTAIN_BASE .. 1 MOUNTAIN_RANGE higher. */
const MOUNTAIN_BASE = 3;
const MOUNTAIN_RANGE = 4;
/**
 * Cells around a point whose highest ground still makes it mountain. A face is steep, so its foot
 * lies well below the mountain altitude a few cells from the lip: without the reach the skin
 * faded out half way down every face, leaving a sawtooth fringe over bare, dark cliff ground.
 */
const MOUNTAIN_REACH = 2;

const getHighestAround = (
  grid: GridSize,
  heights: Float32Array,
  vertexX: number,
  vertexZ: number
) => {
  let highest = -Infinity;
  for (let dz = -MOUNTAIN_REACH; dz <= MOUNTAIN_REACH; dz += 1) {
    for (let dx = -MOUNTAIN_REACH; dx <= MOUNTAIN_REACH; dx += 1) {
      if (dx * dx + dz * dz > MOUNTAIN_REACH * MOUNTAIN_REACH) continue;
      highest = Math.max(highest, readVertex(grid, heights, vertexX + dx, vertexZ + dz));
    }
  }
  return highest;
};

/**
 * Per vertex 0..1 mountain mass: the highest ground within reach above the hills (rock archetype,
 * rock tint, skin cover). Built once per world, shared by the skin and prop placement.
 */
export const createMountainField = (grid: GridSize, heights: Float32Array) => {
  const field = new Float32Array(getVertexCount(grid));
  refreshMountainField(grid, heights, field, {
    maxX: grid.cellsX - 1,
    maxZ: grid.cellsZ - 1,
    minX: 0,
    minZ: 0
  });
  return field;
};

/**
 * The mountain mass of a region's vertices again, and of those within its reach (map editor
 * heights: the rest of the field keeps its values).
 */
export const refreshMountainField = (
  grid: GridSize,
  heights: Float32Array,
  field: Float32Array,
  cells: CellRegion
) => {
  const lastZ = Math.min(grid.cellsZ, cells.maxZ + 1 + MOUNTAIN_REACH);
  const lastX = Math.min(grid.cellsX, cells.maxX + 1 + MOUNTAIN_REACH);
  for (let vertexZ = Math.max(0, cells.minZ - MOUNTAIN_REACH); vertexZ <= lastZ; vertexZ += 1) {
    for (let vertexX = Math.max(0, cells.minX - MOUNTAIN_REACH); vertexX <= lastX; vertexX += 1) {
      const above = getHighestAround(grid, heights, vertexX, vertexZ) - MOUNTAIN_BASE;
      field[vertexZ * (grid.cellsX + 1) + vertexX] = clamp(above / MOUNTAIN_RANGE, 0, 1);
    }
  }
};

/**
 * Share of the ground the sculpted mountain rock skin covers: steep, mountainous slopes. Shared
 * by the skin builder (render) and prop placement (no tree or plant inside the rock surface).
 */
export const getRockSkinCover = (surfaceSlope: number, mountain: number) =>
  smoothstep(0.5, 0.9, surfaceSlope) * smoothstep(0, 0.18, mountain);
