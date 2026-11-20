import { createRandom, type Random } from "../../../shared/world/rng";
import { BARK_FAMILY, getLimbAlong, toBarkUv } from "../../trees/bark-uv";
import { OAK_SPRAY_RECTS } from "../../trees/foliage-atlas";
import { addBlob, MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { shaded } from "../plants/plant-colors";
import { addBlade, addStemTube, type Attach, branchFrom, getTip, growStem, type Stem } from "../plants/plant-parts";
import { add, addCurvedTube, addLeafCard, scale } from "../tree-parts";
import { addLathe, addStaticBox, ovoidProfile, solid } from "./crop-mesh-parts";
import { addVineLeaf, createVineLeafOutline } from "./vine-leaf";

/**
 * Trellised grapevine row of one vineyard cell (prop space, one unit = one cell, row along x):
 * three gnarled vines (oak bark relief, knots) on a post-and-wire trellis, cordon arms along the
 * lower wire and canes up to the top wire carrying alternate five-lobed serrated leaves (High:
 * geometry leaves and curly tendrils; Minimal: leaf cards from the island atlas). The trellis
 * never moves; canes bend in the shared vegetation wind and the leaves flutter. Each stage
 * exists in VINE_VARIANTS seeds, so neighbouring rows are never clones.
 */
export type VineStage = "dormant" | "budding" | "leafy";
export const VINE_VARIANTS = 3;
const VINE_POSITIONS = [-0.24, 0, 0.24] as const;
const POST_X = 0.39;
const WIRE_HEIGHTS = [0.4, 0.62] as const;
const TRUNK_TOP = 0.39;
const CORDON_LENGTH = 0.115;
const VINE_BARK: Vec3 = [0.3, 0.22, 0.16];
const CANE: Vec3 = [0.46, 0.4, 0.22];
/** Weathered, silver-grey oak posts. */
const POST: Vec3 = [0.56, 0.54, 0.5];
const SOIL: Vec3 = [0.42, 0.33, 0.23];
const GRASS: Vec3 = [0.42, 0.56, 0.2];
const WIRE: Vec3 = [0.34, 0.34, 0.33];
const LEAF_GREENS: readonly Vec3[] = [[0.3, 0.5, 0.13], [0.38, 0.56, 0.14], [0.46, 0.58, 0.16], [0.28, 0.44, 0.12]];
/** Minimal leaf cards: the island's lobed atlas sprays in fresh vine green. */
const CARD_TINT: Vec3 = [1.12, 1.28, 0.76];
/** Bunches are drawn larger than life so they read at the RTS distance. */
const BUNCH_READABILITY = 1.7;
/** Berries are baked light and tinted per instance (green while swelling, purple when ripe). */
const BERRY: Vec3 = [0.94, 0.92, 0.94];

interface VinePlant {
  cordons: Stem[];
  trunk: Stem;
}

/**
 * Weathered posts, the cordon and catch wires, a stake and a soil mound at every vine: static
 * carpentry (only the grass round the trunk feet moves).
 */
export const createVineTrellisMesh = (detailed: boolean) => {
  const builder = new MeshBuilder(), random = createRandom(71);
  for (const x of [-POST_X, POST_X]) {
    addStaticBox(builder, [x, 0.35, 0], [0.04, 0.76, 0.04], solid(POST, random, 0.15));
    if (detailed) addStaticBox(builder, [x, 0.62, 0], [0.034, 0.03, 0.1], solid([0.42, 0.36, 0.28]));
  }
  for (const height of WIRE_HEIGHTS) addStaticBox(builder, [0, height, 0], [POST_X * 2, 0.005, 0.005], solid(WIRE));
  if (detailed) for (const z of [-0.045, 0.045])
    addStaticBox(builder, [0, WIRE_HEIGHTS[1], z], [POST_X * 2, 0.004, 0.004], solid(WIRE));
  if (detailed) for (const x of VINE_POSITIONS)
    addStaticBox(builder, [x + 0.02, 0.22, -0.02], [0.012, 0.44, 0.012], solid([0.54, 0.5, 0.44], random));
  for (const x of VINE_POSITIONS) addTrunkFoot(builder, x, detailed, random);
  return builder.finish({ flex: 0.3 });
};

/** A low hilled-up soil mound round a trunk foot, with a few grass blades on High. */
const addTrunkFoot = (builder: MeshBuilder, x: number, detailed: boolean, random: Random) => {
  addBlob(builder, [x, -0.005, 0], [0.08, 0.025, 0.065], 0.25, random, solid(SOIL, random, 0.14));
  if (!detailed) return;
  for (let blade = 0; blade < 5; blade += 1) {
    const angle = random() * Math.PI * 2;
    addBlade(builder, { path: 0, position: [x + Math.cos(angle) * 0.07, 0, Math.sin(angle) * 0.06] }, {
      arch: 0.6, azimuth: angle, lean: 0.3, length: 0.05 + random() * 0.04, segments: 2, tipFlutter: 0.6, width: 0.01
    }, shaded(GRASS, random));
  }
};

/** A gnarled trunk (wobbling, knotted) and two cordon arms trained along the lower wire. */
const growVinePlant = (x: number, random: Random): VinePlant => {
  const trunk = growStem({ bend: 0.3, direction: [random() * 0.3 - 0.15, 1, random() * 0.2 - 0.1],
    length: TRUNK_TOP, start: [x, -0.01, 0], steps: 6, wobble: 0.32 }, random);
  const top: Attach = getTip(trunk);
  const cordons = [-1, 1].map(side => branchFrom(top, { bend: 0.01, direction: [side, 0.04, 0],
    length: CORDON_LENGTH * (0.85 + random() * 0.3), steps: 4, wobble: 0.08 }, random));
  return { cordons, trunk };
};

/** Bark relief (oak family of the prop shader) on a tube whose radius swells at knots. */
const addGnarledTube = (builder: MeshBuilder, stem: Stem, radii: [number, number], sides: number, random: Random) => {
  const knots = stem.points.map((_, index) => {
    const t = index / (stem.points.length - 1);
    return (radii[0] + (radii[1] - radii[0]) * t) * (index > 0 && random() < 0.3 ? 1.35 : 0.92 + random() * 0.16);
  });
  const along = getLimbAlong(stem.points, knots);
  addCurvedTube(builder, stem.points, knots, sides, shaded(VINE_BARK, random, { floor: 0.7, reach: 0.12 }), stem.paths,
    (index, around) => toBarkUv(around, along[index]!, BARK_FAMILY.oak));
};

const addVineWood = (builder: MeshBuilder, plant: VinePlant, detailed: boolean, random: Random) => {
  addGnarledTube(builder, plant.trunk, [0.024, 0.016], detailed ? 7 : 4, random);
  for (const cordon of plant.cordons) addGnarledTube(builder, cordon, [0.015, 0.008], detailed ? 5 : 3, random);
};

/** A curly tendril (High): a small helix at the end of a cane. */
const addTendril = (builder: MeshBuilder, at: Attach, random: Random) => {
  const turns = 1.5 + random(), points: Vec3[] = [], radius = 0.012;
  for (let step = 0; step <= 5; step += 1) {
    const angle = (step / 5) * turns * Math.PI * 2;
    points.push(add(at.position, [Math.cos(angle) * radius, step * 0.009, Math.sin(angle) * radius]));
  }
  addStemTube(builder, { paths: points.map((_, index) => at.path + index * 0.01), points }, [0.0018, 0.001], 3,
    solid(CANE));
};

interface CaneOptions {
  detailed: boolean;
  direction: Vec3;
  leaves: number;
  length: number;
  size: number;
  /** Upright canes show their stem and (High) may end in a tendril. */
  tendril: boolean;
}

/** A cane from a cordon spur with alternate leaves along it (geometry on High, cards on Minimal). */
const addCane = (builder: MeshBuilder, spur: Attach, options: CaneOptions, outline: ReturnType<typeof createVineLeafOutline>,
  random: Random) => {
  const cane = branchFrom(spur, { bend: -0.03, direction: options.direction, length: options.length, steps: 4,
    wobble: 0.22 }, random);
  if (options.detailed && options.tendril) addStemTube(builder, cane, [0.0045, 0.0025], 3, shaded(CANE, random));
  for (let leaf = 0; leaf < options.leaves; leaf += 1) {
    const fraction = (leaf + 0.6) / options.leaves;
    const index = Math.min(cane.points.length - 1, Math.round(fraction * (cane.points.length - 1)));
    const attach: Attach = { path: cane.paths[index]!, position: cane.points[index]! };
    const side = leaf % 2 ? 1 : -1;
    const facing = normalize([random() - 0.5, 0.45 + random() * 0.3, side * (0.7 + random() * 0.3)]);
    const size = options.size * (0.75 + random() * 0.45);
    if (options.detailed) {
      addVineLeaf(builder, attach, outline, { facing, green: LEAF_GREENS[Math.floor(random() * LEAF_GREENS.length)]!,
        size }, random);
      continue;
    }
    const cell = OAK_SPRAY_RECTS[Math.floor(random() * OAK_SPRAY_RECTS.length)]!, tone = 0.86 + random() * 0.26;
    addLeafCard(builder, attach.position, { cell, growth: normalize(add(scale(facing, 0.9), [0, 0.6, 0])),
      outward: facing, size: size * 2.4 }, random,
    { color: () => [CARD_TINT[0] * tone, CARD_TINT[1] * tone, CARD_TINT[2] * tone], flutter: 1 }, attach.path);
  }
  if (options.detailed && options.tendril && random() < 0.5) addTendril(builder, getTip(cane), random);
};

const getCaneLeafCount = (budding: boolean, detailed: boolean) => {
  if (budding) return 2;
  return detailed ? 5 : 3;
};

/** Spurs along both cordons, each sending canes up to the catch wires and out over the row. */
const addCanopy = (builder: MeshBuilder, plant: VinePlant, stage: VineStage, detailed: boolean, random: Random) => {
  const outline = createVineLeafOutline(detailed ? 16 : 10), budding = stage === "budding";
  const caneLeaves = getCaneLeafCount(budding, detailed);
  for (const cordon of plant.cordons) for (const along of detailed ? [0.25, 0.6, 0.95] : [0.4, 1]) {
    const index = Math.round(along * (cordon.points.length - 1));
    const spur: Attach = { path: cordon.paths[index]!, position: cordon.points[index]! };
    addCane(builder, spur, { detailed, direction: [random() * 0.3 - 0.15, 1, random() * 0.4 - 0.2],
      leaves: caneLeaves, length: budding ? 0.08 : 0.3 + random() * 0.08,
      size: budding ? 0.05 : 0.1, tendril: !budding }, outline, random);
    if (budding) continue;
    for (const side of detailed ? [-1, 1] : [random() > 0.5 ? 1 : -1])
      addCane(builder, spur, { detailed, direction: [random() - 0.5, 0.1, side], leaves: detailed ? 2 : 1,
        length: 0.13, size: 0.08, tendril: false }, outline, random);
  }
};

/** One row at a stage: bare winter wood, budding spurs or the full summer canopy. */
export const createGrapevineMesh = (stage: VineStage, detailed: boolean, variant = 0) => {
  const builder = new MeshBuilder(), random = createRandom(5 + variant * 977);
  for (const x of VINE_POSITIONS) {
    const plant = growVinePlant(x + (random() - 0.5) * 0.03, random);
    addVineWood(builder, plant, detailed, random);
    if (stage !== "dormant") addCanopy(builder, plant, stage, detailed, random);
  }
  return builder.finish({ contactRadius: 0.3, flex: 0.35 });
};

/** Berry rings of a tapered conical bunch, shoulder to tip (High). */
const BUNCH_RINGS = [5, 4, 3, 2, 1] as const;

const addBerryBunch = (builder: MeshBuilder, top: Vec3, size: number, random: Random, color = BERRY) => {
  const berryRadius = 0.0115 * size, wind = () => ({ flutter: 0, path: 0.45 });
  BUNCH_RINGS.forEach((count, ring) => {
    const radius = (0.024 - ring * 0.005) * size, y = top[1] - (0.012 + ring * 0.019) * size;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + ring * 0.7 + random() * 0.4;
      addLathe(builder, { centre: [top[0] + Math.cos(angle) * radius, y - berryRadius, top[2] + Math.sin(angle) * radius],
        profile: ovoidProfile(berryRadius, berryRadius * 2.05, 3), segments: 5, wind }, solid(color, random, 0.1));
    }
  });
};

