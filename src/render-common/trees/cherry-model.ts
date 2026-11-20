import { createRandom, type Random } from "../../shared/world/rng";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { add, pointAlong, randomPerpendicular, scale, subtract } from "../props/tree-parts";
import { createCrownEnvelope, type CrownEnvelope, type CrownShading, getCrownShade } from "./crown-envelope";
import { CHERRY_SPRAY_COUNT, CHERRY_SPRAY_VARIANT } from "./foliage-atlas";
import { createLimb, deviate, growCrookedLimbPoints, tangentAt, valueAt } from "./limb-growth";
import { finishModel } from "./model-bounds";
import { shapeSubCrowns } from "./sub-crowns";
import { createEmptyModel, type GrowthStage, type TreeModel, type WoodLimb } from "./tree-model";

/** Structure per growth stage: a young cherry is a slim whip, an old one a wide umbrella. */
interface CherryStage {
  crownRadii: Vec3;
  depth: number;
  height: number;
  limbs: number;
  spacing: number;
  spraySize: number;
  trunkRadius: number;
}
const CHERRY_STAGES: Record<GrowthStage, CherryStage> = {
  1: { crownRadii: [.45, .35, .45], depth: 2, height: 1.2, limbs: 3, spacing: .3, spraySize: .14, trunkRadius: .02 },
  2: { crownRadii: [1.1, .7, 1.1], depth: 3, height: 2.5, limbs: 3, spacing: .28, spraySize: .22, trunkRadius: .06 },
  3: { crownRadii: [2, 1.2, 2], depth: 3, height: 3.9, limbs: 4, spacing: .26, spraySize: .32, trunkRadius: .14 },
  4: { crownRadii: [3.2, 1.8, 3.2], depth: 4, height: 5.2, limbs: 4, spacing: .24, spraySize: .44, trunkRadius: .22 },
  5: { crownRadii: [4.2, 2.3, 4.2], depth: 4, height: 6.4, limbs: 5, spacing: .22, spraySize: .52, trunkRadius: .3 }
};

interface CherryContext {
  clumps: number[];
  envelope: CrownEnvelope;
  model: TreeModel;
  nextClump: number;
  params: CherryStage;
  random: Random;
}
interface BranchSeed { clump: number; depth: number; direction: Vec3; phase: number; radius: number; start: Vec3 }

/** Blossom on the sunlit outer skin is brightest; deep inside the crown it is in shade. */
const CHERRY_SHADING: CrownShading = { base: .15, exponent: 1.5, gain: .78, lift: .12 };

const addBlossom = (context: CherryContext, position: Vec3, twig: Vec3, clump: number, phase: number) => {
  const { envelope, random } = context;
  const outward = normalize(subtract(position, envelope.centre));
  const growth = normalize(add(add(twig, scale(outward, .5)), scale(randomPerpendicular(twig, random), .5)));
  const facing = normalize(add(add(scale(outward, .5), [0, .6, 0]), scale(randomPerpendicular(outward, random), .4)));
  context.model.foliage.push({ facing, growth, hue: 0, outward, phase: phase + random() * .3, position,
    shade: getCrownShade(envelope, position, CHERRY_SHADING), size: context.params.spraySize * (.8 + random() * .4),
    sway: .75 + random() * .25, variant: CHERRY_SPRAY_VARIANT + Math.floor(random() * CHERRY_SPRAY_COUNT) });
  context.clumps.push(clump);
};

/** Dense blossom along the outer two thirds of a twig and a cluster at its tip. */
const addTwigBlossom = (context: CherryContext, limb: WoodLimb, clump: number, phase: number) => {
  const { params, random } = context;
  const length = limb.points.reduce((sum, point, index) =>
    sum + Math.hypot(...subtract(point, limb.points[Math.max(0, index - 1)]!)), 0);
  const step = params.spraySize * params.spacing / Math.max(length, .01);
  for (let along = .3 + random() * step; along <= 1; along += step * (.8 + random() * .4)) {
    addBlossom(context, pointAlong(limb.points, along), tangentAt(limb.points, along), clump, phase);
    if (random() < .7) addBlossom(context, pointAlong(limb.points, along), tangentAt(limb.points, along), clump, phase);
  }
  addBlossom(context, limb.points[limb.points.length - 1]!, tangentAt(limb.points, 1), clump, phase);
};

/** Primary limbs rise through their first 60 % and then arch over; secondary limbs droop slightly. */
const liftPrimaryLimb = (t: number) => (t < .6 ? .03 : -.03);
const liftSecondaryLimb = () => -.01;

