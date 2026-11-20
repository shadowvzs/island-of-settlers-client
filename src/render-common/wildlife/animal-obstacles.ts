import type { AddObstacle, ObstacleSource } from "../crowd/crowd-space";
import type { AnimalPool } from "./sim/animal-pool";
import { getSpecies, SPECIES } from "./wildlife-species";

/** Margin around the capsule radius (cells): others keep a little room from the animals. */
const ANIMAL_MARGIN = 0.08;

/** Deer and elk (rabbits slip between a worker's feet). */
const isBigAnimal = (species: number) => species === SPECIES.deer || species === SPECIES.elk;

/** One animal as two circles along its heading: chest and hindquarters cover the long body. */
const addAnimal = (pool: AnimalPool, animal: number, add: AddObstacle) => {
  const profile = getSpecies(pool.species[animal]!);
  const scale = pool.bodyScale[animal]!;
  const radius = (profile.clearance + ANIMAL_MARGIN) * scale;
  const cos = Math.cos(pool.heading[animal]!);
  const sin = Math.sin(pool.heading[animal]!);
  const front = profile.body.front * 0.5 * scale;
  const back = profile.body.back * 0.5 * scale;
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  add(x + cos * front, z + sin * front, radius);
  add(x - cos * back, z - sin * back, radius);
};

/**
 * The living animals of the pool as moving obstacles of others (workers walk around the big
 * ones only; critters around every animal).
 */
export const createAnimalObstacles =
  (pool: AnimalPool, bigOnly: boolean): ObstacleSource =>
  (add) => {
    for (let animal = 0; animal < pool.active.length; animal++) {
      if (pool.active[animal] !== 1 || pool.pending[animal]) continue;
      if (bigOnly && !isBigAnimal(pool.species[animal]!)) continue;
      addAnimal(pool, animal, add);
    }
  };
