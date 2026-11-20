import {
  COMPETITION,
  CONIFER,
  getFormArchetype,
  getFormCompetition
} from "../../shared/world/tree-forms";
import type { Vec3 } from "../props/mesh-builder";
import { BARK_FAMILY } from "./bark-uv";
import type { GrowthStage, TreeLook } from "./tree-model";

/**
 * Architecture of a conifer at one age (lengths in metres, ratios of the height). The numbers
 * that change with age (crown base, width, profile, gaps, dead wood) make every stage its own
 * structure instead of a scaled adult.
 */
export interface ConiferShape {
  /** Branch angle (radians above the horizontal) at the crown base and at the top. */
  angleBase: number;
  angleTop: number;
  /** Live crown starts at this fraction of the height (the trunk below is bare). */
  crownBase: number;
  /** Upturn of the branch tip (pull per step). */
  curl: number;
  /** Bend per step of the trunk (lean and crooks). */
  crook: number;
  /** Dead lower branches and broken stubs below the crown. */
  deadBranches: number;
  /** Share of crown limbs that died (old trees: bare grey limbs in the crown). */
  deadLimbs: number;
  /** Needle sprays per branch step. */
  density: number;
  /** Abrupt turns per primary limb (rugged and old limbs). */
  elbows: number;
  /** Needles start this far along a branch (spruce: almost at the trunk, pines: the ends). */
  foliageFrom: number;
  /** Chance that a branch is missing: sky gaps and negative space. */
  gaps: number;
  height: number;
  /** Branch length jitter (silhouette irregularity). */
  irregularity: number;
  /** The trunk runs as a leader up to this fraction of the height (1: an unbroken leader). */
  leaderEnd: number;
  /** Primary limbs per whorl (tier) or per level. */
  perWhorl: number;
  /** Downward pull along the branch (spruce skirts droop). */
  sag: number;
  /** Chance of a second leader (split top). */
  splitLeader: number;
  spraySize: number;
  /** How fast the crown narrows above its widest point (1 cone .. 0.3 flat top). */
  taper: number;
  trunkRadius: number;
  /** Tiers (or levels) of primary limbs. */
  whorls: number;
  /** Widest point of the crown (0 at its base .. 1 at the top). */
  widest: number;
  /** Crown radius as a share of the height. */
  width: number;
  /** One sided crown towards +x (windswept or forest edge), 0 .. 1. */
  windswept: number;
}

/** A shape value, constant or [sapling, mature]. */
type ShapeRange = Record<keyof ConiferShape, number | [number, number]>;

/** One conifer archetype: its sapling and mature shape (stages between interpolate) and look. */
interface ConiferArchetype {
  /** Shape of a stage 1 sapling and of the mature (stage 5) tree. */
  growth: ShapeRange;
  look: TreeLook;
  /** Share of the tier branches drawn as island wood (the rest hides in dense needles). */
  visibleWood: number;
}

const SPRUCE_BARK: Vec3 = [0.44, 0.37, 0.31];

const ARCHETYPES: Record<number, ConiferArchetype> = {
  [CONIFER.spruce]: {
    growth: {
      angleBase: [-0.4, -0.45],
      angleTop: [0.35, 0.3],
      crownBase: [0.03, 0.08],
      crook: 0.006,
      curl: 0.09,
      deadBranches: [0, 2],
      deadLimbs: 0,
      density: 1.45,
      elbows: 0,
      foliageFrom: 0.12,
      gaps: [0.03, 0.1],
      height: 9.6,
      irregularity: [0.1, 0.22],
      leaderEnd: 1,
      perWhorl: [4, 6],
      sag: 0.09,
      splitLeader: 0,
      spraySize: [0.13, 0.46],
      taper: 0.95,
      trunkRadius: 0.25,
      whorls: [5, 17],
      widest: 0.02,
      width: [0.16, 0.21],
      windswept: 0
    },
    look: {
      bark: SPRUCE_BARK,
      barkFamily: BARK_FAMILY.spruce,
      barkTop: SPRUCE_BARK,
      foliage: [0.76, 0.88, 0.98],
      maxSprays: 580,
      wind: { branch: 0.25, trunk: 0.7 }
    },
    visibleWood: 0.22
  },
  [CONIFER.mountain]: {
    growth: {
      angleBase: [0.1, 0.15],
      angleTop: [0.6, 0.75],
      crownBase: [0.02, 0.05],
      crook: [0.04, 0.07],
      curl: 0.07,
      deadBranches: [0, 1],
      deadLimbs: [0, 0.04],
      density: 1.6,
      elbows: [1, 2],
      foliageFrom: 0.15,
      gaps: 0.05,
      height: 5.2,
      irregularity: [0.3, 0.42],
      leaderEnd: 1,
      perWhorl: 5,
      sag: 0,
      splitLeader: [0, 0.6],
      spraySize: [0.13, 0.42],
      taper: [0.85, 0.75],
      trunkRadius: 0.2,
      whorls: [4, 11],
      widest: [0.06, 0.12],
      width: [0.4, 0.5],
      windswept: [0.1, 0.35]
    },
    look: {
      bark: [0.3, 0.27, 0.25],
      barkFamily: BARK_FAMILY.mountainPine,
      barkTop: [0.36, 0.3, 0.26],
      foliage: [0.7, 0.92, 1.1],
      maxSprays: 560,
      wind: { branch: 0.3, trunk: 0.55 }
    },
    visibleWood: 0.35
  },
  [CONIFER.lodgepole]: {
    growth: {
      angleBase: [-0.15, -0.1],
      angleTop: [0.45, 0.5],
      crownBase: [0.1, 0.5],
      crook: 0.004,
      curl: 0.04,
      deadBranches: [0, 4],
      deadLimbs: 0,
      density: 1.3,
      elbows: 0,
      foliageFrom: [0.2, 0.28],
      gaps: [0.05, 0.14],
      height: 10.4,
      irregularity: 0.12,
      leaderEnd: 1,
      perWhorl: 5,
      sag: 0.03,
      splitLeader: 0,
      spraySize: [0.13, 0.44],
      taper: [0.9, 0.8],
      trunkRadius: 0.2,
      whorls: [5, 13],
      widest: [0.12, 0.25],
      width: [0.15, 0.14],
      windswept: 0
    },
    look: {
      bark: [0.5, 0.41, 0.33],
      barkFamily: BARK_FAMILY.spruce,
      barkTop: [0.5, 0.43, 0.37],
      foliage: [1, 1.05, 0.92],
      maxSprays: 520,
      wind: { branch: 0.25, trunk: 1 }
    },
    visibleWood: 0.35
  }
};

