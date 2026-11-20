import { clamp01, smoothstep } from "../../shared/world/noise";
import { createRandom } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import { fromAngles, pointAlong } from "../props/tree-parts";
import {
  addLeaderTuft,
  addShootSprays,
  type ConiferContext,
  growSideShoots} from "./conifer-foliage";
import {
  type ConiferShape,
  getConiferLook,
  getConiferShape,
  getVisibleWoodShare} from "./conifer-shapes";
import { createLimb, deviate, growCrookedLimbPoints, growLimbPoints, valueAt } from "./limb-growth";
import { finishModel } from "./model-bounds";
import { shapeSubCrowns } from "./sub-crowns";
import { createEmptyModel, type GrowthStage, type TreeModel, type WoodLimb } from "./tree-model";

interface CrownContext extends ConiferContext {
  nextClump: () => number;
  stage: GrowthStage;
  trunk: WoodLimb;
  visibleWood: number;
}

/** Position 0 (crown base) .. 1 (top) of a height fraction inside the live crown. */
const getCrownPosition = (shape: ConiferShape, fraction: number) =>
  clamp01((fraction - shape.crownBase) / Math.max(0.05, 1 - shape.crownBase));

/**
 * Crown radius (metres) at a height fraction: it swells from the crown base to the widest point,
 * then narrows towards the top (a cone or an ovoid by `taper`).
 */
const getCrownRadiusAt = (shape: ConiferShape, fraction: number) => {
  const crown = getCrownPosition(shape, fraction);
  const radius = shape.width * shape.height;
  if (crown < shape.widest) {
    const base = Math.min(1, Math.max(0.55, 1 - shape.widest * 1.5));
    return radius * (base + (1 - base) * Math.sin((Math.PI / 2) * (crown / shape.widest)));
  }
  return radius * Math.pow((1 - crown) / (1 - shape.widest), shape.taper);
};

/** Point and radius of the trunk at a height fraction (the leader may end below the top). */
const trunkAt = (context: CrownContext, fraction: number) => {
  const along = Math.min(1, fraction / context.shape.leaderEnd);
  return {
    point: pointAlong(context.trunk.points, along),
    radius: valueAt(context.trunk.radii, along)
  };
};

/** Tapered, slightly irregular trunk (crooked and leaning by archetype), wider at the foot. */
const growTrunk = (context: ConiferContext, age: number) => {
  const { random, shape } = context;
  const lean = shape.crook * 2;
  const points = growLimbPoints(
    {
      direction: [(random() - 0.5) * lean, 1, (random() - 0.5) * lean],
      length: shape.height * shape.leaderEnd,
      start: [0, -0.05, 0],
      steps: 10,
      tropism: [0, 0.02, 0],
      wobble: shape.crook
    },
    random
  );
  const tip = shape.trunkRadius * (shape.leaderEnd < 1 ? 0.45 : 0.08);
  const trunk = createLimb(points, [shape.trunkRadius, tip], 0, [0, 0.35], random());
  trunk.radii = trunk.radii.map((radius) => radius * (1 + (random() - 0.5) * 0.12 * age));
  trunk.radii[0]! *= 1.3 + age * 0.15;
  context.model.wood.push(trunk);
  return trunk;
};

/** The limb's foliage: sprays along it, with flat side fans from stage 3. */
const addLimbFoliage = (context: CrownContext, limb: WoodLimb) => {
  const clump = context.nextClump();
  addShootSprays(context, limb, context.shape.foliageFrom, clump);
  if (context.stage >= 3) growSideShoots(context, limb, clump);
};

interface LimbPlacement {
  azimuth: number;
  fraction: number;
}

