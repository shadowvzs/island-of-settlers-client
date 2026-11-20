import { NATIONS } from "../../../../island-of-settlers-shared/src/nations";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createRandom } from "../world/rng";

/** Mixed into the island seed so the choice does not follow the island's other first draws. */
const ENEMY_NATION_SALT = 0x5eed_e17e;

/**
 * The nation of the computer army on an island (raiders, colony counterattacks,
 * adventure camps): always another nation than the player's, the same for every visit to the
 * island (derived from its world seed, so nothing is saved and old saves keep their islands).
 * Its soldiers wear that nation's bodies, armour and weapons, with the enemy red livery.
 * Reads the shared nation list, not the worker roster, so the simulation and server bundles stay free of
 * `@workers`; `tests/enemy-nation.test.ts` pins that every nation has roster bodies.
 */
export const enemyNationFor = (playerNation: WorkerNation, islandSeed: number): WorkerNation => {
  const others = NATIONS.filter(nation => nation !== playerNation);
  const draw = createRandom((islandSeed ^ ENEMY_NATION_SALT) >>> 0)();
  return others[Math.floor(draw * others.length)]!;
};
