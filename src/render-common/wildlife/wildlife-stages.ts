import { entriesOfKind } from "@shared/catalog";

import { SPECIES } from "./wildlife-species";

/** Life stages (ageNormalized ranges in AGE_RANGES); mature only changes the elk's rack. */
export const LIFE_STAGE = { newborn: 0, juvenile: 1, adolescent: 2, adult: 3, mature: 4 } as const;
export type LifeStage = (typeof LIFE_STAGE)[keyof typeof LIFE_STAGE];
export const LIFE_STAGE_NAMES = ["newborn", "juvenile", "adolescent", "adult", "mature"] as const;

/** Where each stage starts on the normalised age (0 birth .. 1 fully grown). */
const STAGE_STARTS = [0, 0.12, 0.4, 0.7, 0.92] as const;

/** Antler development: none, buttons / spikes, small branching, the full rack. */
export const ANTLER_STAGE = { none: 0, spikes: 1, branching: 2, full: 3 } as const;

/**
 * Body proportions of a stage relative to the adult model: structural, never one uniform
 * scale. Leg length and head / ear size are relative to the body (a fawn is mostly legs, ears
 * and eyes), `size` is the overall height relative to the adult.
 */
export interface StageShape {
  antlers: number;
  /** Torso scale (length, depth, width). */
  body: readonly [number, number, number];
  ears: number;
  /** Head scale (length, height, width): a short face and a big cranium when young. */
  head: readonly [number, number, number];
  legs: number;
  neckLength: number;
  neckThickness: number;
  size: number;
  /** 0 .. 1 visibility of the white coat spots. */
  spots: number;
  /** 0 .. 1 warmer, redder juvenile coat (rabbits: softer, mottled young coat). */
  warmth: number;
}

const ADULT: StageShape = {
  antlers: ANTLER_STAGE.full,
  body: [1, 1, 1],
  ears: 1,
  head: [1, 1, 1],
  legs: 1,
  neckLength: 1,
  neckThickness: 1,
  size: 1,
  spots: 0,
  warmth: 0
};

const DEER_STAGES: StageShape[] = [
  {
    ...ADULT,
    antlers: ANTLER_STAGE.none,
    body: [0.88, 0.9, 0.84],
    ears: 1.38,
    head: [0.9, 1.2, 1.16],
    legs: 1.2,
    neckLength: 0.92,
    neckThickness: 0.78,
    size: 0.44,
    spots: 1,
    warmth: 1
  },
  {
    ...ADULT,
    antlers: ANTLER_STAGE.none,
    body: [0.92, 0.93, 0.88],
    ears: 1.24,
    head: [0.94, 1.12, 1.1],
    legs: 1.13,
    neckLength: 0.96,
    neckThickness: 0.84,
    size: 0.6,
    spots: 0.8,
    warmth: 0.8
  },
  {
    ...ADULT,
    antlers: ANTLER_STAGE.spikes,
    body: [0.97, 0.97, 0.94],
    ears: 1.08,
    head: [0.98, 1.04, 1.03],
    legs: 1.04,
    neckLength: 1,
    neckThickness: 0.93,
    size: 0.82,
    spots: 0.3,
    warmth: 0.35
  },
  ADULT,
  ADULT
];

const ELK_STAGES: StageShape[] = [
  {
    ...ADULT,
    antlers: ANTLER_STAGE.none,
    body: [0.86, 0.86, 0.8],
    ears: 1.42,
    head: [0.84, 1.15, 1.1],
    legs: 1.24,
    neckLength: 0.88,
    neckThickness: 0.7,
    size: 0.4,
    spots: 0.35,
    warmth: 0.9
  },
  {
    ...ADULT,
    antlers: ANTLER_STAGE.none,
    body: [0.9, 0.9, 0.86],
    ears: 1.25,
    head: [0.9, 1.08, 1.06],
    legs: 1.15,
    neckLength: 0.92,
    neckThickness: 0.78,
    size: 0.56,
    spots: 0.15,
    warmth: 0.6
  },
  {
    ...ADULT,
    antlers: ANTLER_STAGE.spikes,
    body: [0.95, 0.95, 0.92],
    ears: 1.1,
    head: [0.96, 1.03, 1.02],
    legs: 1.06,
    neckLength: 0.97,
    neckThickness: 0.88,
    size: 0.78,
    spots: 0,
    warmth: 0.2
  },
  { ...ADULT, antlers: ANTLER_STAGE.branching, size: 0.93 },
  ADULT
];

