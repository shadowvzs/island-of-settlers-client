import type { AnimalPool } from "./animal-pool";

export const ANIMAL_APPEAR_INTERVAL = 0.4;
const ANIMAL_FADE_SECONDS = 1.2;

/** Removal immediately releases gameplay ownership while retaining the body for a short visual fade. */
export const startAnimalDeparture = (pool: AnimalPool, animal: number) => {
  pool.active[animal] = 0;
  pool.departing[animal] = pool.pending[animal] || pool.appear[animal]! <= 0 ? 0 : 1;
  pool.pending[animal] = 0;
  pool.speed[animal] = 0;
  pool.velocityX[animal] = pool.velocityZ[animal] = 0;
};

export const stepAnimalAppearance = (pool: AnimalPool, animal: number, dt: number) => {
  if (pool.pending[animal] || pool.carcass[animal]) return;
  if (pool.departing[animal]) {
    pool.appear[animal] = Math.max(0, pool.appear[animal]! - dt / ANIMAL_FADE_SECONDS);
    if (pool.appear[animal]! <= 0) pool.departing[animal] = 0;
    return;
  }
  if (pool.active[animal])
    pool.appear[animal] = Math.min(1, pool.appear[animal]! + dt / ANIMAL_FADE_SECONDS);
};
