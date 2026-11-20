import { DMath } from "../../../shared/math/deterministic-math";
import { DEFAULT_AUTHORED_ANIMAL_AGE } from "../../../shared/world/authored-animals";
import { getRegionArea, isStandFree } from "../nav/nav-query";
import { ISLAND_ANIMAL_CAP } from "../population/wildlife-regions";
import { sampleHabitat } from "../sim/animal-habitat";
import { findFreeSlot } from "../sim/animal-placement";
import { getSpecies, SPECIES_COUNT } from "../wildlife-species";
import type { AnimalManagerState } from "./animal-manager-state";

export const animalBodyRoom = (state: AnimalManagerState, species: number, x: number, z: number,
  from = 0, skip = -1) => {
  const profile = getSpecies(species), { pool } = state;
  const radius = (Math.max(profile.body.front, profile.body.back) + profile.clearance) *
    (skip >= 0 ? pool.bodyScale[skip]! : 1.2);
  for (let animal = from; animal < pool.active.length; animal++) {
    if (animal === skip || (!pool.active[animal] && !pool.carcass[animal]) ||
      (skip >= 0 && pool.pending[animal] && animal > skip)) continue;
    const other = getSpecies(pool.species[animal]!);
    const otherRadius = (Math.max(other.body.front, other.body.back) + other.clearance) * pool.bodyScale[animal]!;
    if (DMath.hypot(pool.x[animal]! - x, pool.z[animal]! - z) < radius + otherRadius) return false;
  }
  return true;
};

export const authoredAnimalGround = (state: AnimalManagerState, species: number, x: number, z: number,
  age = DEFAULT_AUTHORED_ANIMAL_AGE) => {
  if (!Number.isInteger(species) || species < 0 || species >= SPECIES_COUNT ||
    !Number.isFinite(age) || age < 0 || age > 1 || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  return isStandFree(state.context.nav, species, x, z) &&
    getRegionArea(state.context.nav, species, x, z) >= getSpecies(species).minRegionArea &&
    sampleHabitat(state.field, species, x, z) > 0;
};

/** Undo's departing body can be restored immediately without needing a second pool slot. */
export const authoredAnimalSlot = (state: AnimalManagerState, species: number, x: number, z: number) => {
  const { pool } = state;
  for (let animal = ISLAND_ANIMAL_CAP; animal < pool.active.length; animal++) {
    if (pool.departing[animal] && pool.species[animal] === species &&
      pool.homeX[animal] === Math.fround(x) && pool.homeZ[animal] === Math.fround(z)) return animal;
  }
  return findFreeSlot(pool, ISLAND_ANIMAL_CAP);
};