/** Horizontal reach (metres) of a limb: to the crown profile at its tip, one sided if needed. */
const getLimbReach = (context: CrownContext, start: Vec3, angle: number, placed: LimbPlacement) => {
  const { random, shape } = context;
  const first = getCrownRadiusAt(shape, placed.fraction);
  const tipFraction = (start[1] + first * Math.tan(angle)) / shape.height;
  const side = Math.max(0.35, 1 + shape.windswept * Math.cos(placed.azimuth));
  const jitter = 1 + (random() - 0.5) * 2 * shape.irregularity;
  const profile = Math.max(0.06, getCrownRadiusAt(shape, clamp01(tipFraction)));
  return Math.max(0.05, profile * side * jitter);
};

const isVisibleWood = (context: CrownContext, crown: number) =>
  context.random() < context.visibleWood * 2 * (1 - crown);

/** One primary limb from the trunk towards the crown surface, with its foliage. */
const growPrimary = (context: CrownContext, placed: LimbPlacement) => {
  const { random, shape } = context;
  const crown = getCrownPosition(shape, placed.fraction);
  const trunk = trunkAt(context, placed.fraction);
  const angle =
    shape.angleBase + (shape.angleTop - shape.angleBase) * crown + (random() - 0.5) * 0.15;
  const reach = getLimbReach(context, trunk.point, angle, placed);
  const elbows = Array.from({ length: Math.round(shape.elbows) }, () => 0.25 + random() * 0.3);
  const { points } = growCrookedLimbPoints(
    {
      direction: fromAngles(placed.azimuth, angle),
      elbows,
      length: reach / Math.max(0.3, Math.cos(angle)),
      lift: (t) => (t < 0.6 ? -shape.sag : -shape.sag * 0.3) + shape.curl * smoothstep(0.55, 1, t),
      start: trunk.point,
      steps: 5,
      wobble: 0.03 + shape.irregularity * 0.06
    },
    random
  );
  const radius = Math.max(0.004, trunk.radius * 0.3 * (1 - crown * 0.4));
  const dead = crown < 0.6 && random() < shape.deadLimbs;
  const limbPoints = dead ? points.slice(0, 4) : points;
  const limb = createLimb(limbPoints, [radius, radius * 0.25], 1, [0.12, 0.75], random());
  limb.dead = dead || undefined;
  limb.minor = dead || isVisibleWood(context, crown) ? undefined : true;
  context.model.wood.push(limb);
  if (!dead) addLimbFoliage(context, limb);
};

/** Placements of one tier or level: evenly turned limbs, some missing (sky gaps). */
const placeLevel = (context: CrownContext, fraction: number, t: number) => {
  const { random, shape } = context;
  const count = Math.max(
    2,
    Math.round(shape.perWhorl) - Math.floor(t * 2) + (random() < 0.3 ? 1 : 0)
  );
  const offset = random() * Math.PI * 2;
  const placements: LimbPlacement[] = [];
  for (let branch = 0; branch < count; branch += 1) {
    if (random() < shape.gaps) continue;
    placements.push({
      azimuth: offset + (branch / count) * Math.PI * 2 + (random() - 0.5) * 0.5,
      fraction
    });
  }
  return placements;
};

/** Tiers (or levels) of limbs from the crown base up to the leader's end. */
const growCrown = (context: CrownContext) => {
  const { shape } = context;
  const top = Math.min(shape.leaderEnd, 0.95);
  const levels = Math.max(2, Math.round(shape.whorls));
  for (let level = 0; level < levels; level += 1) {
    const t = level / levels;
    const fraction = shape.crownBase + (top - shape.crownBase) * Math.pow(t, 0.92);
    for (const placed of placeLevel(context, fraction, t)) growPrimary(context, placed);
  }
};

/** Dead lower branches and broken stubs on the bare trunk below the crown. */
const growDeadWood = (context: CrownContext) => {
  const { random, shape } = context;
  const low = 0.12;
  const high = shape.crownBase - 0.02;
  if (high - low < 0.08) return;
  for (let index = 0; index < Math.round(shape.deadBranches); index += 1) {
    const fraction = low + (high - low) * random();
    const trunk = trunkAt(context, fraction);
    const stub = random() < 0.4;
    const length =
      shape.width * shape.height * (stub ? 0.08 + random() * 0.08 : 0.22 + random() * 0.3);
    const points = growLimbPoints(
      {
        direction: fromAngles(random() * Math.PI * 2, -0.25 + random() * 0.35),
        length,
        start: trunk.point,
        steps: stub ? 1 : 3,
        tropism: [0, -0.03, 0],
        wobble: 0.12
      },
      random
    );
    const radius = trunk.radius * (stub ? 0.22 : 0.16);
    const limb = createLimb(points, [radius, radius * 0.4], 1, [0.05, 0.2], random());
    limb.dead = true;
    context.model.wood.push(limb);
  }
};

