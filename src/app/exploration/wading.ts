import { sampleBilinear } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/**
 * Shore wading of the possessed body (owner 2026-11-09): about one tile into shallow water at
 * the shore, never into deep water or across a river. Presentation only: settlers, navigation
 * and the simulation never read it.
 */

/** Deepest water the body wades through (world units; a worker is about 1.06 tall: knee deep). */
export const EXPLORATION_MAX_WADE_DEPTH = 0.3;
/** How far past the shoreline the body may wade (cells, signed coast distance). */
export const EXPLORATION_WADE_REACH = 1.1;
/** River channels and their banks stay water: the body never wades across a river. */
const RIVER_CLEARANCE = 1.5;

export type ExplorationWadeQuery = (x: number, z: number) => boolean;

type WadeLayers = Pick<WorldData, "cellsX" | "cellsZ" | "coastDistance" | "riverDistance" | "waterDepth">;

/** Whether a point is shallow shore water the body may stand in; false without the layers. */
export const createExplorationWadeQuery = (world: WadeLayers): ExplorationWadeQuery => {
  const { coastDistance, riverDistance, waterDepth } = world;
  if (!coastDistance?.length || !riverDistance?.length) return () => false;
  return (x, z) => {
    if (sampleBilinear(world, waterDepth, x, z) > EXPLORATION_MAX_WADE_DEPTH) return false;
    if (sampleBilinear(world, coastDistance, x, z) < -EXPLORATION_WADE_REACH) return false;
    return sampleBilinear(world, riverDistance, x, z) > RIVER_CLEARANCE;
  };
};
