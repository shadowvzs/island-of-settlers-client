import { ANIMAL_STATE, ANIMAL_STATE_NAMES, SPECIES_PROFILES } from "../wildlife-species";
import { getHuntValue, getLifeStage, LIFE_STAGE, LIFE_STAGE_NAMES, type LifeStage } from "../wildlife-stages";
import { getAnimalStage } from "./animal-age";
import type { AnimalPool } from "./animal-pool";

/** What a future hunter (or the UI) reads about one animal. */
export interface AnimalInfo {
  ageNormalized: number;
  health: number;
  id: number;
  isFleeing: boolean;
  isHuntable: boolean;
  isResting: boolean;
  /** Simulation seconds of the last threat, -1 never. */
  lastThreatTime: number;
  lifeStage: (typeof LIFE_STAGE_NAMES)[LifeStage];
  meatYield: number;
  position: { x: number; y: number; z: number };
  sex: "female" | "male";
  species: string;
  state: (typeof ANIMAL_STATE_NAMES)[number];
  velocity: { x: number; z: number };
}

/** Allocation-free eligibility check for frequent hunter searches. */
export const isHuntableAnimal = (pool: AnimalPool, id: number) =>
  pool.active[id] === 1 && pool.pending[id] === 0 && getLifeStage(pool.age[id]!) >= LIFE_STAGE.adult;

/** Snapshot of an animal (allocates: on demand, not per frame); null for an empty slot. */
export const getAnimalInfo = (pool: AnimalPool, id: number): AnimalInfo | null => {
  if (id < 0 || id >= pool.active.length || !pool.active[id]) return null;
  const species = pool.species[id]!;
  const age = pool.age[id]!;
  const state = pool.state[id]!;
  const value = getHuntValue(species, age);
  return {
    ageNormalized: age,
    health: pool.health[id]!,
    id,
    isFleeing: state === ANIMAL_STATE.flee,
    isHuntable: value.isHuntable && pool.pending[id] === 0,
    isResting: state === ANIMAL_STATE.rest,
    lastThreatTime: pool.lastThreatTime[id]!,
    lifeStage: LIFE_STAGE_NAMES[getAnimalStage(pool, id)],
    meatYield: value.meatYield,
    position: { x: pool.x[id]!, y: pool.y[id]!, z: pool.z[id]! },
    sex: pool.sex[id] === 1 ? "male" : "female",
    species: SPECIES_PROFILES[species]!.name,
    state: ANIMAL_STATE_NAMES[state]!,
    velocity: { x: pool.velocityX[id]!, z: pool.velocityZ[id]! }
  };
};