/** Cherry limbs rise and spread like a vase, crook at a few elbows and arch over at the tips. */
const growCherryLimb = (context: CherryContext, seed: BranchSeed) => {
  const { envelope, params, random } = context;
  const primary = seed.depth === 1;
  const length = primary ? params.crownRadii[0] * (.75 + random() * .25)
    : Math.min(envelope.reach(seed.start, seed.direction) * (.7 + random() * .25), params.height * .55);
  return growCrookedLimbPoints({
    direction: seed.direction,
    elbows: Array.from({ length: primary ? 2 + Math.floor(random() * 2) : 1 }, () => .25 + random() * .4),
    length,
    lift: primary ? liftPrimaryLimb : liftSecondaryLimb,
    start: seed.start,
    steps: primary ? 8 : 4,
    wobble: .08 + seed.depth * .025
  }, random);
};

const growBranch = (context: CherryContext, seed: BranchSeed) => {
  const { params, random } = context;
  const { elbowFractions, points } = growCherryLimb(context, seed);
  const limb = createLimb(points, [seed.radius, seed.radius * .2], seed.depth,
    [Math.max(0, seed.depth * .22 - .2), Math.min(1, seed.depth * .27)], seed.phase);
  context.model.wood.push(limb);
  const clump = seed.depth <= 2 ? ++context.nextClump : seed.clump;
  if (seed.depth >= params.depth - 1) addTwigBlossom(context, limb, clump, seed.phase);
  if (seed.depth >= params.depth) return;
  const count = 3 + Math.floor(random() * 3);
  for (let child = 0; child < count; child++) {
    const along = child < elbowFractions.length ? elbowFractions[child]! : .3 + .65 * (child + random() * .8) / count;
    // Side branches spread outwards and only a little upwards: the wide, layered cherry crown.
    const direction = deviate(tangentAt(limb.points, along), .5 + random() * .45, random() * Math.PI * 2);
    growBranch(context, { clump, depth: seed.depth + 1, direction: normalize(add(direction, [0, .15, 0])),
      phase: seed.phase + random() * .25, radius: valueAt(limb.radii, along) * .66,
      start: pointAlong(limb.points, along) });
  }
};

/** Short S-curved bole leaning to one side; it splits low into the main limbs. */
const growTrunk = (context: CherryContext) => {
  const { params, random } = context;
  const length = params.height * .4, side = random() * Math.PI * 2, lean = .12 + random() * .1;
  const points: Vec3[] = Array.from({ length: 9 }, (_, index) => {
    const t = index / 8, sway = Math.sin(t * Math.PI * 1.4) * length * .12;
    return [Math.cos(side) * (lean * length * t + sway), -.05 + length * t,
      Math.sin(side) * (lean * length * t - sway * .5)];
  });
  const trunk = createLimb(points, [params.trunkRadius, params.trunkRadius * .55], 0, [0, .06], random());
  trunk.radii[0]! *= 1.45;
  context.model.wood.push(trunk);
  return trunk;
};

/** Main limbs fan out from the top of the bole at 35-60 degrees, all round the tree. */
const growLimbs = (context: CherryContext, trunk: WoodLimb) => {
  const { params, random } = context;
  const azimuth = random() * Math.PI * 2;
  for (let index = 0; index < params.limbs; index++) {
    const along = .82 + random() * .15;
    const outward = azimuth + index * Math.PI * 2 / params.limbs + (random() - .5) * .5;
    const rise = .55 + random() * .35;
    const direction: Vec3 = [Math.cos(outward) * Math.cos(rise), Math.sin(rise), Math.sin(outward) * Math.cos(rise)];
    growBranch(context, { clump: -1, depth: 1, direction, phase: random(),
      radius: valueAt(trunk.radii, along) * .72, start: pointAlong(trunk.points, along) });
  }
};

/** Japanese flowering cherry (sakura): the blossoming form of the broadleaf tree. */
export const createCherryModel = (seed: number, stage: GrowthStage): TreeModel => {
  const random = createRandom(seed);
  const params = CHERRY_STAGES[stage];
  const model = createEmptyModel("oak", stage);
  const centre: Vec3 = [0, params.height - params.crownRadii[1] * .9, 0];
  const envelope = createCrownEnvelope(random, centre, params.crownRadii, .4);
  const context: CherryContext = { clumps: [], envelope, model, nextClump: 0, params, random };
  growLimbs(context, growTrunk(context));
  shapeSubCrowns(model.foliage, context.clumps);
  model.crownCentre = centre;
  return finishModel(model);
};
