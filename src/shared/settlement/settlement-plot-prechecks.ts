import type { WorldData } from "../world/world-data";
import { PLOT_GENTLE_RISE, PLOT_GROUND_MARGIN, PLOT_SPACING } from "./constants";
import type { SettlementContext } from "./settlement-types";

/**
 * Cheap plot pre-checks run before the real placement rules (`placementReason`): the debug "build every
 * building" search and the economy AI's candidate plot cache share them. `left`/`top` are the plot's corner
 * cell, `width`/`depth` its turned footprint.
 */

/**
 * Every plot cell `owned` and on the map, and the plot with a lane of `PLOT_SPACING` cells around it free of
 * other buildings, so roads can pass between.
 */
export const isPlotLaneFree = (
  context: Pick<SettlementContext, "occupied" | "options">, owned: Uint8Array, left: number, top: number,
  width: number, depth: number
) => {
  const { cellsX, cellsZ } = context.options.world;
  if (left + width >= cellsX || top + depth >= cellsZ) return false;
  for (let z = top; z < top + depth; z++) for (let x = left; x < left + width; x++)
    if (owned[z * cellsX + x] !== 1) return false;
  const laneTop = Math.max(0, top - PLOT_SPACING), laneBottom = Math.min(cellsZ, top + depth + PLOT_SPACING);
  const laneLeft = Math.max(0, left - PLOT_SPACING), laneRight = Math.min(cellsX, left + width + PLOT_SPACING);
  for (let z = laneTop; z < laneBottom; z++) for (let x = laneLeft; x < laneRight; x++)
    if (context.occupied[z * cellsX + x] === 1) return false;
  return true;
};

/**
 * Gentle ground around the plot: its foundation and apron leveling then barely change the terrain, so
 * neighbouring roads keep their grade (packed plots on a slope cut cliffs beside them).
 */
export const isGentlePlotGround = (
  world: Pick<WorldData, "cellsX" | "cellsZ" | "heights">, left: number, top: number, width: number, depth: number
) => {
  const { cellsX, cellsZ, heights } = world;
  const lastZ = Math.min(cellsZ, top + depth + PLOT_GROUND_MARGIN);
  const lastX = Math.min(cellsX, left + width + PLOT_GROUND_MARGIN);
  let lowest = Infinity, highest = -Infinity;
  for (let z = Math.max(0, top - PLOT_GROUND_MARGIN); z <= lastZ; z++)
    for (let x = Math.max(0, left - PLOT_GROUND_MARGIN); x <= lastX; x++) {
      const height = heights[z * (cellsX + 1) + x]!;
      lowest = Math.min(lowest, height); highest = Math.max(highest, height);
    }
  return highest - lowest <= PLOT_GENTLE_RISE;
};