/** Age 0 (sapling) .. 1 (mature) per stage: most structure changes late. */
const AGE: Record<GrowthStage, number> = { 1: 0, 2: 0.18, 3: 0.42, 4: 0.7, 5: 1 };
/** Height and trunk radius per stage as a share of the mature tree. */
const HEIGHT_SHARE: Record<GrowthStage, number> = { 1: 0.11, 2: 0.25, 3: 0.46, 4: 0.71, 5: 1 };
const TRUNK_SHARE: Record<GrowthStage, number> = { 1: 0.07, 2: 0.21, 3: 0.43, 4: 0.7, 5: 1 };
/** How strongly the stand shapes a tree (young trees barely react). */
const COMPETITION_WEIGHT: Record<GrowthStage, number> = { 1: 0, 2: 0, 3: 0.3, 4: 0.7, 5: 1 };

const interpolate = (value: number | [number, number], age: number) =>
  typeof value === "number" ? value : value[0] + (value[1] - value[0]) * age;

const resolveRange = (range: ShapeRange, age: number) =>
  Object.fromEntries(
    Object.entries(range).map(([key, value]) => [key, interpolate(value, age)])
  ) as unknown as ConiferShape;

/** Open-grown: broad crown, low branches, thicker trunk, more asymmetry. */
const growOpen = (shape: ConiferShape, weight: number): ConiferShape => ({
  ...shape,
  crownBase: shape.crownBase * (1 - 0.3 * weight),
  deadBranches: shape.deadBranches * (1 - 0.5 * weight),
  height: shape.height * (1 - 0.06 * weight),
  irregularity: shape.irregularity + 0.08 * weight,
  trunkRadius: shape.trunkRadius * (1 + 0.15 * weight),
  width: shape.width * (1 + 0.16 * weight)
});

/** Forest interior: taller, narrower, few low branches (dead stubs instead), straight leader. */
const growInterior = (shape: ConiferShape, weight: number): ConiferShape => ({
  ...shape,
  crook: shape.crook * (1 - 0.6 * weight),
  crownBase: shape.crownBase + (0.82 - shape.crownBase) * 0.4 * weight,
  deadBranches: shape.deadBranches + 3 * weight,
  height: shape.height * (1 + 0.1 * weight),
  irregularity: shape.irregularity * (1 - 0.3 * weight),
  trunkRadius: shape.trunkRadius * (1 - 0.1 * weight),
  width: shape.width * (1 - 0.28 * weight)
});

/** Forest edge: the crown leans to the light, bigger branches on the open (+x) side. */
const growEdge = (shape: ConiferShape, weight: number): ConiferShape => ({
  ...shape,
  crownBase: shape.crownBase * (1 - 0.2 * weight),
  windswept: Math.max(shape.windswept, 0.55 * weight)
});

const COMPETITION_GROWTH: Record<number, (shape: ConiferShape, weight: number) => ConiferShape> = {
  [COMPETITION.open]: growOpen,
  [COMPETITION.interior]: growInterior,
  [COMPETITION.edge]: growEdge
};

const getArchetype = (form: number) =>
  ARCHETYPES[getFormArchetype(form)] ?? ARCHETYPES[CONIFER.spruce]!;

/** Shape of a conifer form (archetype, competition) at a growth stage. */
export const getConiferShape = (form: number, stage: GrowthStage): ConiferShape => {
  const archetype = getArchetype(form);
  const shape = resolveRange(archetype.growth, AGE[stage]);
  const grown: ConiferShape = {
    ...shape,
    height: shape.height * HEIGHT_SHARE[stage],
    trunkRadius: shape.trunkRadius * TRUNK_SHARE[stage]
  };
  const compete = COMPETITION_GROWTH[getFormCompetition(form)] ?? growOpen;
  return compete(grown, COMPETITION_WEIGHT[stage]);
};

/** Look (bark, needles, wind) of a conifer form; young trees are a little fresher green. */
export const getConiferLook = (form: number, stage: GrowthStage): TreeLook => {
  const { look } = getArchetype(form);
  const fresh = stage <= 2 ? 1.08 : 1;
  const flexible = stage <= 3 ? 1.35 : 1;
  return {
    ...look,
    foliage: [look.foliage[0] * fresh, look.foliage[1] * fresh, look.foliage[2]],
    wind: { branch: look.wind.branch, trunk: look.wind.trunk * flexible }
  };
};

export const getVisibleWoodShare = (form: number) => getArchetype(form).visibleWood;
