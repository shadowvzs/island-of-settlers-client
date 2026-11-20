import { createRandom, pickWeighted } from "../../../shared/world/rng";
import type { Vec3 } from "../../props/mesh-builder";

/** Coat archetypes of the wild population (index order of every coat table). */
export const RABBIT_COAT = {
  agouti: 0,
  chestnut: 1,
  tan: 2,
  white: 3,
  whitePatched: 4,
  charcoal: 5
} as const;
export const RABBIT_COAT_COUNT = 6;

/** Population share of each archetype (owner brief: 45 / 20 / 12 / 5 / 10 / 8 %). */
export const RABBIT_COAT_SHARES = [0.45, 0.2, 0.12, 0.05, 0.1, 0.08] as const;

/** Colours of an archetype: sides (base), belly, ear rims and tips, patches (mixed coats). */
export interface CoatPalette {
  base: Vec3;
  belly: Vec3;
  ear: Vec3;
  patch: Vec3;
}

const WHITE: CoatPalette = {
  base: [0.92, 0.9, 0.85],
  belly: [0.95, 0.93, 0.88],
  ear: [0.8, 0.78, 0.75],
  patch: [0.43, 0.29, 0.18]
};

/** White coats never flat pure white: ivory highlights, cream midtones, grey-beige contact. */
export const COAT_PALETTES: readonly CoatPalette[] = [
  {
    base: [0.47, 0.38, 0.29],
    belly: [0.85, 0.82, 0.76],
    ear: [0.13, 0.11, 0.1],
    patch: [0.36, 0.31, 0.26]
  },
  {
    base: [0.5, 0.32, 0.2],
    belly: [0.85, 0.74, 0.6],
    ear: [0.3, 0.17, 0.1],
    patch: [0.38, 0.23, 0.14]
  },
  {
    base: [0.78, 0.66, 0.5],
    belly: [0.93, 0.88, 0.78],
    ear: [0.6, 0.47, 0.35],
    patch: [0.62, 0.5, 0.36]
  },
  WHITE,
  WHITE,
  {
    base: [0.25, 0.22, 0.2],
    belly: [0.5, 0.45, 0.4],
    ear: [0.1, 0.09, 0.08],
    patch: [0.17, 0.15, 0.14]
  }
];

/**
 * Patch masks of the mixed coat (rest pose space of the adult rabbit, left side z > 0): up to
 * four blobs each (centre xyz, radius). Every pattern is one sided or uneven, and an individual
 * may wear it on its right side instead: never mirrored, never symmetric.
 */
export const PATCH_BLOBS: readonly (readonly [number, number, number, number])[][] = [
  [
    [0.17, 0.17, 0.03, 0.04],
    [0.12, 0.13, 0.05, 0.04],
    [0.15, 0.2, 0.02, 0.03]
  ],
  [
    [0.17, 0.17, 0.03, 0.04],
    [0.17, 0.17, -0.03, 0.035],
    [0.2, 0.13, 0.03, 0.025]
  ],
  [
    [-0.02, 0.15, 0.06, 0.07],
    [0.04, 0.14, 0.06, 0.045]
  ],
  [
    [0.05, 0.2, 0.01, 0.03],
    [0, 0.21, -0.01, 0.028],
    [-0.05, 0.2, 0.015, 0.03],
    [-0.09, 0.17, -0.01, 0.025]
  ],
  [
    [-0.1, 0.15, 0.03, 0.07],
    [-0.05, 0.19, 0.04, 0.04]
  ],
  [
    [0.12, 0.16, 0.04, 0.02],
    [-0.04, 0.18, -0.06, 0.022],
    [0.16, 0.2, -0.03, 0.022]
  ]
];
const PATCH_PATTERN_COUNT = PATCH_BLOBS.length;
export const PATCH_BLOB_LIMIT = 4;

/** Coat of one rabbit (its appearance record; the GPU gets it as one vec4). */
export interface RabbitAppearance {
  archetype: number;
  /** 0 lean / wild, 1 compact. */
  bodyType: number;
  /** 0.55 .. 1 how dark the ear rims and tips are. */
  earDarkness: number;
  /** Ear angle offsets (radians, + back): asymmetric, one ear a little lower. */
  earLeft: number;
  earRight: number;
  /** -1 for none, else PATCH_BLOBS index (mixed coats only). */
  patchPattern: number;
  /** 0 .. 1: which side the pattern sits on and its small offsets. */
  patchSeed: number;
}

/** Archetype shares shifted by the place: meadows favour tan, chestnut, agouti; forest dark. */
const getCoatWeights = (forest: number) => {
  const f = Math.min(1, Math.max(0, forest));
  const shares = RABBIT_COAT_SHARES;
  return [
    shares[0] * (1 + f * 0.15),
    shares[1] * (1.15 - f * 0.25),
    shares[2] * (1.35 - f * 0.7),
    shares[3] * (0.9 - f * 0.4),
    shares[4],
    shares[5] * (0.7 + f * 0.9)
  ];
};

/**
 * Deterministic appearance: the same seed always gives the same coat, patches, body type and
 * ears (the individual stays recognisable).
 */
export const createRabbitAppearance = (seed: number, forest = 0.3): RabbitAppearance => {
  const random = createRandom(seed);
  const archetype = Math.max(0, pickWeighted(getCoatWeights(forest), random));
  const patched = archetype === RABBIT_COAT.whitePatched;
  const lower = random() < 0.5 ? 1 : -1;
  const droop = 0.05 + random() * 0.2;
  return {
    archetype,
    bodyType: random() < 0.55 ? 0 : 1,
    earDarkness: 0.55 + random() * 0.45,
    earLeft: (random() - 0.5) * 0.18 + (lower > 0 ? droop : 0),
    earRight: (random() - 0.5) * 0.18 + (lower < 0 ? droop : 0),
    patchPattern: patched ? Math.floor(random() * PATCH_PATTERN_COUNT) : -1,
    patchSeed: random()
  };
};
