import { createRandom, type Random } from "../../shared/world/rng";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { add, pointAlong, randomPerpendicular, scale, subtract } from "../props/tree-parts";
import { createCrownEnvelope, type CrownEnvelope, type CrownShading, getCrownShade } from "./crown-envelope";
import {
  createLimb,
  deviate,
  growCrookedLimbPoints,
  growLimbPoints,
  tangentAt,
  valueAt
} from "./limb-growth";
import { finishModel } from "./model-bounds";
import { shapeSubCrowns } from "./sub-crowns";
import { createEmptyModel, type GrowthStage, SAPLING_STAGE, type TreeModel, type WoodLimb } from "./tree-model";

const GOLDEN_ANGLE = 2.39996;

/** Structure per growth stage: every stage grows a new skeleton, it is not a scaled copy. */
interface OakStage {
  boleFraction: number;
  crownRadii: Vec3;
  depth: number;
  height: number;
  /** Trunk radius at its top, relative to the foot: saplings taper into a slim leader. */
  leaderTip: number;
  limbs: number;
  /** Spray spacing along twigs, relative to the spray size (smaller = denser). */
  spacing: number;
  spraySize: number;
  trunkRadius: number;
}

const OAK_STAGES: Record<GrowthStage, OakStage> = {
  1: {
    boleFraction: 0.42,
    crownRadii: [0.42, 0.42, 0.42],
    depth: 2,
    height: 1.3,
    leaderTip: 0.1,
    limbs: 4,
    spacing: 0.24,
    spraySize: 0.15,
    trunkRadius: 0.022
  },
  2: {
    boleFraction: 0.38,
    crownRadii: [0.95, 0.85, 0.95],
    depth: 3,
    height: 2.8,
    leaderTip: 0.14,
    limbs: 4,
    spacing: 0.24,
    spraySize: 0.24,
    trunkRadius: 0.065
  },
  3: {
    boleFraction: 0.36,
    crownRadii: [1.8, 1.4, 1.8],
    depth: 3,
    height: 4.4,
    leaderTip: 0.34,
    limbs: 4,
    spacing: 0.24,
    spraySize: 0.36,
    trunkRadius: 0.16
  },
  4: {
    boleFraction: 0.3,
    crownRadii: [3.2, 2.1, 3.2],
    depth: 4,
    height: 6.1,
    leaderTip: 0.34,
    limbs: 5,
    spacing: 0.24,
    spraySize: 0.513,
    trunkRadius: 0.26
  },
  5: {
    boleFraction: 0.34,
    crownRadii: [4.3, 2.8, 4.3],
    depth: 4,
    height: 7.7,
    leaderTip: 0.34,
    limbs: 6,
    spacing: 0.24,
    spraySize: 0.581,
    trunkRadius: 0.36
  }
};

interface OakContext {
  /** Clump (sub-crown) id of every spray, parallel to model.foliage. */
  clumps: number[];
  envelope: CrownEnvelope;
  model: TreeModel;
  nextClump: number;
  params: OakStage;
  random: Random;
}

/** Sprays deep inside the crown are darker; the upper outer skin catches the sun. */
const OAK_SHADING: CrownShading = { base: 0.08, exponent: 1.7, gain: 0.82, lift: 0.14 };

interface SprayOrigin {
  clump: number;
  hue: number;
  phase: number;
}

const addSpray = (context: OakContext, position: Vec3, twig: Vec3, origin: SprayOrigin) => {
  const { envelope, random } = context;
  const { hue, phase } = origin;
  const outward = normalize(subtract(position, envelope.centre));
  const growth = normalize(
    add(add(twig, scale(outward, 0.6)), scale(randomPerpendicular(twig, random), 0.5))
  );
  const facing = normalize(
    add(add(scale(outward, 0.55), [0, 0.55, 0]), scale(randomPerpendicular(outward, random), 0.45))
  );
  context.model.foliage.push({
    facing,
    growth,
    hue: Math.max(-1, Math.min(1, hue + (random() - 0.5) * 0.5)),
    outward,
    phase: phase + random() * 0.3,
    position,
    shade: getCrownShade(envelope, position, OAK_SHADING),
    size: context.params.spraySize * (0.78 + random() * 0.44),
    sway: 0.7 + random() * 0.3,
    variant: Math.floor(random() * 8)
  });
  context.clumps.push(origin.clump);
};

/** Sprays along the outer part of a twig, alternating sides, plus a tuft at its tip. */
const addTwigSprays = (context: OakContext, limb: WoodLimb, origin: SprayOrigin) => {
  const { params, random } = context;
  const length = limb.points.reduce((sum, point, index) => {
    const previous = limb.points[Math.max(0, index - 1)]!;
    return sum + Math.hypot(...subtract(point, previous));
  }, 0);
  const step = (params.spraySize * params.spacing) / Math.max(length, 0.01);
  for (let along = 0.3 + random() * step; along <= 1; along += step * (0.8 + random() * 0.4)) {
    const position = pointAlong(limb.points, along);
    const tangent = tangentAt(limb.points, along);
    addSpray(context, position, tangent, origin);
    if (random() < 0.6) addSpray(context, position, tangent, origin);
  }
  addSpray(context, limb.points[limb.points.length - 1]!, tangentAt(limb.points, 1), origin);
};

