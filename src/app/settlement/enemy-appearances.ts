import { randomWorkerAppearances } from "../../render-common/workers/worker-appearance";
import type { WorkerAppearance, WorkerNation } from "../../render-common/workers/worker-unit";
import { enemyNationFor } from "../../shared/settlement/enemy-nation";
import { createRandom } from "../../shared/world/rng";

/** Bodies the enemy army cycles through (every body of its nation, women and men mixed). */
const ENEMY_BODIES = 12;

/**
 * The enemy army's bodies on an island against a player of `playerNation`: the island's enemy
 * nation (enemy-nation.ts), its bodies in a fixed order for the island.
 */
export const createEnemyAppearances = (islandSeed: number) =>
  (playerNation: WorkerNation): readonly WorkerAppearance[] =>
    randomWorkerAppearances(ENEMY_BODIES, enemyNationFor(playerNation, islandSeed), createRandom(islandSeed));
