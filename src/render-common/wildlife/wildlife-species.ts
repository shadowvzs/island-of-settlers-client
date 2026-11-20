import type { TuningRange, WildlifeGait, WildlifeProfileTuning } from "@shared/catalog";
import { WILDLIFE_PROFILE_TUNING } from "@shared/catalog/tuning/wildlife";

import { DMath } from "../../shared/math/deterministic-math";
/** Wandering land animals. The id is the index into every per species table. */
export const SPECIES = { rabbit: 0, deer: 1, elk: 2 } as const;
export type SpeciesId = (typeof SPECIES)[keyof typeof SPECIES];
export const SPECIES_COUNT = 3;
export const SPECIES_IDS: readonly SpeciesId[] = [SPECIES.rabbit, SPECIES.deer, SPECIES.elk];

/** Behaviour states of the shared state machine (turning and avoiding live in the steering). */
export const ANIMAL_STATE = {
  idle: 0,
  look: 1,
  graze: 2,
  walk: 3,
  trot: 4,
  flee: 5,
  alert: 6,
  recover: 7,
  rest: 8
} as const;
export type AnimalState = (typeof ANIMAL_STATE)[keyof typeof ANIMAL_STATE];
export const ANIMAL_STATE_NAMES = [
  "idle",
  "look",
  "graze",
  "walk",
  "trot",
  "flee",
  "alert",
  "recover",
  "rest"
] as const;

/** Seconds range [min, max] of a timed state; durations are drawn skewed towards the minimum. */
export type Range = TuningRange;
/** Locomotion of one gait (catalog `WildlifeGait`): the stride is the distance one full cycle covers. */
export type Gait = WildlifeGait;

/**
 * Runtime behaviour profile: the catalog tuning (`tuning/wildlife-profiles.json`) with the slope as rise per
 * unit, an unlimited forest depth as Infinity and the species key as name.
 */
export interface SpeciesProfile extends Omit<WildlifeProfileTuning, "maxForestDepth" | "maxSlopeDegrees"> {
  /** How deep into a forest (world units from its edge) it goes; Infinity: anywhere it fits. */
  maxForestDepth: number;
  /** Largest traversable slope (rise per unit, tan of the angle). */
  maxSlope: number;
  name: string;
}

const toSpeciesProfile = (name: string): SpeciesProfile => {
  const { maxForestDepth, maxSlopeDegrees, ...tuning } = WILDLIFE_PROFILE_TUNING[name]!;
  return {
    ...tuning,
    maxForestDepth: maxForestDepth ?? Infinity,
    maxSlope: DMath.tan((maxSlopeDegrees * Math.PI) / 180),
    name
  };
};

/**
 * Profiles by species id, loaded synchronously at module init (the simulation and the verifier need them
 * deterministically before the first tick). World scale: one cell is about two metres (a worker is 0.85 units
 * tall, a mature oak 2.5 to 3 cells); a rabbit is about 0.2 tall, a deer 0.5 at the shoulder, an elk 0.72.
 */
export const SPECIES_PROFILES: readonly SpeciesProfile[] = Object.keys(SPECIES).map(toSpeciesProfile);

export const getSpecies = (species: number) => SPECIES_PROFILES[species]!;
