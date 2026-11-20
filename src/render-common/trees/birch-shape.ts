import { lerp3 } from "../../shared/world/noise";
import { encodeTreeForm, getFormArchetype } from "../../shared/world/tree-forms";
import type { Vec3 } from "../props/mesh-builder";
import type { TreeVariant } from "./conifer-variants";
import type { BarkLook, GrowthStage } from "./tree-model";

/**
 * Silver birch (Betula pendula) structures (../resources/tree_prompt_pack/BIRCH_BRIEF.md): A young single
 * trunk, B multi-trunk, C classic mature, D weeping, E old rugged; same order as BIRCH in
 * shared/world/tree-forms.ts. The world picks one per tree (prop form byte); the growth stages
 * build it up.
 */
export const BIRCH_FORMS = ["young", "multiStem", "classic", "weeping", "old"] as const;
export type BirchForm = (typeof BIRCH_FORMS)[number];

/** Canopy density: LOW airy spring, MEDIUM, HIGH summer (still more open than an oak). */
const BIRCH_DENSITIES = ["low", "medium", "high"] as const;
export type BirchDensity = (typeof BIRCH_DENSITIES)[number];

/** Size and hierarchy per growth stage (metres): every stage grows a new skeleton. */
export interface BirchSize {
  /** Fraction of the height where the lowest primaries leave the trunk. */
  crownBase: number;
  /** Half width of the crown (longest primaries reach about this far). */
  crownRadius: number;
  /** 1: primaries carry twigs, 2: primaries, secondaries, twigs. */
  depth: number;
  height: number;
  primaries: number;
  /** Leaf card size (owner: leaves 1.5x larger, saplings 1.25x). */
  spraySize: number;
  trunkRadius: number;
  /** Typical fine twig length unit (twigs are 1.3-2.4 of it). */
  twigSize: number;
  /** Bark whitening 0 (reddish brown sapling bark) .. 1 (mature white bark). */
  whiteness: number;
}

export const BIRCH_SIZES: Record<GrowthStage, BirchSize> = {
  1: {
    crownBase: 0.28,
    crownRadius: 0.3,
    depth: 1,
    height: 1.5,
    primaries: 8,
    spraySize: 0.29,
    twigSize: 0.2,
    trunkRadius: 0.017,
    whiteness: 0.1
  },
  2: {
    crownBase: 0.3,
    crownRadius: 0.62,
    depth: 1,
    height: 3.2,
    primaries: 10,
    spraySize: 0.4,
    twigSize: 0.28,
    trunkRadius: 0.042,
    whiteness: 0.45
  },
  3: {
    crownBase: 0.33,
    crownRadius: 1.05,
    depth: 2,
    height: 5.3,
    primaries: 9,
    spraySize: 0.555,
    twigSize: 0.37,
    trunkRadius: 0.085,
    whiteness: 0.8
  },
  4: {
    crownBase: 0.36,
    crownRadius: 1.85,
    depth: 2,
    height: 7.5,
    primaries: 11,
    spraySize: 0.66,
    twigSize: 0.44,
    trunkRadius: 0.13,
    whiteness: 0.95
  },
  5: {
    crownBase: 0.38,
    crownRadius: 2.4,
    depth: 2,
    height: 9.2,
    primaries: 13,
    spraySize: 0.75,
    twigSize: 0.5,
    trunkRadius: 0.185,
    whiteness: 1
  }
};

/** Architecture of a structure (multipliers on the stage size). */
export interface BirchArchitecture {
  /** Downward pull along the outer half of a primary (arching, weeping limbs). */
  arch: number;
  /** Crown asymmetry: primaries on one side are this much longer. */
  asymmetry: number;
  /** Primary angle from the trunk at the bottom of the crown (radians). */
  branchAngle: number;
  /** One lower primary broken off (old trees). */
  brokenBranch: boolean;
  crownWidth: number;
  /** Horizontal trunk displacement (share of the height). */
  curvature: number;
  /** Share of the leaf clusters kept. */
  foliage: number;
  /** Share of the twigs that hang down as long curtains (weeping). */
  hanging: number;
  /** Height multiplier. */
  height: number;
  /** Primary count multiplier. */
  primaries: number;
  /** Rough, darker lower bark reach (share of the trunk) and its darkness. */
  roughBase: number;
  /** Stems from the root zone: [min, max]. */
  stems: [number, number];
  /** Trunk and primary radius multiplier. */
  thickness: number;
}

