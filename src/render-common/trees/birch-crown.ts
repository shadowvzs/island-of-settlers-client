import type { Random } from "../../shared/world/rng";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { add, pointAlong, randomPerpendicular, scale, subtract } from "../props/tree-parts";
import type { BirchArchitecture, BirchSize } from "./birch-shape";
import { type CrownEnvelope, type CrownShading, getCrownShade } from "./crown-envelope";
import { createLimb, deviate, growCrookedLimbPoints, tangentAt, valueAt } from "./limb-growth";
import type { TreeModel, WoodLimb } from "./tree-model";

/**
 * Birch atlas cells (BIRCH_SPRAY_RECTS): 0-2 leaf sprays, 3 young, 4 shadow, 5-6 hanging
 * twigs. Clusters pick a cell by their role, so the variation stays clustered.
 */
const BIRCH_CELL = { hanging: 5, shadow: 4, young: 3 } as const;

export interface BirchContext {
  architecture: BirchArchitecture;
  /** Clump (sub-crown) id of every spray, parallel to model.foliage. */
  clumps: number[];
  /** Twig and leaf cluster multiplier (canopy density x the structure's foliage). */
  density: number;
  envelope: CrownEnvelope;
  model: TreeModel;
  nextClump: number;
  random: Random;
  size: BirchSize;
  /** Leaves are young (light yellow-green) on saplings and young trees. */
  youngLeaves: number;
}

interface BirchBranch {
  clump: number;
  hue: number;
  limb: WoodLimb;
  /** Length of the limb (metres). */
  length: number;
}

interface SprayRole {
  hanging: boolean;
  tip: boolean;
}

const BIRCH_SHADING: CrownShading = { base: 0.12, exponent: 1.5, gain: 0.76, lift: 0.14 };

const pickCell = (context: BirchContext, shade: number, role: SprayRole) => {
  const { random } = context;
  if (role.hanging) return BIRCH_CELL.hanging + Math.floor(random() * 2);
  if (random() < context.youngLeaves + (role.tip ? 0.12 : 0)) return BIRCH_CELL.young;
  if (shade < 0.32) return BIRCH_CELL.shadow;
  return Math.floor(random() * 3);
};

/** Card pose: along the twig with drooping tips; hanging cards face out from the crown. */
const getSprayPose = (twig: Vec3, outward: Vec3, role: SprayRole, random: Random) => {
  const side = randomPerpendicular(twig, random);
  if (role.hanging) {
    return {
      facing: normalize(add(scale(outward, 0.6), scale(side, 0.6))),
      growth: normalize(add(add(scale(twig, 0.6), [0, -1, 0]), scale(side, 0.2)))
    };
  }
  return {
    facing: normalize(add(add(scale(outward, 0.45), [0, 0.5, 0]), scale(side, 0.7))),
    growth: normalize(add(add(twig, scale(outward, 0.25)), add(scale(side, 0.5), [0, -0.18, 0])))
  };
};

const addSpray = (
  context: BirchContext,
  position: Vec3,
  twig: Vec3,
  branch: BirchBranch,
  role: SprayRole
) => {
  const { envelope, random } = context;
  const outward = normalize(subtract(position, envelope.centre));
  const shade = getCrownShade(envelope, position, BIRCH_SHADING);
  context.model.foliage.push({
    ...getSprayPose(twig, outward, role, random),
    hue: Math.max(-1, Math.min(1, branch.hue + (random() - 0.5) * 0.3)),
    outward,
    phase: branch.limb.phase + random() * 0.3,
    position,
    shade,
    size: context.size.spraySize * (0.8 + random() * 0.4),
    sway: 0.85 + random() * 0.15,
    variant: pickCell(context, shade, role)
  });
  context.clumps.push(branch.clump);
};

/** A small leaf cluster: cards along the outer twig, one more at its tip. */
const addTwigSprays = (context: BirchContext, twig: BirchBranch, hanging: boolean) => {
  const { random, size } = context;
  const step = (size.spraySize * (hanging ? 0.6 : 0.75)) / Math.max(twig.length, 0.01);
  for (let along = 0.28 + random() * step; along < 0.95; along += step * (0.8 + random() * 0.4)) {
    const position = pointAlong(twig.limb.points, along);
    addSpray(context, position, tangentAt(twig.limb.points, along), twig, { hanging, tip: false });
  }
  const tip = twig.limb.points[twig.limb.points.length - 1]!;
  addSpray(context, tip, tangentAt(twig.limb.points, 1), twig, { hanging, tip: true });
};

interface TwigSeed {
  along: number;
  hanging: boolean;
  parent: BirchBranch;
}

