import type { WorldData } from "./world-data";

/** A cell is wet water for the sea mask when all four corners lie this far below the sea (and no lake). */
export const SEA_WET_DEPTH = .25;

/**
 * JETTY-FRAMES: the heights and lake vertices a sea mask was derived from. A later height edit that
 * keeps every changed vertex dry (at or above the wet depth before and after) cannot change any wet
 * cell, so the mask derived from them still holds without the flood fill.
 */
export interface SeaMaskSource {
  heights: Float32Array;
  lake: Uint8Array | undefined;
  seaLevel: number;
  /** The arrays copied: a replaced array derives the mask again. */
  sourceHeights: WorldData["heights"];
  sourceLake: WorldData["lakeWater"];
  world: WorldData;
}

export const captureSeaMaskSource = (world: WorldData): SeaMaskSource => ({
  heights: world.heights.slice(), lake: world.lakeWater?.slice(), seaLevel: world.seaLevel,
  sourceHeights: world.heights, sourceLake: world.lakeWater, world
});

const sameLake = (world: WorldData, source: SeaMaskSource) => {
  const current = world.lakeWater, copy = source.lake;
  if (!current || !copy) return !current && !copy;
  return current.length === copy.length && current.every((value, vertex) => value === copy[vertex]);
};

/** The changed vertices when all stay dry, else null. */
const dryHeightChanges = (world: WorldData, source: SeaMaskSource) => {
  const wetBelow = world.seaLevel - SEA_WET_DEPTH, heights = world.heights, copy = source.heights;
  const changed: number[] = [];
  for (let vertex = 0; vertex < heights.length; vertex++) {
    if (heights[vertex] === copy[vertex]) continue;
    if (heights[vertex]! < wetBelow || copy[vertex]! < wetBelow) return null;
    changed.push(vertex);
  }
  return changed;
};

/** True when the mask derived from `source` is still exact; dry height changes are copied into it. */
export const seaMaskSourceHolds = (world: WorldData, source: SeaMaskSource) => {
  if (source.world !== world || source.sourceHeights !== world.heights || source.sourceLake !== world.lakeWater ||
    source.seaLevel !== world.seaLevel || source.heights.length !== world.heights.length || !sameLake(world, source))
    return false;
  const changed = dryHeightChanges(world, source);
  if (!changed) return false;
  for (const vertex of changed) source.heights[vertex] = world.heights[vertex]!;
  return true;
};
