import type { Random } from "../rng";

const ATTEMPTS = 20;

interface PoissonGrid {
  cellSize: number;
  columns: number;
  occupied: Int32Array;
  rows: number;
}

/** Squared distances (no square root): this runs millions of times on a 256 x 256 map. */
const isFarEnough = (grid: PoissonGrid, points: number[], x: number, z: number, radius: number) => {
  const column = Math.floor(x / grid.cellSize);
  const row = Math.floor(z / grid.cellSize);
  const radiusSquared = radius * radius;
  const firstColumn = Math.max(0, column - 2);
  const lastColumn = Math.min(grid.columns - 1, column + 2);
  const lastRow = Math.min(grid.rows - 1, row + 2);
  for (let r = Math.max(0, row - 2); r <= lastRow; r += 1) {
    for (let c = firstColumn; c <= lastColumn; c += 1) {
      const pointIndex = grid.occupied[r * grid.columns + c]!;
      if (pointIndex < 0) continue;
      const dx = points[pointIndex * 2]! - x;
      const dz = points[pointIndex * 2 + 1]! - z;
      if (dx * dx + dz * dz < radiusSquared) return false;
    }
  }
  return true;
};

/**
 * Bridson Poisson disc sampling: evenly spread points with a minimum distance, returned as
 * [x0, z0, x1, z1, ...]. Natural looking spacing for vegetation and rocks.
 */
export const samplePoissonDisc = (
  width: number,
  height: number,
  radius: number,
  random: Random
) => {
  const cellSize = radius / Math.SQRT2;
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid: PoissonGrid = {
    cellSize,
    columns,
    occupied: new Int32Array(columns * rows).fill(-1),
    rows
  };
  const points: number[] = [];
  const active: number[] = [];
  const addPoint = (x: number, z: number) => {
    const pointIndex = points.length / 2;
    points.push(x, z);
    active.push(pointIndex);
    grid.occupied[Math.floor(z / cellSize) * columns + Math.floor(x / cellSize)] = pointIndex;
  };
  addPoint(random() * width, random() * height);
  while (active.length > 0) {
    const slot = Math.floor(random() * active.length);
    const pointIndex = active[slot]!;
    let found = false;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = radius * (1 + random());
      const x = points[pointIndex * 2]! + Math.cos(angle) * distance;
      const z = points[pointIndex * 2 + 1]! + Math.sin(angle) * distance;
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      if (!isFarEnough(grid, points, x, z, radius)) continue;
      addPoint(x, z);
      found = true;
      break;
    }
    if (found) continue;
    active[slot] = active[active.length - 1]!;
    active.pop();
  }
  return points;
};