/** Fine twig: short with a drooping tip, or a long hanging curtain twig (weeping). */
const growTwig = (context: BirchContext, seed: TwigSeed) => {
  const { random, size } = context;
  const { parent } = seed;
  const tangent = tangentAt(parent.limb.points, seed.along);
  const turned = deviate(tangent, 0.55 + random() * 0.4, random() * Math.PI * 2);
  const length = seed.hanging
    ? size.height * (0.07 + random() * 0.07) * (0.6 + context.architecture.hanging * 0.6)
    : size.twigSize * (1.3 + random() * 1.1);
  const direction = seed.hanging ? add(scale(turned, 0.4), [0, -1, 0]) : add(turned, [0, -0.1, 0]);
  const { points } = growCrookedLimbPoints(
    {
      direction,
      elbows: [],
      length,
      lift: () => (seed.hanging ? -0.2 : -0.06),
      start: pointAlong(parent.limb.points, seed.along),
      steps: seed.hanging ? 4 : 3,
      wobble: 0.12
    },
    random
  );
  const radius = Math.max(0.0025, valueAt(parent.limb.radii, seed.along) * 0.5);
  const limb = createLimb(points, [radius, 0.0012], size.depth + 1, [0.5, 0.92], random());
  context.model.wood.push(limb);
  const twig: BirchBranch = { ...parent, length, limb };
  addTwigSprays(context, twig, seed.hanging);
};

/**
 * Outer twigs hang more often; saplings do not weep yet (the bark whitening doubles as the age:
 * a birch starts to weep as it matures).
 */
const getHangingChance = (context: BirchContext, along: number) =>
  context.architecture.hanging * context.size.whiteness ** 2 * (0.35 + along * 0.65);

/** Twigs along the outer part of a branch (outer ones hang more often) and one at its tip. */
const growTwigs = (context: BirchContext, parent: BirchBranch) => {
  const { random } = context;
  const count = Math.round((2 + parent.length * 3) * context.density);
  for (let index = 0; index <= count; index += 1) {
    const along = index === count ? 0.97 : 0.3 + (0.62 * (index + random() * 0.8)) / count;
    const hanging = random() < getHangingChance(context, along);
    growTwig(context, { along, hanging, parent });
  }
};

/** The leader's leafy top: a few twigs from the last tenth of a stem. */
export const growLeaderTwigs = (context: BirchContext, stem: WoodLimb) => {
  const { random } = context;
  context.nextClump += 1;
  const leader: BirchBranch = { clump: context.nextClump, hue: 0, length: 0, limb: stem };
  const count = 2 + Math.round(random() * 2 * context.density);
  for (let index = 0; index < count; index += 1) {
    growTwig(context, { along: 0.86 + (0.13 * index) / count, hanging: false, parent: leader });
  }
};

/** Secondary branches: thinner, angled off the primary, sagging a little more outwards. */
const growSecondaries = (context: BirchContext, primary: BirchBranch) => {
  const { architecture, random } = context;
  const count = 3 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    if (random() < 0.15) continue;
    const along = 0.22 + (0.7 * (index + random() * 0.7)) / count;
    const tangent = tangentAt(primary.limb.points, along);
    const direction = deviate(tangent, 0.5 + random() * 0.4, random() * Math.PI * 2);
    const length = primary.length * (0.44 - along * 0.2) * (0.8 + random() * 0.4);
    const { points } = growCrookedLimbPoints(
      {
        direction: add(direction, [0, -0.05 - architecture.arch * 1.5, 0]),
        elbows: [],
        length,
        lift: () => -0.03 - architecture.arch * 0.6,
        start: pointAlong(primary.limb.points, along),
        steps: 4,
        wobble: 0.08
      },
      random
    );
    const radius = valueAt(primary.limb.radii, along) * 0.6;
    const limb = createLimb(points, [radius, radius * 0.25], 2, [0.25, 0.55], random());
    context.model.wood.push(limb);
    context.nextClump += 1;
    growTwigs(context, { clump: context.nextClump, hue: primary.hue, length, limb });
  }
};

interface PrimarySeed {
  direction: Vec3;
  /** Broken off: a short stub without twigs (old trees). */
  broken: boolean;
  length: number;
  radius: number;
  start: Vec3;
}

/**
 * A slender primary branch: leaves the trunk angled up, arches out (weeping: over and down),
 * carries secondaries (mature) or twigs directly (saplings).
 */
export const growPrimary = (context: BirchContext, seed: PrimarySeed) => {
  const { architecture, random, size } = context;
  const length = seed.broken ? seed.length * 0.22 : seed.length;
  const arch = architecture.arch;
  const { points } = growCrookedLimbPoints(
    {
      direction: seed.direction,
      elbows: [],
      length,
      lift: (t) => (t < 0.35 ? 0.035 : -arch * (0.4 + t)),
      start: seed.start,
      steps: seed.broken ? 2 : 6,
      wobble: 0.05
    },
    random
  );
  const tip = seed.broken ? seed.radius * 0.7 : Math.max(0.003, seed.radius * 0.12);
  const limb = createLimb(points, [seed.radius, tip], 1, [0.04, 0.32], random());
  context.model.wood.push(limb);
  if (seed.broken) return;
  context.nextClump += 1;
  const branch = { clump: context.nextClump, hue: (random() - 0.5) * 0.8, length, limb };
  if (size.depth >= 2) growSecondaries(context, branch);
  else growTwigs(context, branch);
};