/**
 * Grape bunches hanging below the canopy under both cordons of one vine (the harvest empties the
 * vines in turn). `ripeSize` 1 is a ripe bunch; the swelling stage uses a smaller copy. High
 * builds round berries, Minimal one tapered body per bunch.
 */
export const createGrapeBunchMesh = (ripeSize: number, detailed: boolean, vine: number, seed = 5) => {
  const size = ripeSize * BUNCH_READABILITY;
  const builder = new MeshBuilder(), random = createRandom(seed + 13 + vine);
  const x = VINE_POSITIONS[vine]!;
  for (const side of [-1, 1]) {
    const top: Vec3 = [x + side * (0.06 + random() * 0.02), TRUNK_TOP - 0.015, side * 0.05];
    addStaticBox(builder, add(top, [0, 0.01, 0]), [0.003, 0.02, 0.003], solid(CANE));
    if (detailed) { addBerryBunch(builder, top, size, random); continue; }
    addLathe(builder, { centre: add(top, [0, -0.1 * size, 0]), profile: [[0, 0], [0.018 * size, 0.03 * size],
      [0.03 * size, 0.07 * size], [0.026 * size, 0.09 * size], [0, 0.1 * size]], segments: 5,
    wind: () => ({ flutter: 0, path: 0.45 }) }, solid(BERRY, random, 0.12));
  }
  return builder.finish({ flex: 0.35 });
};

export const VINE_TINTS = {
  ripe: [0.24, 0.07, 0.3] as Vec3,
  unripe: [0.56, 0.72, 0.3] as Vec3
};

/** One harvested bunch, using the same authored berries as the vineyard rather than a new icon. */
export const createHeldGrapeBunchMesh = (detailed: boolean) => {
  const builder = new MeshBuilder(), random = createRandom(18);
  addStaticBox(builder, [0, .008, 0], [.004, .022, .004], solid(CANE));
  if (detailed) addBerryBunch(builder, [0, 0, 0], BUNCH_READABILITY, random, [.24, .07, .3]);
  else addLathe(builder, { centre: [0, -.1 * BUNCH_READABILITY, 0],
    profile: [[0, 0], [.018 * BUNCH_READABILITY, .03 * BUNCH_READABILITY],
      [.03 * BUNCH_READABILITY, .07 * BUNCH_READABILITY], [0, .1 * BUNCH_READABILITY]], segments: 5 },
    solid([.24, .07, .3], random, .1));
  return builder.finish();
};
