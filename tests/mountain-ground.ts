import { isGravelGround } from "../src/shared/world/generation/mine-apron";
import { getDominantMaterial } from "../src/shared/world/ground-buffer";
import type { WorldData } from "../src/shared/world/world-data";

/**
 * Open ground vertices (dry, below the snow line, no rock face) that touch a rock vertex
 * (8-neighbours), with their dominant material.
 */
export const listRockNeighbours = (world: WorldData, isRock: (vertex: number) => boolean) => {
  const stride = world.cellsX + 1;
  const found: { material: number; vertex: number }[] = [];
  for (let vertex = 0; vertex < world.heights.length; vertex += 1) {
    if (isRock(vertex) || !isGravelGround(world, world, vertex)) continue;
    const x = vertex % stride;
    const z = Math.floor(vertex / stride);
    const touches = [-1, 0, 1].some((dz) =>
      [-1, 0, 1].some((dx) => {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= stride || nz > world.cellsZ) return false;
        return isRock(nz * stride + nx);
      })
    );
    if (touches) found.push({ material: getDominantMaterial(world.splat, vertex), vertex });
  }
  return found;
};