interface BranchSeed {
  /** Sub-crown the branch belongs to; -1 until a primary limb starts one. */
  clump: number;
  depth: number;
  direction: Vec3;
  hue: number;
  phase: number;
  radius: number;
  start: Vec3;
}

/**
 * Primary limbs are the scaffold: sized by the crown width (they reach out under it, nearly
 * level, crooked, tips turning up); smaller branches grow until they meet the crown envelope.
 */
const getBranchLength = (context: OakContext, seed: BranchSeed) => {
  const { envelope, params, random } = context;
  if (seed.depth === 1) return params.crownRadii[0] * (0.68 + random() * 0.24);
  const reach = envelope.reach(seed.start, seed.direction);
  return Math.min(reach * (0.72 + random() * 0.22), params.height * 0.62);
};

/** A primary starts a sub-crown, and so does every secondary branch (its own leaf clump). */
const getClump = (context: OakContext, seed: BranchSeed) => {
  if (seed.depth > 2 && seed.clump >= 0) return seed.clump;
  context.nextClump += 1;
  return context.nextClump;
};

/** Primary pull along the limb: a short rise, the sag under its weight, the upturned tip. */
const getElbowLift = (t: number, sag: number, upturn: number) => {
  if (t < 0.15) return 0.02;
  if (t < 0.55) return -sag;
  return upturn;
};

const randomAngles = (count: number, range: [number, number], random: Random) =>
  Array.from({ length: count }, () => range[0] + random() * (range[1] - range[0]));

/**
 * The oak elbow: a primary leaves the trunk rising, arcs out and sags under its weight, then
 * turns up towards the tip, with 2-3 abrupt turns of 15-35 degrees; secondaries get one smaller
 * turn, twigs only wiggle. Curvature differs per limb (seeded).
 */
const growOakLimb = (context: OakContext, seed: BranchSeed) => {
  const { random } = context;
  const base = { direction: seed.direction, length: getBranchLength(context, seed) };
  if (seed.depth === 1) {
    const sag = 0.03 + random() * 0.05;
    const upturn = 0.07 + random() * 0.08;
    return growCrookedLimbPoints(
      {
        ...base,
        elbows: randomAngles(2 + Math.floor(random() * 2), [0.26, 0.6], random),
        lift: (t) => getElbowLift(t, sag, upturn),
        start: seed.start,
        steps: 8,
        wobble: 0.06
      },
      random
    );
  }
  return growCrookedLimbPoints(
    {
      ...base,
      elbows: seed.depth === 2 ? randomAngles(1, [0.17, 0.35], random) : [],
      lift: () => 0.025,
      start: seed.start,
      steps: 4,
      wobble: 0.1 + seed.depth * 0.02
    },
    random
  );
};

/** Recursive branching: children leave along the parent, aimed at the crown envelope. */
const growBranch = (context: OakContext, seed: BranchSeed) => {
  const { params } = context;
  const { elbowFractions, points } = growOakLimb(context, seed);
  const sway: [number, number] = [
    Math.max(0, seed.depth * 0.22 - 0.2),
    Math.min(1, seed.depth * 0.26)
  ];
  const limb = createLimb(points, [seed.radius, seed.radius * 0.22], seed.depth, sway, seed.phase);
  context.model.wood.push(limb);
  const clump = getClump(context, seed);
  if (seed.depth >= params.depth - 1) {
    addTwigSprays(context, limb, { clump, hue: seed.hue, phase: seed.phase });
  }
  if (seed.depth >= params.depth) return;
  growChildren(context, limb, { ...seed, clump }, elbowFractions);
};

/** Side branches lean up out of the level limbs (some still droop): an oak's layered crown. */
const UPWARD_BIAS: Vec3 = [0, 0.35, 0];

/** Side branches leave at the elbows first (where an oak limb kinks), then along the limb. */
const getChildAlong = (child: number, count: number, elbows: number[], random: Random) => {
  if (child < elbows.length) return elbows[child]! + (random() - 0.5) * 0.04;
  return 0.28 + (0.7 * (child + random() * 0.8)) / count;
};

const growChildren = (context: OakContext, limb: WoodLimb, seed: BranchSeed, elbows: number[]) => {
  const { random } = context;
  const count = 3 + Math.floor(random() * 3);
  const dropChance = seed.depth === 1 ? 0.18 : 0.12;
  for (let child = 0; child < count; child += 1) {
    if (random() < dropChance) continue;
    const along = getChildAlong(child, count, elbows, random);
    const angle = 0.45 + random() * 0.4;
    const direction = deviate(tangentAt(limb.points, along), angle, random() * Math.PI * 2);
    growBranch(context, {
      clump: seed.clump,
      depth: seed.depth + 1,
      direction: normalize(add(direction, UPWARD_BIAS)),
      hue: seed.hue,
      phase: seed.phase + random() * 0.25,
      radius: valueAt(limb.radii, along) * 0.68,
      start: pointAlong(limb.points, along)
    });
  }
};

