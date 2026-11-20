import { startDeathClock, stepDeathClock } from "../../helpers";
import type { AnimalPool } from "./animal-pool";

/**
 * A killed animal leaves the living (no AI, collider or herd) and becomes a carcass: it falls,
 * lies still, then sinks and fades out (helpers.ts DEATH_TIMING).
 */
export const startCarcass = (pool: AnimalPool, animal: number) => {
  pool.active[animal] = 0;
  pool.health[animal] = 0;
  pool.speed[animal] = 0;
  startDeathClock(pool, animal);
};

/** Advances every carcass by `dt` seconds; the faded ones despawn. */
export const stepCarcasses = (pool: AnimalPool, dt: number) => {
  for (let animal = 0; animal < pool.carcass.length; animal += 1) {
    if (pool.carcass[animal]) stepDeathClock(pool, animal, dt);
  }
};
