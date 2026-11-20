import type { AnimalManager } from "../../src/render-common/wildlife/animal-manager";
import type { WorldData } from "../../src/shared/world/world-data";

/**
 * Wakes every wildlife region of the island the way a hunter's scan does (a simulation event):
 * tests that watch the full brain and locomotion run on simulated animals.
 */
export const wakeAllRegions = (manager: AnimalManager, world: WorldData) => {
  const centre = { x: world.cellsX / 2, z: world.cellsZ / 2 };
  return manager.listHuntTargets("wildlife", centre, Math.hypot(world.cellsX, world.cellsZ));
};
