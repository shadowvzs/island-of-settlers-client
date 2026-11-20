import type { GridSize } from "../grid-geometry";

/**
 * The grid the generation constants were tuned on. Feature sizes (hills, mountains, coves,
 * noise wavelengths) stay constant in cells; a bigger map gets more features, not bigger ones.
 */
export const REFERENCE_CELLS = 128;

/** Map side relative to the reference grid (2 for 256 x 256). */
export const getLinearScale = ({ cellsX, cellsZ }: GridSize) =>
  Math.sqrt(cellsX * cellsZ) / REFERENCE_CELLS;

/**
 * A per world count tuned on the reference grid, scaled with the map area (`exponent` < 1 grows
 * it slower than the area, e.g. rivers that each drain a bigger catchment).
 */
export const scaleCount = (grid: GridSize, count: number, exponent = 1) => {
  if (count <= 0) return 0;
  return Math.max(1, Math.round(count * Math.pow(getLinearScale(grid), 2 * exponent)));
};

/** Vertex position in reference units: the same number of cells per unit on every map size. */
export const toReferenceUnits = (cells: number) => cells / (REFERENCE_CELLS / 2);
