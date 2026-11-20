import type { CritterManager } from "../render-common/critters/critter-manager";
import { combineObstacles, type ObstacleSource } from "../render-common/crowd/crowd-space";
import type { AnimalManager } from "../render-common/wildlife/animal-manager";
import { createAnimalObstacles } from "../render-common/wildlife/animal-obstacles";
import { WORKER_COLLISION_RADIUS } from "../render-common/workers/worker-dimensions";
import type { WorkerGroup } from "../render-common/workers/worker-group";

/** The workers as moving obstacles of the critters. */
const createWorkerObstacles =
  (workers: WorkerGroup): ObstacleSource =>
  (add) => {
    for (const frame of workers.frames)
      if (frame.visible !== false) add(frame.x, frame.z, WORKER_COLLISION_RADIUS);
  };

/**
 * Who keeps apart from whom: workers walk around the big animals and the ground critters,
 * critters around the workers and every animal. The animals (simulation) only keep apart from
 * each other and the navigation: decoration never moves gameplay state.
 */
export const connectWildlifeCollision = (
  workers: WorkerGroup,
  animals: AnimalManager,
  critters: CritterManager
) => {
  const workerBodies = createWorkerObstacles(workers);
  const { pool } = animals.debug;
  workers.setObstacles(combineObstacles(createAnimalObstacles(pool, true), critters.obstacles));
  critters.setObstacles(combineObstacles(workerBodies, createAnimalObstacles(pool, false)));
};
