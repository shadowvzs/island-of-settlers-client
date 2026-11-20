import type { WorldData } from "../../world-data";
import type { TerrainRestoreSource } from "./scoped-restore";

/**
 * Exact copies never feather silently: reject a newly steep join to any retained/protected vertex
 * (steeper than now and, for the seed baseline, than the original generated terrain).
 */
export const assertSeedRestoreBoundary = (world: WorldData, vertices: readonly number[], source: TerrainRestoreSource) => {
  const selected = new Set(vertices), stride = world.cellsX + 1;
  for (const vertex of vertices) for (const neighbour of [vertex - 1, vertex + 1, vertex - stride, vertex + stride]) {
    if (selected.has(neighbour)) continue;
    const before = Math.abs(world.heights[vertex]! - world.heights[neighbour]!);
    const after = Math.abs(source.heights[vertex]! - world.heights[neighbour]!);
    // A step the exact seed terrain itself has between the two vertices is restored, not new.
    const seedStep = source.seedBaseline ? Math.abs(source.heights[vertex]! - source.heights[neighbour]!) : 0;
    if (after > .7 && after > Math.max(before, seedStep) + .05)
      throw new Error("Exact seed copy would create a steep join at the protected contour boundary. " +
        "Smooth the current border or select a larger complete contour first; no terrain was changed.");
    const targetDepth = source.waterSurface[vertex]! - source.heights[vertex]!;
    const neighbourDepth = world.waterSurface[neighbour]! - world.heights[neighbour]!;
    const priorDepth = world.waterSurface[vertex]! - world.heights[vertex]!;
    const dryGap = targetDepth <= .01 && neighbourDepth > .01 &&
      source.heights[vertex]! < world.waterSurface[neighbour]! - .1 &&
      (priorDepth > .01 || source.heights[vertex]! < world.heights[vertex]! - .05);
    const floodEdge = targetDepth > .01 && neighbourDepth <= .01 &&
      source.waterSurface[vertex]! > world.heights[neighbour]! + .1 &&
      (priorDepth <= .01 || source.waterSurface[vertex]! > world.waterSurface[vertex]! + .01);
    if (dryGap || floodEdge)
      throw new Error("Exact seed copy would leave an incompatible wet/dry contour boundary. " +
        "Select the complete water contour first; no terrain was changed.");
    if (targetDepth <= .01 || neighbourDepth <= .01) continue;
    const priorWater = Math.abs(world.waterSurface[vertex]! - world.waterSurface[neighbour]!);
    const nextWater = Math.abs(source.waterSurface[vertex]! - world.waterSurface[neighbour]!);
    if (nextWater > .1 && nextWater > priorWater + .01)
      throw new Error("Exact seed copy would split a retained water surface into different levels. " +
        "Select the complete water contour first; no terrain was changed.");
  }
};