/** Lateral offset of a slow wave that starts at 0 at the foot (t 0..1 along the bole). */
const wave = (t: number, halfWaves: number, phase: number) =>
  Math.sin(Math.PI * halfWaves * t + phase) - Math.sin(phase);

/**
 * Bole axis: a lean plus two slow waves in crossing directions, so the trunk bends a few
 * degrees and changes direction once or twice (an S-curve) instead of a straight tube.
 */
const growSinuousBole = (length: number, steps: number, random: Random): Vec3[] => {
  const lean = [(random() - 0.5) * 0.14, (random() - 0.5) * 0.14];
  const side = random() * Math.PI * 2;
  const first = { amplitude: length * (0.03 + random() * 0.02), halves: 1.3 + random() * 0.7 };
  const second = { amplitude: length * (0.014 + random() * 0.012), halves: 2.2 + random() * 0.8 };
  const phases = [random() * Math.PI, random() * Math.PI];
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const a = first.amplitude * wave(t, first.halves, phases[0]!);
    const b = second.amplitude * wave(t, second.halves, phases[1]!);
    return [
      lean[0]! * length * t + Math.cos(side) * a - Math.sin(side) * b,
      -0.05 + length * t,
      lean[1]! * length * t + Math.sin(side) * a + Math.cos(side) * b
    ];
  });
};

/** Branch collar: the trunk swells a little where a heavy limb leaves it. */
const addCollar = (trunk: WoodLimb, along: number) => {
  const index = Math.round(along * (trunk.radii.length - 1));
  trunk.radii[index]! *= 1.07;
};

/**
 * Short, thick, slightly leaning and crooked bole with a root flare; it thins into a leader that
 * the limbs soon outgrow (the decurrent oak crown).
 */
const growTrunk = (context: OakContext) => {
  const { params, random } = context;
  const points = growSinuousBole(params.height * 0.62, 8, random);
  const trunk = createLimb(
    points,
    [params.trunkRadius, params.trunkRadius * params.leaderTip],
    0,
    [0, 0.08],
    random()
  );
  trunk.radii[0]! *= 1.5;
  trunk.radii[1]! *= 1.12;
  context.model.wood.push(trunk);
  return trunk;
};

/** Buttress roots: short tapering spurs that run from the trunk foot down into the soil. */
const growRoots = (context: OakContext, trunk: WoodLimb) => {
  const { random } = context;
  const count = 4 + Math.floor(random() * 2);
  const radius = trunk.radii[0]!;
  const azimuth = random() * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    const angle = azimuth + ((index + (random() - 0.5) * 0.5) / count) * Math.PI * 2;
    const out: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
    const start = add(scale(out, radius * 0.4), [0, radius * 0.9, 0]);
    const points = growLimbPoints(
      {
        direction: add(out, [0, -0.8, 0]),
        length: radius * (1.6 + random() * 0.7),
        start,
        steps: 2,
        tropism: [0, -0.1, 0],
        wobble: 0.08
      },
      random
    );
    const root = createLimb(points, [radius * 0.62, radius * 0.22], 1, [0, 0], 0);
    context.model.wood.push({ ...root, root: true });
  }
};

/**
 * A few heavy main limbs spiral up the upper bole: the lowest spread out nearly level, the upper
 * ones climb more steeply; each is a little thinner than the trunk where it leaves it.
 */
const growLimbs = (context: OakContext, trunk: WoodLimb) => {
  const { params, random } = context;
  const azimuth = random() * Math.PI * 2;
  for (let index = 0; index < params.limbs; index += 1) {
    const height = (index + random() * 0.6) / params.limbs;
    const along = params.boleFraction + (0.94 - params.boleFraction) * height;
    const angle = 1.32 - height * 0.62 + (random() - 0.5) * 0.18;
    growBranch(context, {
      clump: -1,
      depth: 1,
      direction: deviate(tangentAt(trunk.points, along), angle, azimuth + index * GOLDEN_ANGLE),
      hue: (random() - 0.5) * 1.2,
      phase: random(),
      radius: valueAt(trunk.radii, along) * 0.74,
      start: pointAlong(trunk.points, along)
    });
    addCollar(trunk, along);
  }
};

/** Oak / broadleaf: thick tapered trunk, spreading limbs, a broad irregular crown of sprays. */
export const createOakModel = (seed: number, stage: GrowthStage): TreeModel => {
  const random = createRandom(seed);
  const params = OAK_STAGES[stage];
  const model = createEmptyModel("oak", stage);
  const centre: Vec3 = [0, params.height - params.crownRadii[1] * 0.95, 0];
  const envelope = createCrownEnvelope(random, centre, params.crownRadii, 0.46);
  const context: OakContext = { clumps: [], envelope, model, nextClump: 0, params, random };
  const trunk = growTrunk(context);
  // Buttress roots belong to old trees: a sapling stands on its slightly flared foot.
  if (stage > SAPLING_STAGE) growRoots(context, trunk);
  growLimbs(context, trunk);
  shapeSubCrowns(model.foliage, context.clumps);
  model.crownCentre = centre;
  return finishModel(model);
};
