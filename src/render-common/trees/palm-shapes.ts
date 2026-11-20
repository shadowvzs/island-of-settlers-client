import { COMPETITION, encodeTreeForm, getFormArchetype, PALM } from "../../shared/world/tree-forms";
import type { Vec3 } from "../props/mesh-builder";
import { BARK_FAMILY } from "./bark-uv";
import type { TreeVariant } from "./conifer-variants";
import type { GrowthStage, TreeLook } from "./tree-model";

/** Juvenile growth form (PALM_BRIEF.md small palm silhouettes A-C). */
type PalmJuvenile = "coconut" | "date" | "shrub";

/** Mature architecture of one palm variant (lengths in metres). */
export interface PalmArchetype {
  /** Crown: one sided towards the lean (0 radial .. 1 strongly one sided). */
  asymmetry: number;
  blade: "fan" | "pinnate";
  /** Vertical spread of the frond attachment (young on top, old below). */
  crownDepth: number;
  /** Outer fronds with dry tips, bent tips or split leaflets (share of the old fronds). */
  damage: number;
  /** Date palm: fruit hangs in branched strands of many small dates. */
  dateBunches?: boolean;
  /** Dead hanging leaves below the crown (fan palm skirt). */
  deadSkirt: number;
  /** Leaflet V fold (share of the span). */
  fold: number;
  frondLength: number;
  fronds: number;
  fruit: { color: Vec3; count: number; radius: number };
  /** Downward pull of the rachis (stiff date fronds low, soft coconut fronds high). */
  gravity: number;
  height: number;
  juvenile: PalmJuvenile;
  /** Old cut leaf bases below the crown, and the share of the trunk they cover. */
  leafBases: number;
  leafBaseReach: number;
  /** Sideways bow of the trunk as a share of the height. */
  lean: number;
  /** Bark, frond tint and wind. */
  look: TreeLook;
  /** Bare petiole as a share of the frond length (fan: the stalk below the fan). */
  petiole: number;
  /** Swollen trunk foot (multiplier of the trunk radius at the ground). */
  swell: number;
  /** Leaflet half span as a share of the frond length (fan: the fan radius). */
  span: number;
  trunkRadius: number;
}

const COCONUT_BROWN: Vec3 = [0.3, 0.24, 0.12];
const DATE_ORANGE: Vec3 = [0.55, 0.3, 0.08];
const NO_FRUIT = { color: COCONUT_BROWN, count: 0, radius: 0 };
const PALM_WIND = { branch: 1, trunk: 0.35 };

