import { displayFogAt } from "../../shared/world/fog-display";
import { sampleBilinear, sampleSmooth } from "../../shared/world/grid-geometry";
import { FOG, type WorldData } from "../../shared/world/world-data";

/**
 * What the fish read of the water (no allocation per call): the drawn seabed (the smooth ground
 * surface), the water surface and their difference, and the fog of war of a point.
 */
export interface FishWater {
  /** Water above the drawn seabed (negative on land). */
  depth: (x: number, z: number) => number;
  /** 1 visible, 0.5 explored, 0 hidden. */
  fog: (x: number, z: number) => number;
  ground: (x: number, z: number) => number;
  surface: (x: number, z: number) => number;
  world: WorldData;
}

const FOG_VISIBILITY: Record<number, number> = { [FOG.hidden]: 0, [FOG.discovered]: 0.5, [FOG.visible]: 1 };

export const createFishWater = (world: WorldData): FishWater => {
  const ground = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  const surface = (x: number, z: number) => sampleBilinear(world, world.waterSurface, x, z);
  return {
    depth: (x, z) => surface(x, z) - ground(x, z),
    fog: (x, z) => {
      const cellX = Math.min(world.cellsX - 1, Math.max(0, Math.floor(x)));
      const cellZ = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(z)));
      return FOG_VISIBILITY[displayFogAt(world, cellZ * world.cellsX + cellX)] ?? 0;
    },
    ground,
    surface,
    world
  };
};
