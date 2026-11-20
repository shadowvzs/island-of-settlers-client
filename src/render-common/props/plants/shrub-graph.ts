import type { Random } from "../../../shared/world/rng";
import type { AtlasRect } from "../../trees/foliage-atlas";
import { type MeshBuilder, normalize, type Vec3, type VertexStyle } from "../mesh-builder";
import { add, addLeafCard, fromAngles, randomPerpendicular, scale, subtract } from "../tree-parts";
import {
  addStemTube,
  type Attach,
  attachAlong,
  branchFrom,
  getHeading,
  getTip,
  growStem,
  type Stem
} from "./plant-parts";

const GOLDEN_ANGLE = 2.39996;

type Range = readonly [number, number];

/** Branch graph recipe of a woody plant: primary stems, secondary branches, foliage points. */
export interface ShrubShape {
  /** Fraction of a primary below its first branch (bare lower stem). */
  branchStart: number;
  /** Primary stem elevation above the horizon, radians. */
  elevation: Range;
  foliagePerBranch: Range;
  primaries: Range;
  primaryLength: Range;
  /** Spread of the stem origins around the root (clustered, not one point). */
  rootSpread: number;
  /** Upward pull of secondaries per step (negative: drooping tips). */
  secondaryBend: number;
  secondaries: Range;
  secondaryLength: Range;
  /** Crown stretch along x: asymmetric, broader-than-deep silhouettes. */
  stretch: number;
  /** Twig length range (world units) of the leaf-bearing twigs. */
  twigLength: Range;
  /** Leaf-bearing twigs forking off each secondary branch. */
  twigs: Range;
}

/** A spray's attachment: where it sits and the direction of the wood it grows from. */
export interface FoliagePoint extends Attach {
  heading: Vec3;
}

export interface ShrubGraph {
  foliage: FoliagePoint[];
  primaries: Stem[];
  secondaries: Stem[];
  /** Secondary branch ends (berries, buds). */
  tips: Attach[];
  /** Fine leaf-bearing twigs. */
  twigs: Stem[];
}

const pick = (range: Range, random: Random) => range[0] + random() * (range[1] - range[0]);
const count = (range: Range, random: Random) => Math.round(pick(range, random));

const foliageAt = (stem: Stem, fraction: number): FoliagePoint => ({
  ...attachAlong(stem, fraction),
  heading: getHeading(stem, fraction)
});

/** Short twigs forking off the outer part of a branch, each ending in a leaf spray. */
const growTwigs = (branch: Stem, shape: ShrubShape, random: Random, graph: ShrubGraph) => {
  const twigs = count(shape.twigs, random);
  for (let index = 0; index < twigs; index += 1) {
    const fraction = 0.4 + (0.55 * (index + random() * 0.6)) / Math.max(1, twigs);
    const heading = getHeading(branch, fraction);
    const out = scale(randomPerpendicular(heading, random), 0.9);
    const twig = branchFrom(
      attachAlong(branch, fraction),
      {
        bend: 0.02,
        direction: normalize(add(add(heading, out), [0, 0.3, 0])),
        length: pick(shape.twigLength, random),
        steps: 1,
        wobble: 0.1
      },
      random
    );
    graph.twigs.push(twig);
    graph.foliage.push(foliageAt(twig, 1));
  }
};

const growSecondaries = (primary: Stem, shape: ShrubShape, random: Random, graph: ShrubGraph) => {
  const branches = count(shape.secondaries, random);
  for (let index = 0; index < branches; index += 1) {
    const fraction =
      shape.branchStart + ((index + random() * 0.7) / branches) * (0.95 - shape.branchStart);
    const heading = getHeading(primary, fraction);
    const out = randomPerpendicular(heading, random);
    const direction = normalize(add(add(heading, scale(out, 1.2)), [0, 0.2, 0]));
    const branch = branchFrom(
      attachAlong(primary, fraction),
      {
        bend: shape.secondaryBend,
        direction,
        length: pick(shape.secondaryLength, random) * (1.1 - fraction * 0.4),
        steps: 3,
        wobble: 0.15
      },
      random
    );
    graph.secondaries.push(branch);
    graph.tips.push(getTip(branch));
    const leaves = count(shape.foliagePerBranch, random);
    for (let leaf = 0; leaf < leaves; leaf += 1) {
      graph.foliage.push(foliageAt(branch, 0.35 + (0.65 * (leaf + 1)) / leaves));
    }
    growTwigs(branch, shape, random, graph);
  }
};

