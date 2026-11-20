import { createRandom, type Random } from "../../shared/world/rng";
import { cross, normalize, type Vec3 } from "../props/mesh-builder";
import { add, pointAlong, scale } from "../props/tree-parts";
import { type BirchContext, growLeaderTwigs, growPrimary } from "./birch-crown";
import {
  BIRCH_ARCHITECTURE,
  BIRCH_DENSITY,
  BIRCH_SIZES,
  type BirchDensity,
  type BirchSize,
  getBirchArchitecture} from "./birch-shape";
import { createCrownEnvelope } from "./crown-envelope";
import { deviate, tangentAt, taperRadii, valueAt } from "./limb-growth";
import { finishModel } from "./model-bounds";
import { shapeSubCrowns } from "./sub-crowns";
import { createEmptyModel, type GrowthStage, type TreeModel, type WoodLimb } from "./tree-model";

const GOLDEN_ANGLE = 2.39996;
const UP: Vec3 = [0, 1, 0];

/** Multi-trunk clump: radius and height of each further stem relative to the first. */
const STEM_RADIUS = [1, 0.78, 0.64, 0.55];
const STEM_HEIGHT = [1, 0.9, 0.82, 0.74];

interface Stem {
  crownRadius: number;
  height: number;
  limb: WoodLimb;
}


/**
 * Trunk spline (control points along the stem): nearly vertical at the base, the middle offset
 * by a few percent of the height, the top curving back and a little sideways. Gradual, never an
 * S-curve or zig-zag.
 */
const growStemAxis = (
  start: Vec3,
  direction: Vec3,
  length: number,
  curvature: number,
  random: Random,
  count: number
) => {
  const helper: Vec3 = Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const side = normalize(cross(direction, helper));
  const turn = random() * Math.PI * 2;
  const first = add(scale(side, Math.cos(turn)), scale(cross(direction, side), Math.sin(turn)));
  const second = normalize(cross(direction, first));
  const middle = length * curvature * (1 + random() * 0.6);
  const top = length * curvature * (random() - 0.5);
  return Array.from({ length: count }, (_, index): Vec3 => {
    const t = index / (count - 1);
    const bow = middle * Math.sin(Math.PI * t) * Math.pow(t, 0.6);
    const lean = top * Math.pow(t, 2.5);
    return add(
      add(start, scale(direction, length * t - (index === 0 ? 0.05 : 0))),
      add(scale(first, bow), scale(second, lean))
    );
  });
};

/**
 * Stems share one crown: each carries primaries / stems^0.75, so a four-stem clump has about as
 * much wood as two stems (and stays within the island triangle budget).
 */
const STEM_SHARE_EXPONENT = 0.75;

/** Spline points of a stem: short saplings 5, the main stem 8, thinner side stems 6. */
const getStemPoints = (height: number, index: number) => {
  if (height < 2) return 5;
  return index === 0 ? 8 : 6;
};

/** One stem: tapered all the way into a thin leader, with a little root flare. */
const growStem = (context: BirchContext, index: number, count: number): Stem => {
  const { architecture, random, size } = context;
  const angle = index === 0 && count === 1 ? 0 : 0.1 + random() * 0.2;
  const azimuth = (index / count) * Math.PI * 2 + random() * 0.6;
  const offset = index === 0 ? 0 : size.trunkRadius * (1.4 + random() * 0.6);
  const start: Vec3 = [Math.cos(azimuth) * offset, 0, Math.sin(azimuth) * offset];
  const direction = deviate(UP, angle, azimuth);
  const height = size.height * architecture.height * STEM_HEIGHT[index]!;
  const radius = size.trunkRadius * architecture.thickness * STEM_RADIUS[index]!;
  const points = growStemAxis(
    start,
    direction,
    height,
    architecture.curvature,
    random,
    getStemPoints(height, index)
  );
  const limb: WoodLimb = {
    depth: 0,
    phase: random(),
    points,
    radii: taperRadii(points.length, radius, Math.max(0.003, radius * 0.07), 0.85),
    sway: [0, 0.05]
  };
  limb.radii[0]! *= 1.3;
  limb.radii[1]! *= 1.06;
  context.model.wood.push(limb);
  const crownRadius = size.crownRadius * architecture.crownWidth * (count > 1 ? 0.75 : 1);
  return { crownRadius, height, limb };
};