const ARCHETYPES: Record<number, PalmArchetype> = {
  [PALM.coconut]: {
    asymmetry: 0.1,
    blade: "pinnate",
    crownDepth: 0.55,
    damage: 0.3,
    deadSkirt: 0,
    fold: 0.12,
    frondLength: 5.0,
    fronds: 21,
    fruit: { color: COCONUT_BROWN, count: 7, radius: 0.1 },
    gravity: 0.11,
    height: 7.6,
    juvenile: "coconut",
    leafBases: 3,
    leafBaseReach: 0.06,
    lean: 0.22,
    look: {
      bark: [0.62, 0.57, 0.5],
      barkFamily: BARK_FAMILY.palmRinged,
      barkTop: [0.66, 0.6, 0.52],
      foliage: [1.04, 1.04, 0.92],
      maxSprays: 0,
      wind: PALM_WIND
    },
    petiole: 0.16,
    span: 0.26,
    swell: 1.45,
    trunkRadius: 0.15
  },
  [PALM.date]: {
    asymmetry: 0.05,
    blade: "pinnate",
    crownDepth: 1,
    dateBunches: true,
    damage: 0.2,
    deadSkirt: 0,
    fold: 0.32,
    frondLength: 4.1,
    fronds: 22,
    fruit: { color: DATE_ORANGE, count: 3, radius: 0.03 },
    gravity: 0.035,
    height: 6.4,
    juvenile: "date",
    leafBases: 12,
    leafBaseReach: 0.45,
    lean: 0.04,
    look: {
      bark: [0.42, 0.33, 0.24],
      barkFamily: BARK_FAMILY.palmLeafBase,
      barkTop: [0.48, 0.38, 0.27],
      foliage: [0.86, 0.94, 0.98],
      maxSprays: 0,
      wind: PALM_WIND
    },
    petiole: 0.12,
    span: 0.19,
    swell: 1.12,
    trunkRadius: 0.24
  },
  [PALM.fan]: {
    asymmetry: 0,
    blade: "fan",
    crownDepth: 0.75,
    damage: 0,
    deadSkirt: 7,
    fold: 0.1,
    frondLength: 2.1,
    fronds: 17,
    fruit: NO_FRUIT,
    gravity: 0.03,
    height: 5.6,
    juvenile: "shrub",
    leafBases: 8,
    leafBaseReach: 0.2,
    lean: 0.03,
    look: {
      bark: [0.4, 0.33, 0.26],
      barkFamily: BARK_FAMILY.palmFibrous,
      barkTop: [0.46, 0.38, 0.29],
      foliage: [0.94, 1, 0.98],
      maxSprays: 0,
      wind: PALM_WIND
    },
    petiole: 0.6,
    span: 0.52,
    swell: 1.25,
    trunkRadius: 0.21
  },
  [PALM.pygmyDate]: {
    asymmetry: 0.05,
    blade: "pinnate",
    crownDepth: 0.35,
    damage: 0.1,
    deadSkirt: 0,
    fold: 0.28,
    frondLength: 1.5,
    fronds: 22,
    fruit: NO_FRUIT,
    gravity: 0.06,
    height: 1.7,
    juvenile: "date",
    leafBases: 8,
    leafBaseReach: 0.6,
    lean: 0.05,
    look: {
      bark: [0.38, 0.3, 0.22],
      barkFamily: BARK_FAMILY.palmLeafBase,
      barkTop: [0.44, 0.35, 0.25],
      foliage: [0.92, 1, 0.92],
      maxSprays: 0,
      wind: PALM_WIND
    },
    petiole: 0.12,
    span: 0.16,
    swell: 1.1,
    trunkRadius: 0.11
  },
  [PALM.ground]: {
    asymmetry: 0.15,
    blade: "pinnate",
    crownDepth: 0.12,
    damage: 0.1,
    deadSkirt: 0,
    fold: 0.2,
    frondLength: 2.3,
    fronds: 9,
    fruit: NO_FRUIT,
    gravity: 0.08,
    height: 0.25,
    juvenile: "shrub",
    leafBases: 0,
    leafBaseReach: 0,
    lean: 0,
    look: {
      bark: [0.4, 0.34, 0.24],
      barkFamily: BARK_FAMILY.palmLeafBase,
      barkTop: [0.4, 0.34, 0.24],
      foliage: [1.1, 1.06, 0.86],
      maxSprays: 0,
      wind: PALM_WIND
    },
    petiole: 0.14,
    span: 0.2,
    swell: 1.2,
    trunkRadius: 0.13
  },
  [PALM.leaning]: {
    asymmetry: 0.55,
    blade: "pinnate",
    crownDepth: 0.6,
    damage: 0.7,
    deadSkirt: 0,
    fold: 0.1,
    frondLength: 4.4,
    fronds: 16,
    fruit: { color: COCONUT_BROWN, count: 5, radius: 0.1 },
    gravity: 0.12,
    height: 9.4,
    juvenile: "coconut",
    leafBases: 4,
    leafBaseReach: 0.06,
    lean: 0.5,
    look: {
      bark: [0.6, 0.55, 0.48],
      barkFamily: BARK_FAMILY.palmRinged,
      barkTop: [0.64, 0.58, 0.5],
      foliage: [0.98, 1, 0.9],
      maxSprays: 0,
      wind: PALM_WIND
    },
    petiole: 0.16,
    span: 0.2,
    swell: 1.5,
    trunkRadius: 0.16
  }
};

export const getPalmArchetype = (form: number) =>
  ARCHETYPES[getFormArchetype(form)] ?? ARCHETYPES[PALM.coconut]!;

/**
 * Juvenile structure per stage (PALM_BRIEF.md trunk growth and juvenile stages): never a scaled
 * adult. Trunk and frond length as shares of the mature values, the frond count, how narrow
 * (spear-like) and upright the fronds stand, and how much of the mature crown detail shows.
 */
