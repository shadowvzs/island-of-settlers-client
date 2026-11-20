import { sampleSmooth } from "../../grid-geometry";
import type { WorldData } from "../../world-data";

export type TerrainComponentKind = "water" | "relief";
export interface TerrainComponent {
  kind: TerrainComponentKind;
  cells: number[];
  /** Boundary cells only, for bounded cached overlay drawing. */
  boundary: number[];
  threshold: number;
  truncated: boolean;
}

/**
 * Select actual cardinal-connected visible contours, never an invented square feature.
 * Generated/baked terrain has no provenance: a connected mountain range or water network
 * remains one component. A hard budget refuses oversized components rather than clipping them.
 */
export const extractTerrainComponent = (world: WorldData, point: { x: number; z: number },
  kind: TerrainComponentKind, threshold = world.seaLevel + 3.5, limit = 32768): TerrainComponent | null => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z) || !Number.isFinite(threshold) ||
    point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return null;
  const matches = (cell: number) => {
    const x = cell % world.cellsX + .5, z = Math.floor(cell / world.cellsX) + .5;
    const ground = sampleSmooth(world, world.heights, x, z);
    return kind === "water" ? sampleSmooth(world, world.waterSurface, x, z) - ground >= .1 : ground >= threshold;
  };
  const seed = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  if (!matches(seed)) return null;
  const seen = new Set<number>([seed]), cells = [seed], boundary: number[] = [];
  const budget = Math.max(1, Math.min(65536, Math.floor(limit)));
  for (let cursor = 0; cursor < cells.length; cursor++) {
    const cell = cells[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    let edge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) { edge = true; continue; }
      const next = nz * world.cellsX + nx;
      if (seen.has(next)) continue;
      if (!matches(next)) { edge = true; continue; }
      if (cells.length >= budget) return { kind, cells: [], boundary: [], threshold, truncated: true };
      seen.add(next); cells.push(next);
    }
    if (edge) boundary.push(cell);
  }
  return { kind, cells, boundary, threshold, truncated: false };
};
