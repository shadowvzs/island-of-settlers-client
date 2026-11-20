import type { SettlementContext, SettlementPoint } from "../settlement-types";

/**
 * The commander's `heightAt` input: the stored terrain height at the vertex nearest a point (world units).
 * Plain reads of the saved heightfield, so it is deterministic; points off the map read the edge.
 */
export const createGroundHeight = (context: SettlementContext) => (point: SettlementPoint) => {
  const { cellsX, cellsZ, heights } = context.options.world;
  const x = Math.min(cellsX, Math.max(0, Math.round(point.x))),
    z = Math.min(cellsZ, Math.max(0, Math.round(point.z)));
  return heights[z * (cellsX + 1) + x] ?? 0;
};
