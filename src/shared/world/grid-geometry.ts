import { DMath } from "../math/deterministic-math";
import { clamp } from "./noise";

/** Grid size only; generation steps and queries share it. */
export interface GridSize {
  cellsX: number;
  cellsZ: number;
}

export const getVertexCount = ({ cellsX, cellsZ }: GridSize) => (cellsX + 1) * (cellsZ + 1);

export const getCellCount = ({ cellsX, cellsZ }: GridSize) => cellsX * cellsZ;

export const getVertexIndex = (grid: GridSize, vertexX: number, vertexZ: number) =>
  vertexZ * (grid.cellsX + 1) + vertexX;

/** Inclusive cell bounds (an edit's dirty area); empty when min > max. */
export interface CellRegion {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

export const EMPTY_REGION: CellRegion = { maxX: -1, maxZ: -1, minX: 0, minZ: 0 };

export const isRegionEmpty = (region: CellRegion) =>
  region.minX > region.maxX || region.minZ > region.maxZ;

/** The region clamped to the grid's cells. */
export const clampRegion = (grid: GridSize, region: CellRegion): CellRegion => ({
  maxX: Math.min(grid.cellsX - 1, region.maxX),
  maxZ: Math.min(grid.cellsZ - 1, region.maxZ),
  minX: Math.max(0, region.minX),
  minZ: Math.max(0, region.minZ)
});

/** Cells within `margin` of the region (clamped to the grid). */
export const expandRegion = (grid: GridSize, region: CellRegion, margin: number) =>
  isRegionEmpty(region)
    ? region
    : clampRegion(grid, {
        maxX: region.maxX + margin,
        maxZ: region.maxZ + margin,
        minX: region.minX - margin,
        minZ: region.minZ - margin
      });

/** The region grown to whole blocks of `size` cells (block aligned, clamped to the grid). */
export const alignRegion = (grid: GridSize, region: CellRegion, size: number) =>
  isRegionEmpty(region)
    ? region
    : clampRegion(grid, {
        maxX: (Math.floor(region.maxX / size) + 1) * size - 1,
        maxZ: (Math.floor(region.maxZ / size) + 1) * size - 1,
        minX: Math.floor(region.minX / size) * size,
        minZ: Math.floor(region.minZ / size) * size
      });

/** Smallest region holding both. */
export const unionRegions = (first: CellRegion, second: CellRegion): CellRegion => {
  if (isRegionEmpty(first)) return second;
  if (isRegionEmpty(second)) return first;
  return {
    maxX: Math.max(first.maxX, second.maxX),
    maxZ: Math.max(first.maxZ, second.maxZ),
    minX: Math.min(first.minX, second.minX),
    minZ: Math.min(first.minZ, second.minZ)
  };
};

/** Bounds of a list of cells (EMPTY_REGION for none). */
export const getCellsRegion = (grid: GridSize, cells: readonly number[]) =>
  cells.reduce<CellRegion>((region, cell) => {
    const x = cell % grid.cellsX;
    const z = Math.floor(cell / grid.cellsX);
    return unionRegions(region, { maxX: x, maxZ: z, minX: x, minZ: z });
  }, EMPTY_REGION);

/** Cells a circle (world units) reaches, clamped to the grid. */
export const getCircleRegion = (grid: GridSize, x: number, z: number, radius: number) =>
  clampRegion(grid, {
    maxX: Math.floor(x + radius),
    maxZ: Math.floor(z + radius),
    minX: Math.floor(x - radius),
    minZ: Math.floor(z - radius)
  });

/** Calls `visit` for every cell of the region, row by row. */
export const forEachRegionCell = (
  grid: GridSize,
  region: CellRegion,
  visit: (cell: number, cellX: number, cellZ: number) => void
) => {
  for (let cellZ = region.minZ; cellZ <= region.maxZ; cellZ += 1) {
    for (let cellX = region.minX; cellX <= region.maxX; cellX += 1) {
      visit(cellZ * grid.cellsX + cellX, cellX, cellZ);
    }
  }
};

/** Vertex value with clamped coordinates (edges repeat). */
export const readVertex = (
  grid: GridSize,
  values: ArrayLike<number>,
  vertexX: number,
  vertexZ: number
) => {
  const x = clamp(vertexX, 0, grid.cellsX);
  const z = clamp(vertexZ, 0, grid.cellsZ);
  return values[z * (grid.cellsX + 1) + x] ?? 0;
};

/** Bilinear sample of a vertex layer at world coordinates. */
export const sampleBilinear = (grid: GridSize, values: ArrayLike<number>, x: number, z: number) => {
  const cx = clamp(x, 0, grid.cellsX - 1e-4);
  const cz = clamp(z, 0, grid.cellsZ - 1e-4);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fz = cz - z0;
  const stride = grid.cellsX + 1;
  const row = z0 * stride, nextRow = (z0 + 1) * stride;
  const top = (values[row + x0] ?? 0) * (1 - fx) + (values[row + x0 + 1] ?? 0) * fx;
  const bottom = (values[nextRow + x0] ?? 0) * (1 - fx) + (values[nextRow + x0 + 1] ?? 0) * fx;
  return top * (1 - fz) + bottom * fz;
};

/** Central difference slope (rise per cell) at a vertex. */
export const getVertexSlope = (
  grid: GridSize,
  heights: ArrayLike<number>,
  vertexX: number,
  vertexZ: number
) => {
  const dx =
    (readVertex(grid, heights, vertexX + 1, vertexZ) -
      readVertex(grid, heights, vertexX - 1, vertexZ)) /
    2;
  const dz =
    (readVertex(grid, heights, vertexX, vertexZ + 1) -
      readVertex(grid, heights, vertexX, vertexZ - 1)) /
    2;
  return DMath.hypot(dx, dz);
};

/** Largest height difference (world units) between a vertex and its 4-neighbours. */
export const getVertexStepRise = (
  grid: GridSize,
  heights: ArrayLike<number>,
  vertexX: number,
  vertexZ: number
) => {
  const height = readVertex(grid, heights, vertexX, vertexZ);
  return Math.max(
    Math.abs(readVertex(grid, heights, vertexX + 1, vertexZ) - height),
    Math.abs(readVertex(grid, heights, vertexX - 1, vertexZ) - height),
    Math.abs(readVertex(grid, heights, vertexX, vertexZ + 1) - height),
    Math.abs(readVertex(grid, heights, vertexX, vertexZ - 1) - height)
  );
};

/** Calls `visit` for every vertex within `radius` cells of `vertex` (itself excluded). */
export const forEachVertexNear = (
  grid: GridSize,
  vertex: number,
  radius: number,
  visit: (near: number) => void
) => {
  const stride = grid.cellsX + 1;
  const x = vertex % stride;
  const z = Math.floor(vertex / stride);
  const reach = Math.floor(radius);
  const lastX = Math.min(grid.cellsX, x + reach);
  const lastZ = Math.min(grid.cellsZ, z + reach);
  for (let nearZ = Math.max(0, z - reach); nearZ <= lastZ; nearZ += 1) {
    for (let nearX = Math.max(0, x - reach); nearX <= lastX; nearX += 1) {
      const near = nearZ * stride + nearX;
      if (near !== vertex && DMath.hypot(nearX - x, nearZ - z) <= radius) visit(near);
    }
  }
};

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** One row of the Catmull-Rom patch: the curve through four vertices along x at `fx`. */
const sampleSmoothRow = (
  grid: GridSize,
  values: ArrayLike<number>,
  x1: number,
  vertexZ: number,
  fx: number
) => {
  const row = Math.min(Math.max(vertexZ, 0), grid.cellsZ) * (grid.cellsX + 1);
  const left = Math.max(0, x1 - 1), right = Math.min(grid.cellsX, x1 + 1),
    farRight = Math.min(grid.cellsX, x1 + 2);
  return catmullRom(
    values[row + left] ?? 0,
    values[row + x1] ?? 0,
    values[row + right] ?? 0,
    values[row + farRight] ?? 0,
    fx
  );
};

/**
 * Smooth (Catmull-Rom) surface through the vertex values. The renderers draw the terrain on this
 * surface at a finer mesh than the gameplay grid; anything standing on the ground uses it too.
 * No array per call: animals sample it every frame.
 */
export const sampleSmooth = (grid: GridSize, values: ArrayLike<number>, x: number, z: number) => {
  const cx = clamp(x, 0, grid.cellsX);
  const cz = clamp(z, 0, grid.cellsZ);
  const x1 = Math.min(Math.floor(cx), grid.cellsX - 1);
  const z1 = Math.min(Math.floor(cz), grid.cellsZ - 1);
  const fx = cx - x1;
  const fz = cz - z1;
  return catmullRom(
    sampleSmoothRow(grid, values, x1, z1 - 1, fx),
    sampleSmoothRow(grid, values, x1, z1, fx),
    sampleSmoothRow(grid, values, x1, z1 + 1, fx),
    sampleSmoothRow(grid, values, x1, z1 + 2, fx),
    fz
  );
};
