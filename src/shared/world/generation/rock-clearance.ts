import type { GridSize } from "../grid-geometry";

/** Closest a trunk may stand to the edge of a rocky neighbour cell (cells). */
export const ROCK_TRUNK_MARGIN = 0.45;

/** Per cell: true where the ground is rock (no tree roots there). */
export type RockyCells = Uint8Array;

/** Builds the rocky-cell mask from a per-cell predicate (row-major, cellsX x cellsZ). */
export const createRockyCells = (
  grid: GridSize,
  isRocky: (cellX: number, cellZ: number) => boolean
): RockyCells => {
  const cells = new Uint8Array(grid.cellsX * grid.cellsZ);
  for (let cellZ = 0; cellZ < grid.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < grid.cellsX; cellX += 1) {
      cells[cellZ * grid.cellsX + cellX] = isRocky(cellX, cellZ) ? 1 : 0;
    }
  }
  return cells;
};

const isRockyAt = (grid: GridSize, cells: RockyCells, cellX: number, cellZ: number) => {
  if (cellX < 0 || cellZ < 0 || cellX >= grid.cellsX || cellZ >= grid.cellsZ) return false;
  return cells[cellZ * grid.cellsX + cellX] === 1;
};

/** Keeps a coordinate at least `margin` inside its cell on the sides that border rock. */
const clampAxis = (value: number, cell: number, lowRocky: boolean, highRocky: boolean) => {
  const low = lowRocky ? cell + ROCK_TRUNK_MARGIN : -Infinity;
  const high = highRocky ? cell + 1 - ROCK_TRUNK_MARGIN : Infinity;
  return Math.min(Math.max(value, low), high);
};

/** Pushes the point away from a rocky diagonal neighbour's corner until it is `margin` away. */
const clearCorner = (
  point: [number, number],
  corner: [number, number],
  centre: [number, number]
) => {
  const distance = Math.hypot(point[0] - corner[0], point[1] - corner[1]);
  if (distance >= ROCK_TRUNK_MARGIN) return;
  const away = distance > 1e-4 ? point : centre;
  const length = Math.hypot(away[0] - corner[0], away[1] - corner[1]);
  point[0] = corner[0] + ((away[0] - corner[0]) / length) * ROCK_TRUNK_MARGIN;
  point[1] = corner[1] + ((away[1] - corner[1]) / length) * ROCK_TRUNK_MARGIN;
};

/**
 * Trunk spot next to rock: null on a rocky cell; otherwise the point moved inside its cell so it
 * keeps ROCK_TRUNK_MARGIN from every rocky neighbour (towards the cell centre when rock is all
 * around, away from the shared edge or corner otherwise). Unchanged when no neighbour is rock.
 */
export const fitTrunkAwayFromRock = (
  grid: GridSize,
  cells: RockyCells,
  x: number,
  z: number
): [number, number] | null => {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  if (isRockyAt(grid, cells, cellX, cellZ)) return null;
  const rocky = (dx: number, dz: number) => isRockyAt(grid, cells, cellX + dx, cellZ + dz);
  const point: [number, number] = [
    clampAxis(x, cellX, rocky(-1, 0), rocky(1, 0)),
    clampAxis(z, cellZ, rocky(0, -1), rocky(0, 1))
  ];
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ] as const) {
    if (!rocky(dx, dz)) continue;
    const corner: [number, number] = [cellX + Math.max(dx, 0), cellZ + Math.max(dz, 0)];
    clearCorner(point, corner, [cellX + 0.5, cellZ + 0.5]);
  }
  return point;
};