/** Occasional second leader (mountain pine, old pines): a split top. */
const growSplitLeader = (context: CrownContext) => {
  const { random, shape } = context;
  if (random() >= shape.splitLeader) return;
  const trunk = trunkAt(context, 0.68);
  const direction = deviate([0, 1, 0], 0.3 + random() * 0.15, random() * Math.PI * 2);
  const points = growLimbPoints(
    {
      direction,
      length: shape.height * 0.3,
      start: trunk.point,
      steps: 4,
      tropism: [0, 0.03, 0],
      wobble: 0.04
    },
    random
  );
  const limb = createLimb(
    points,
    [trunk.radius * 0.55, trunk.radius * 0.1],
    1,
    [0.2, 0.6],
    random()
  );
  context.model.wood.push(limb);
  addLimbFoliage(context, limb);
};

/** Extra light on fresh shoot tips. */
const FRESH_TIP_LIGHT = 0.18;

/**
 * Needles near the trunk and low in the crown are darkest; outer upper tips are lit, fresh
 * shoot tips a little brighter.
 */
const shadeFoliage = (context: CrownContext) => {
  const { model, shape } = context;
  for (const spray of model.foliage) {
    const fraction = spray.position[1] / shape.height;
    const crownRadius = Math.max(0.05, getCrownRadiusAt(shape, fraction));
    const outer = Math.min(1.1, Math.hypot(spray.position[0], spray.position[2]) / crownRadius);
    const relative = getCrownPosition(shape, fraction);
    spray.shade = clamp01(0.1 + Math.pow(outer, 1.4) * 0.72 + relative * 0.2);
  }
  shapeSubCrowns(model.foliage, context.clumps);
  for (const spray of context.freshTips) spray.shade = Math.min(1, spray.shade + FRESH_TIP_LIGHT);
};

/**
 * Conifer of one archetype and competition form (the form byte, tree-forms.ts) at a growth
 * stage: a leader with tiers of whorled branches (spruce, mountain and tall forest pine), with
 * dead lower wood, sky gaps and one sided crowns by archetype, age and the stand.
 */
export const createConiferModel = (seed: number, stage: GrowthStage, form: number): TreeModel => {
  const random = createRandom(seed);
  const shape = getConiferShape(form, stage);
  const model = createEmptyModel("pine", stage);
  const base: ConiferContext = {
    clumps: [],
    freshTips: [],
    model,
    random,
    shape
  };
  const trunk = growTrunk(base, stage / 5);
  let clump = 0;
  const context: CrownContext = {
    ...base,
    nextClump: () => (clump += 1),
    stage,
    trunk,
    visibleWood: getVisibleWoodShare(form)
  };
  growCrown(context);
  growDeadWood(context);
  growSplitLeader(context);
  if (shape.leaderEnd >= 1) addLeaderTuft(context, trunk, context.nextClump());
  shadeFoliage(context);
  model.crownCentre = [0, shape.height * (shape.crownBase + (1 - shape.crownBase) * 0.45), 0];
  model.look = getConiferLook(form, stage);
  return finishModel(model);
};

/** Crown centre height and radius (metres) of a conifer form, for felling and picking. */
export const getConiferCrown = (form: number, stage: GrowthStage) => {
  const shape = getConiferShape(form, stage);
  const centre = shape.crownBase + (1 - shape.crownBase) * 0.45;
  return {
    height: shape.height * centre,
    radius: shape.width * shape.height * 0.9
  };
};