export interface PalmStage {
  /** Fronds that may be old, damaged or dry (0 juveniles .. 1 mature). */
  ageing: number;
  /** Added frond elevation (radians): seedlings hold their fronds upright. */
  upright: number;
  /** Elevation spread from the young centre to the old outer fronds (narrow seedling crown). */
  spread: number;
  /** Frond count before the juvenile form adjusts it. */
  fronds: number;
  gravity: number;
  length: number;
  /** Leaflet span multiplier (narrow spear-like young fronds). */
  span: number;
  trunk: number;
  trunkRadius: number;
}

const PALM_STAGES: Record<GrowthStage, PalmStage> = {
  1: {
    ageing: 0,
    fronds: 4,
    gravity: 0.25,
    length: 0.3,
    spread: 0.35,
    span: 0.75,
    trunk: 0,
    trunkRadius: 0.22,
    upright: 0.55
  },
  2: {
    ageing: 0,
    fronds: 7,
    gravity: 0.45,
    length: 0.44,
    spread: 0.6,
    span: 0.7,
    trunk: 0.03,
    trunkRadius: 0.85,
    upright: 0.32
  },
  3: {
    ageing: 0.35,
    fronds: 11,
    gravity: 0.7,
    length: 0.62,
    spread: 0.85,
    span: 0.86,
    trunk: 0.14,
    trunkRadius: 0.88,
    upright: 0.14
  },
  4: {
    ageing: 0.7,
    fronds: 0,
    gravity: 0.88,
    length: 0.82,
    spread: 1,
    span: 0.95,
    trunk: 0.45,
    trunkRadius: 0.95,
    upright: 0.05
  },
  5: {
    ageing: 1,
    fronds: 0,
    gravity: 1,
    length: 1,
    span: 1,
    spread: 1,
    trunk: 1,
    trunkRadius: 1,
    upright: 0
  }
};

/** How the juvenile forms differ (A date: dense stiff and narrow, B coconut: fewer broad soft). */
const JUVENILE_STYLES: Record<
  PalmJuvenile,
  { count: number; gravity: number; length: number; span: number }
> = {
  coconut: { count: -1, gravity: 1.5, length: 1.15, span: 1.35 },
  date: { count: 2, gravity: 0.55, length: 0.9, span: 1 },
  shrub: { count: 1, gravity: 1.2, length: 1.05, span: 1.05 }
};

/** Juvenile frond count (never more than the mature crown), the mature count from stage 4. */
const getFrondCount = (archetype: PalmArchetype, stage: GrowthStage): number => {
  const juvenile = JUVENILE_STYLES[archetype.juvenile].count;
  if (stage <= 3) return Math.min(archetype.fronds, PALM_STAGES[stage].fronds + juvenile);
  if (stage === 5) return archetype.fronds;
  return Math.max(Math.round(archetype.fronds * 0.8), getFrondCount(archetype, 3));
};

/** Stage parameters with the juvenile form applied (it fades out by stage 4). */
export const getPalmStage = (archetype: PalmArchetype, stage: GrowthStage): PalmStage => {
  const params = PALM_STAGES[stage];
  const style = JUVENILE_STYLES[archetype.juvenile];
  const weight = stage <= 3 ? 1 : 0;
  const blend = (value: number, factor: number) => value * (1 + (factor - 1) * weight);
  return {
    ...params,
    fronds: getFrondCount(archetype, stage),
    gravity: blend(params.gravity, style.gravity),
    length: blend(params.length, style.length),
    span: blend(params.span, style.span)
  };
};

/** Palm variants: every form young (3), established (4) and mature (5); palms grow open. */
export const PALM_VARIANTS: TreeVariant[] = Object.values(PALM).flatMap((archetype) =>
  ([3, 4, 5] as GrowthStage[]).map((stage) => ({
    form: encodeTreeForm(archetype, COMPETITION.open),
    stage
  }))
);

/** Stump look of a mature palm form: its foot bark and trunk radius (metres, with the swell). */
export const getPalmStump = (form: number) => {
  const archetype = getPalmArchetype(form);
  return { bark: archetype.look.bark, radius: archetype.trunkRadius * archetype.swell };
};
