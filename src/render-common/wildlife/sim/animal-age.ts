import type { Random } from "../../../shared/world/rng";
import { DAPPLED_VARIANT, getRabbitVariant } from "../model/animal-variants";
import { isBodyFree } from "../nav/nav-query";
import { SPECIES } from "../wildlife-species";
import {
  getAgeSize,
  getLifeStage,
  GROWTH_MINUTES,
  LIFE_STAGE,
  type LifeStage
} from "../wildlife-stages";
import type { AnimalPool } from "./animal-pool";
import type { WildlifeContext } from "./wildlife-context";

/** Real seconds per game minute of growth (configurable: 60 grows a deer in about 22 min). */
const GAME_MINUTE_SECONDS = 60;
/** Respawned animals come back as juveniles and grow up (never as identical adults). */
const RESPAWN_AGE: readonly [number, number] = [0.12, 0.2];
const YOUNG_SHARE = 0.4;

/** Sets the age (0 .. 1) and the body scale that follows from it. */
export const setAnimalAge = (pool: AnimalPool, animal: number, age: number) => {
  const clamped = Math.min(1, Math.max(0, age));
  pool.age[animal] = clamped;
  pool.bodyScale[animal] = pool.size[animal]! * getAgeSize(pool.species[animal]!, clamped);
};

/** Normalised age a species gains per real second (the same pace awake and dormant). */
export const ageGrowthPerSecond = (species: number) =>
  1 / (GROWTH_MINUTES[species]! * GAME_MINUTE_SECONDS);

/**
 * Ages every simulated animal by `seconds` of game time. The body only grows where the larger
 * capsule `fits` (it catches up once the animal steps away).
 */
export const growAnimals = (
  pool: AnimalPool,
  seconds: number,
  fits: (animal: number, scale: number) => boolean
) => {
  for (let animal = 0; animal < pool.active.length; animal += 1) {
    if (!pool.active[animal] || pool.pending[animal] || pool.age[animal]! >= 1) continue;
    const growth = seconds * ageGrowthPerSecond(pool.species[animal]!);
    const previous = pool.bodyScale[animal]!;
    setAnimalAge(pool, animal, pool.age[animal]! + growth);
    if (!fits(animal, pool.bodyScale[animal]!)) pool.bodyScale[animal] = previous;
  }
};

const FIT_HEADINGS = 12;

/** Turns a newly placed animal to a heading its whole body fits in; false when none does. */
export const turnToFit = (context: WildlifeContext, animal: number) => {
  const { nav, pool } = context;
  const start = pool.heading[animal]!;
  for (let step = 0; step < FIT_HEADINGS; step += 1) {
    const heading = Math.fround(start + (step / FIT_HEADINGS) * Math.PI * 2);
    const { bodyScale, species, x, z } = pool;
    if (!isBodyFree(nav, species[animal]!, x[animal]!, z[animal]!, heading, bodyScale[animal]!))
      continue;
    pool.heading[animal] = heading;
    pool.desiredHeading[animal] = heading;
    return true;
  }
  return false;
};

export const getAnimalStage = (pool: AnimalPool, animal: number): LifeStage =>
  getLifeStage(pool.age[animal]!);

/** Mesh variant: the life stage, the dappled coat of some adult deer, the rabbit body type. */
export const getAnimalVariant = (pool: AnimalPool, animal: number) => {
  const stage = getAnimalStage(pool, animal);
  if (pool.species[animal] === SPECIES.rabbit) return getRabbitVariant(pool.form[animal]!, stage);
  const adult = stage >= LIFE_STAGE.adult;
  if (pool.species[animal] === SPECIES.deer && adult && pool.dappled[animal])
    return DAPPLED_VARIANT;
  return stage;
};

/** Males carry antlers from adolescence (the variant mesh holds the antler stage). */
export const getAntlerScale = (pool: AnimalPool, animal: number) =>
  pool.sex[animal] === 1 && getAnimalStage(pool, animal) >= LIFE_STAGE.adolescent ? 1 : 0;

/** Young (newborn or juvenile): follows its mother closely, rests more. */
export const isYoung = (pool: AnimalPool, animal: number) =>
  getAnimalStage(pool, animal) <= LIFE_STAGE.juvenile;

/**
 * Age of a new animal: herd leaders are grown, about 40 % of the others are young (a family),
 * respawns always start as juveniles.
 */
export const pickSpawnAge = (random: Random, leader: boolean, respawn: boolean) => {
  if (respawn) return RESPAWN_AGE[0] + random() * (RESPAWN_AGE[1] - RESPAWN_AGE[0]);
  if (leader) return 0.75 + random() * 0.25;
  if (random() < YOUNG_SHARE) return 0.02 + random() * 0.4;
  return 0.5 + random() * 0.5;
};