/** Birch crown outline: an irregular oval, widest low in the crown, narrow at the top. */
const getCrownProfile = (context: BirchContext, height: number) => {
  const oval = 0.3 + 0.7 * Math.max(0, Math.sin(Math.PI * (0.25 + 0.75 * height)));
  return oval * (1 - height * context.architecture.arch * 3);
};

/** Primaries spiral up the stem; the lower ones spread wider, the upper ones climb steeper. */
const growPrimaries = (context: BirchContext, stem: Stem, count: number) => {
  const { architecture, random, size } = context;
  const azimuth = random() * Math.PI * 2;
  const leaning = random() * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    const height = (index + 0.3 + random() * 0.5) / count;
    const along = size.crownBase + (0.94 - size.crownBase) * height;
    const around = azimuth + index * GOLDEN_ANGLE + (random() - 0.5) * 0.5;
    const angle = architecture.branchAngle * (1 - height * 0.45) + (random() - 0.5) * 0.15;
    const lopsided = 1 + architecture.asymmetry * Math.cos(around - leaning);
    growPrimary(context, {
      broken: architecture.brokenBranch && index === 1,
      direction: deviate(tangentAt(stem.limb.points, along), angle, around),
      length: stem.crownRadius * getCrownProfile(context, height) * lopsided * 1.15,
      radius: Math.max(0.004, valueAt(stem.limb.radii, along) * (0.36 + random() * 0.06)),
      start: pointAlong(stem.limb.points, along)
    });
  }
  growLeaderTwigs(context, stem.limb);
};

interface BirchLook {
  density: BirchDensity;
  form: number;
}

const createContext = (model: TreeModel, size: BirchSize, look: BirchLook, random: Random) => {
  const architecture = getBirchArchitecture(look.form);
  const height = size.height * architecture.height;
  const crownHeight = height * (1 - size.crownBase);
  const wide = size.crownRadius * architecture.crownWidth * (architecture.stems[1] > 1 ? 1.35 : 1);
  const centre: Vec3 = [0, height - crownHeight * 0.5, 0];
  const envelope = createCrownEnvelope(random, centre, [wide, crownHeight * 0.55, wide], 0.35);
  const context: BirchContext = {
    architecture,
    clumps: [],
    density: BIRCH_DENSITY[look.density] * architecture.foliage,
    envelope,
    model,
    nextClump: 0,
    random,
    size,
    youngLeaves: architecture === BIRCH_ARCHITECTURE.young || size.whiteness < 0.5 ? 0.45 : 0.06
  };
  model.crownCentre = centre;
  model.bark = { roughBase: architecture.roughBase, whiteness: size.whiteness };
  return context;
};

/**
 * Silver birch: slender white stem(s), fine arching branches, an airy crown of small clusters.
 * form: the prop form byte (BIRCH structure), density: the canopy density option.
 */
export const createBirchModel = (
  seed: number,
  stage: GrowthStage,
  form = 0,
  density: BirchDensity = "medium"
): TreeModel => {
  const random = createRandom(seed);
  const size = BIRCH_SIZES[stage];
  const model = createEmptyModel("birch", stage);
  const context = createContext(model, size, { density, form }, random);
  const [fewest, most] = context.architecture.stems;
  const stems = fewest + Math.floor(random() * (most - fewest + 1));
  const primaries = Math.round(
    (size.primaries * context.architecture.primaries) / Math.pow(stems, STEM_SHARE_EXPONENT)
  );
  for (let index = 0; index < stems; index += 1) {
    growPrimaries(context, growStem(context, index, stems), Math.max(3, primaries));
  }
  shapeSubCrowns(model.foliage, context.clumps);
  return finishModel(model);
};