/** Grows the branch graph: it exists even where foliage hides it (wind, silhouette, light). */
export const growShrubGraph = (shape: ShrubShape, random: Random): ShrubGraph => {
  const graph: ShrubGraph = { foliage: [], primaries: [], secondaries: [], tips: [], twigs: [] };
  const primaries = count(shape.primaries, random);
  const turn = random() * Math.PI * 2;
  for (let index = 0; index < primaries; index += 1) {
    const azimuth = turn + index * GOLDEN_ANGLE + (random() - 0.5) * 0.5;
    const raw = fromAngles(azimuth, pick(shape.elevation, random));
    const direction = normalize([raw[0] * shape.stretch, raw[1], raw[2]]);
    const start: Vec3 = [
      (random() - 0.5) * shape.rootSpread,
      -0.02,
      (random() - 0.5) * shape.rootSpread
    ];
    const primary = growStem(
      {
        bend: 0.06,
        direction,
        length: pick(shape.primaryLength, random),
        start,
        steps: 4,
        wobble: 0.12
      },
      random
    );
    graph.primaries.push(primary);
    graph.foliage.push(foliageAt(primary, 1));
    growSecondaries(primary, shape, random, graph);
  }
  return graph;
};

export interface WoodStyle {
  /** Primary radius at the root; secondaries start at 45 % of it. */
  radius: number;
  style: VertexStyle;
}

/**
 * Wood tapers without steps: a secondary starts at the radius its primary has at the fork, a twig
 * at the end radius of its branch. Every level stays in the core LOD (Minimal too): the sprays sit
 * on the twigs, and dropping wood would leave leaves floating.
 */
export const addShrubWood = (builder: MeshBuilder, graph: ShrubGraph, wood: WoodStyle) => {
  for (const stem of graph.primaries) {
    addStemTube(builder, stem, [wood.radius, wood.radius * 0.3], 4, wood.style);
  }
  for (const stem of graph.secondaries) {
    addStemTube(builder, stem, [wood.radius * 0.45, wood.radius * 0.15], 3, wood.style);
  }
  for (const stem of graph.twigs) {
    addStemTube(builder, stem, [wood.radius * 0.2, wood.radius * 0.08], 3, wood.style);
  }
};

const centreOf = (points: Attach[]) =>
  scale(
    points.reduce<Vec3>((sum, point) => add(sum, point.position), [0, 0, 0]),
    1 / Math.max(1, points.length)
  );

export interface CardFoliage {
  cell: AtlasRect;
  /** Card size range (world units). */
  size: Range;
  tint: Vec3;
}

/**
 * Card tint: darker inside the crown and below (where stems enter the foliage), lighter outside
 * and on top; each card picks a dark / base / sunlit tone (about 20 / 60 / 20 %).
 */
const pickCardTone = (random: Random) => {
  const roll = random();
  if (roll < 0.2) return 0.78;
  return roll > 0.8 ? 1.16 : 1;
};

const cardTint = (centre: Vec3, radius: number, tint: Vec3, random: Random): VertexStyle => {
  const tone = pickCardTone(random);
  return {
    color: (position) => {
      const offset = subtract(position, centre);
      const outside = Math.min(1, Math.hypot(...offset) / radius);
      const factor = (0.7 + outside * 0.32 + offset[1] * 0.25) * tone * (0.94 + random() * 0.12);
      return [tint[0] * factor, tint[1] * factor, tint[2] * factor];
    },
    flutter: 1
  };
};

/** Spray card fold (share of the half width): the leaves on both sides of the twig rise. */
const SPRAY_FOLD = 0.4;
/** The card's painted shoot starts this share of the card behind the twig end it continues. */
const SPRAY_ANCHOR = 0.04;

/**
 * Card pose: the painted shoot continues the wood it sits on (turned a little outwards and up),
 * the leaves face out of the crown and up towards the light, each at its own turn.
 */
const getSprayPose = (point: FoliagePoint, centre: Vec3, random: Random) => {
  const outward = normalize(add(subtract(point.position, centre), [0, 0.3, 0]));
  const growth = normalize(add(add(point.heading, scale(outward, 0.45)), [0, 0.12, 0]));
  const turn = scale(randomPerpendicular(growth, random), 0.6);
  return { facing: normalize(add(add(outward, [0, 0.7, 0]), turn)), growth, outward };
};

/**
 * Leaf sprays on the foliage points, attached to their twig and growing on along it, folded along
 * the painted shoot for volume; every third is LOD detail.
 */
export const addFoliageCards = (
  builder: MeshBuilder,
  points: FoliagePoint[],
  foliage: CardFoliage,
  random: Random
) => {
  const centre = centreOf(points);
  const radius = Math.max(
    0.05,
    ...points.map((point) => Math.hypot(...subtract(point.position, centre)))
  );
  points.forEach((point, index) => {
    builder.detail = index % 3 === 2;
    const pose = getSprayPose(point, centre, random);
    const size = pick(foliage.size, random);
    const style = cardTint(centre, radius, foliage.tint, random);
    addLeafCard(
      builder,
      point.position,
      { anchor: SPRAY_ANCHOR, cell: foliage.cell, fold: SPRAY_FOLD, ...pose, size },
      random,
      style,
      point.path
    );
  });
  builder.detail = false;
};
