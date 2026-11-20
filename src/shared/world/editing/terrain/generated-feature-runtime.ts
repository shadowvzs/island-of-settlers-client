import type { CellRegion } from "../../grid-geometry";
import type { WorldData } from "../../world-data";

export interface FeatureTransformRuntime {
  canMoveResource?: (kind: "ore" | "stone", id: number) => string | null;
  canMoveProp?: (id: number) => string | null;
  protectedPoints?: Iterable<{ x: number; z: number; radius?: number }>;
}

/** Runtime actors are supplied by the live app; saved-world terrain code cannot infer them. */
export const protectFeatureRuntime = (
  world: WorldData,
  region: CellRegion,
  protectedVertices: Set<number>,
  runtime?: FeatureTransformRuntime
) => {
  let points = 0;
  for (const point of runtime?.protectedPoints ?? []) {
    if (++points > 32768)
      throw new Error(
        "Too many active actor/path points for a safe terrain transform. Pause or simplify this scene first."
      );
    const radius = point.radius ?? 0.6;
    if (![point.x, point.z, radius].every(Number.isFinite) || radius < 0 || radius > 8)
      throw new Error(
        "An active actor has invalid clearance; the terrain transform was cancelled."
      );
    if (
      point.x + radius < region.minX - 3 ||
      point.z + radius < region.minZ - 3 ||
      point.x - radius > region.maxX + 3 ||
      point.z - radius > region.maxZ + 3
    )
      continue;
    for (
      let z = Math.max(0, Math.floor(point.z - radius) - 2);
      z <= Math.min(world.cellsZ, Math.ceil(point.z + radius) + 2);
      z++
    )
      for (
        let x = Math.max(0, Math.floor(point.x - radius) - 2);
        x <= Math.min(world.cellsX, Math.ceil(point.x + radius) + 2);
        x++
      )
        protectedVertices.add(z * (world.cellsX + 1) + x);
  }
};
