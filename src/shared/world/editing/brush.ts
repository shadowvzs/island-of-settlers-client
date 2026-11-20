import { DMath } from "../../math/deterministic-math";
import { type CellRegion, getCircleRegion, type GridSize } from "../grid-geometry";
import { smoothstep } from "../noise";

/** A round brush on the ground (world units); `softness` 0 hard edge .. 1 soft all the way. */
export interface Brush {
  radius: number;
  softness: number;
  x: number;
  z: number;
}

/** Brush cover at which a cell counts as painted (mine land, ore). */
export const CELL_PAINT_WEIGHT = 0.5;

/** Brush cover 0..1 at a distance from its centre: full in the hard core, fading to the rim. */
export const getBrushWeight = (brush: Brush, distance: number) => {
  if (distance >= brush.radius) return 0;
  const core = brush.radius * (1 - brush.softness);
  if (distance <= core) return 1;
  return 1 - smoothstep(core, brush.radius, distance);
};

/** Brush cover of a cell, measured at its centre. */
const getCellBrushWeight = (brush: Brush, cellX: number, cellZ: number) =>
  getBrushWeight(brush, DMath.hypot(cellX + 0.5 - brush.x, cellZ + 0.5 - brush.z));

/** Cells whose centre the brush covers by at least CELL_PAINT_WEIGHT, with their cover. */
export const listPaintedCells = (grid: GridSize, brush: Brush) => {
  const region = getCircleRegion(grid, brush.x, brush.z, brush.radius);
  const cells: { cell: number; weight: number }[] = [];
  for (let cellZ = region.minZ; cellZ <= region.maxZ; cellZ += 1) {
    for (let cellX = region.minX; cellX <= region.maxX; cellX += 1) {
      const weight = getCellBrushWeight(brush, cellX, cellZ);
      if (weight >= CELL_PAINT_WEIGHT) cells.push({ cell: cellZ * grid.cellsX + cellX, weight });
    }
  }
  return cells;
};

/** Dirty cells of a vertex range: every cell touching one of the vertices. */
export const getVertexRangeCells = (
  grid: GridSize,
  range: { maxX: number; maxZ: number; minX: number; minZ: number }
): CellRegion => ({
  maxX: Math.min(grid.cellsX - 1, range.maxX),
  maxZ: Math.min(grid.cellsZ - 1, range.maxZ),
  minX: Math.max(0, range.minX - 1),
  minZ: Math.max(0, range.minZ - 1)
});
