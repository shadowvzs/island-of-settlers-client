import { displayFogVisibilityAt } from "../../shared/world/fog-display";
import { sampleBilinear } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** What the whales read of the island: sea depth, the water surface and the fog of war. */
export interface WhaleWater {
  depth: (x: number, z: number) => number;
  /** 1 visible, 0.5 explored, 0 hidden. */
  fog: (x: number, z: number) => number;
  /** Inside the map with a margin (the open sea beyond the edge is not drawn as water). */
  inside: (x: number, z: number) => boolean;
  /** Water surface height (also the ripples' `water`). */
  water: (x: number, z: number) => number;
}

const EDGE_MARGIN = 6;

export const createWhaleWater = (world: WorldData): WhaleWater => ({
  depth: (x, z) => Math.max(0, sampleBilinear(world, world.waterDepth, x, z)),
  fog: (x, z) => displayFogVisibilityAt(world, x, z),
  inside: (x, z) =>
    x > EDGE_MARGIN && z > EDGE_MARGIN && x < world.cellsX - EDGE_MARGIN && z < world.cellsZ - EDGE_MARGIN,
  water: (x, z) => sampleBilinear(world, world.waterSurface, x, z)
});