export const BIRCH_ARCHITECTURE: Record<BirchForm, BirchArchitecture> = {
  young: {
    arch: 0.01,
    asymmetry: 0.1,
    branchAngle: 0.62,
    brokenBranch: false,
    crownWidth: 0.62,
    curvature: 0.025,
    foliage: 0.7,
    hanging: 0.05,
    height: 0.92,
    primaries: 0.8,
    roughBase: 0.12,
    stems: [1, 1],
    thickness: 0.78
  },
  multiStem: {
    arch: 0.03,
    asymmetry: 0.15,
    branchAngle: 0.78,
    brokenBranch: false,
    crownWidth: 0.72,
    curvature: 0.04,
    foliage: 0.85,
    hanging: 0.15,
    height: 0.94,
    primaries: 0.7,
    roughBase: 0.2,
    stems: [2, 4],
    thickness: 0.72
  },
  classic: {
    arch: 0.06,
    asymmetry: 0.18,
    branchAngle: 0.88,
    brokenBranch: false,
    crownWidth: 1,
    curvature: 0.045,
    foliage: 1,
    hanging: 0.35,
    height: 1,
    primaries: 1,
    roughBase: 0.22,
    stems: [1, 1],
    thickness: 1
  },
  weeping: {
    arch: 0.13,
    asymmetry: 0.15,
    branchAngle: 0.95,
    brokenBranch: false,
    crownWidth: 0.95,
    curvature: 0.04,
    foliage: 1,
    hanging: 0.9,
    height: 1.03,
    primaries: 1,
    roughBase: 0.25,
    stems: [1, 1],
    thickness: 1.02
  },
  old: {
    arch: 0.07,
    asymmetry: 0.4,
    branchAngle: 1.02,
    brokenBranch: true,
    crownWidth: 1.08,
    curvature: 0.075,
    foliage: 0.8,
    hanging: 0.45,
    height: 0.95,
    primaries: 0.85,
    roughBase: 0.45,
    stems: [1, 1],
    thickness: 1.35
  }
};

export const BIRCH_DENSITY: Record<BirchDensity, number> = { high: 1.3, low: 0.6, medium: 1 };

/** Structure of a form byte (archetype nibble = BIRCH index, shared/world/tree-forms.ts). */
export const getBirchArchitecture = (form: number) =>
  BIRCH_ARCHITECTURE[BIRCH_FORMS[getFormArchetype(form)] ?? "classic"];

/** Island meshes of the birch kind: every structure young (3), established (4) and mature (5). */
export const BIRCH_VARIANTS: TreeVariant[] = BIRCH_FORMS.flatMap((_, form) =>
  ([3, 4, 5] as GrowthStage[]).map((stage) => ({ form: encodeTreeForm(form, 0), stage }))
);

type Rgb = Vec3;

/** Never pure white: warm white / cream bark, greyer and browner towards the rough base. */
const BARK_WHITE: Rgb = [0.87, 0.85, 0.79];
const BARK_BASE: Rgb = [0.42, 0.39, 0.35];
/** Reddish brown sapling bark (before it whitens). */
const BARK_SAPLING: Rgb = [0.42, 0.28, 0.22];
/** Branch gradient: large branch light grey-white, medium grey, fine twig charcoal brown. */
const BRANCH_TONES: Rgb[] = [BARK_WHITE, [0.66, 0.64, 0.6], [0.4, 0.36, 0.32], [0.24, 0.19, 0.16]];


/**
 * Wood colour of a birch: trunk white with a darker rough base, primaries pale near the trunk and
 * greyer outwards, twigs dark brown. depth 0 trunk .. 3 twig; along 0 base .. 1 tip of the limb;
 * height 0..1 of the tree (trunk only).
 */
export const getBirchWoodTone = (bark: BarkLook, depth: number, along: number, height: number) => {
  const white = lerp3(BARK_SAPLING, BARK_WHITE, bark.whiteness);
  if (depth === 0) {
    const base = 1 - Math.min(1, Math.max(0, height / Math.max(bark.roughBase, 0.01)));
    return lerp3(white, BARK_BASE, base * base * (0.55 + bark.roughBase));
  }
  const level = Math.min(BRANCH_TONES.length - 1, depth - 1 + along * 1.4);
  const lower = Math.floor(level);
  const upper = Math.min(BRANCH_TONES.length - 1, lower + 1);
  const tone = lerp3(BRANCH_TONES[lower]!, BRANCH_TONES[upper]!, level - lower);
  return lerp3(lerp3(BARK_SAPLING, tone, bark.whiteness), BRANCH_TONES[3]!, depth >= 3 ? 0.4 : 0);
};
