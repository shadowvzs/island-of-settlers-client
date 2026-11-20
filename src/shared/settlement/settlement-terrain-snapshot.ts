import { bumpBuildRevision, bumpTerrainRevision } from "../world/save/world-change-journal";
import { refreshFoundationTerrain } from "./settlement-foundation";
import type { SettlementContext } from "./settlement-types";

export interface TerrainSnapshot {
  heightLevels?: Uint8Array;
  heights: Float32Array;
}

/** The terrain heights before a tentative change (foundation and road leveling). */
export const snapshotTerrain = (context: SettlementContext): TerrainSnapshot =>
  ({ heightLevels: context.options.world.heightLevels?.slice(), heights: context.options.world.heights.slice() });

/** Vertex bounds where the heights differ from the snapshot, or null when nothing changed. */
const changedBounds = (context: SettlementContext, snapshot: TerrainSnapshot) => {
  const { cellsX, heights } = context.options.world, stride = cellsX + 1;
  const bounds = { maxX: -1, maxZ: -1, minX: Infinity, minZ: Infinity };
  for (let vertex = 0; vertex < heights.length; vertex++) {
    if (heights[vertex] === snapshot.heights[vertex]) continue;
    const x = vertex % stride, z = (vertex - x) / stride;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds.maxX < 0 ? null : bounds;
};

/**
 * Puts the snapshot heights back and refreshes slope, blocking, walk cost and build class there;
 * the renderer hears of it like any road grading.
 */
export const restoreTerrain = (context: SettlementContext, snapshot: TerrainSnapshot) => {
  const { world } = context.options;
  const bounds = changedBounds(context, snapshot);
  if (!bounds) return;
  world.heights.set(snapshot.heights);
  if (snapshot.heightLevels) world.heightLevels?.set(snapshot.heightLevels);
  bumpTerrainRevision(world, bounds);
  bumpBuildRevision(world, null);
  const region = refreshFoundationTerrain(world, bounds);
  context.options.onRoadGroundLeveled?.(region);
};