const RABBIT_STAGES: StageShape[] = [
  {
    ...ADULT,
    antlers: ANTLER_STAGE.none,
    body: [0.9, 1.02, 1.08],
    ears: 0.72,
    head: [1.18, 1.18, 1.18],
    legs: 0.82,
    neckLength: 0.9,
    neckThickness: 1,
    size: 0.45,
    warmth: 1
  },
  {
    ...ADULT,
    antlers: ANTLER_STAGE.none,
    body: [0.95, 1.01, 1.04],
    ears: 0.85,
    head: [1.08, 1.08, 1.08],
    legs: 0.9,
    size: 0.66,
    warmth: 0.6
  },
  { ...ADULT, size: 0.86, warmth: 0.25 },
  ADULT,
  ADULT
];

export const STAGE_SHAPES: Record<number, StageShape[]> = {
  [SPECIES.rabbit]: RABBIT_STAGES,
  [SPECIES.deer]: DEER_STAGES,
  [SPECIES.elk]: ELK_STAGES
};

/** Top speed share by stage (frightened young still try to flee, just slower). */
const SPEED_BY_STAGE = [0.42, 0.68, 0.86, 1, 1] as const;
/** Meat yield share by stage: no incentive to hunt the young. */
const YIELD_BY_STAGE = [0, 0.2, 0.55, 1, 1] as const;
/** Meat of an adult (units), by species code (the catalog's `animal:*` `life.adultMeat`). */
const ADULT_MEAT: Record<number, number> = Object.fromEntries(entriesOfKind("animal")
  .map(entry => [entry.code, entry.life.adultMeat!]));

/** Growth from birth to adult (game minutes, the owner's ranges' middle; the catalog's `life.growthMinutes`). */
export const GROWTH_MINUTES: Record<number, number> = Object.fromEntries(entriesOfKind("animal")
  .map(entry => [entry.code, entry.life.growthMinutes!]));

export const getLifeStage = (age: number): LifeStage => {
  for (let stage = STAGE_STARTS.length - 1; stage > 0; stage -= 1) {
    if (age >= STAGE_STARTS[stage]!) return stage as LifeStage;
  }
  return LIFE_STAGE.newborn;
};

/** The age a stage starts at (setLifeStage). */
export const getStageAge = (stage: LifeStage) => STAGE_STARTS[stage]!;

/** Continuous value of a per stage table at an age (eases between stage starts). */
const interpolate = (values: readonly number[], age: number) => {
  const stage = getLifeStage(age);
  if (stage === LIFE_STAGE.mature) return values[stage]!;
  const from = STAGE_STARTS[stage]!;
  const to = STAGE_STARTS[stage + 1]!;
  const t = Math.min(1, Math.max(0, (age - from) / (to - from)));
  return values[stage]! + (values[stage + 1]! - values[stage]!) * t;
};

/** Overall size relative to the adult, continuous with age. */
const STAGE_SIZES: Record<number, number[]> = Object.fromEntries(
  Object.entries(STAGE_SHAPES).map(([species, shapes]) => [
    species,
    shapes.map((shape) => shape.size)
  ])
);

export const getAgeSize = (species: number, age: number) => interpolate(STAGE_SIZES[species]!, age);

export const getAgeSpeed = (age: number) => interpolate(SPEED_BY_STAGE, age);

/** Hunters protect young wildlife: only adult and mature animals are prey. */
export const getHuntValue = (species: number, age: number) => {
  const stage = getLifeStage(age);
  return {
    isHuntable: stage >= LIFE_STAGE.adult,
    meatYield: ADULT_MEAT[species]! * YIELD_BY_STAGE[stage]!
  };
};
