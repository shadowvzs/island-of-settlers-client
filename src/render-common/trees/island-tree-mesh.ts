import { smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import {
  MeshBuilder,
  normalize,
  type PropMesh,
  type Vec3,
  type VertexStyle
} from "../props/mesh-builder";
import { add, addCurvedTube, addLeafCard, scale, subtract, type TubeUv } from "../props/tree-parts";
import { getLimbAlong, toBarkUv } from "./bark-uv";
import { createBirchBarkUv, createBirchWoodStyle } from "./birch-wood";
import { applyTreeWind, createConiferBarkUv, createConiferWoodStyle } from "./conifer-wood";
import {
  type AtlasRect,
  BIRCH_SPRAY_RECTS,
  BROADLEAF_SPRAY_RECTS,
  CHERRY_SPRAY_VARIANT,
  LEAF_SPRAY_RECTS,
  NEEDLE_SPRAY_RECTS,
  OAK_SPRAY_RECTS} from "./foliage-atlas";
import { createPalmIslandMesh } from "./palm-island-mesh";
import { findTreeJunction } from "./tree-junction";
import { type FoliageSpray, SAPLING_STAGE, type TreeModel, type TreeSpecies, type WoodLimb } from "./tree-model";

/** What an island tree keeps of the full model (it is seen from far above, at a few cells). */
interface IslandDetail {
  /** Bark tone in the island's display space. */
  bark: Vec3;
  /**
   * Relief bark (Three draws furrows from the bark uv; others keep the plain tone) and wood
   * darkened inside the crown and at the foot.
   */
  barkRelief: boolean;
  /**
   * Card scatter (0 none): growth direction tilt, size spread and a sideways shift (in card
   * sizes), so neighbouring cards do not stamp the same silhouette on the same spot.
   */
  cardScatter: number;
  /** Wood levels from here on are LOD detail: Three draws them only close up. */
  detailWoodDepth: number;
  /** Spray cards kept; the others are absorbed by growing the kept ones. */
  maxSprays: number;
  /** Deepest wood level drawn (twigs hide inside the foliage). */
  maxWoodDepth: number;
  /** Tube sides per wood level (trunk, limbs, branches). */
  sides: number[];
  /** Share of spray cards that turn yellow (a few ageing leaves). */
  yellowing: number;
}

const DETAIL: Record<TreeSpecies, IslandDetail> = {
  oak: {
    bark: [0.56, 0.5, 0.42],
    barkRelief: true,
    cardScatter: 0.45,
    detailWoodDepth: 2,
    maxSprays: 480,
    maxWoodDepth: 2,
    sides: [7, 5, 3],
    yellowing: 0.008
  },
  palm: {
    bark: [0.52, 0.48, 0.41],
    barkRelief: false,
    cardScatter: 0,
    detailWoodDepth: 1,
    maxSprays: 0,
    maxWoodDepth: 0,
    sides: [7],
    yellowing: 0
  },
  pine: {
    bark: [0.42, 0.26, 0.17],
    barkRelief: true,
    cardScatter: 0,
    detailWoodDepth: 2,
    maxSprays: 700,
    maxWoodDepth: 2,
    sides: [7, 3, 3],
    yellowing: 0
  },
  birch: {
    bark: [1, 1, 1],
    barkRelief: true,
    cardScatter: 0.3,
    detailWoodDepth: 2,
    maxSprays: 330,
    maxWoodDepth: 2,
    sides: [8, 5, 3],
    yellowing: 0.006
  }
};

/** Spray atlas cells per species (palms have fronds instead). */
const SPRAY_CELLS: Record<TreeSpecies, AtlasRect[]> = {
  birch: BIRCH_SPRAY_RECTS,
  oak: BROADLEAF_SPRAY_RECTS,
  palm: OAK_SPRAY_RECTS,
  pine: NEEDLE_SPRAY_RECTS
};

const ROOT_SIDES = 4;
/** Bark furrows spiral a little around the trunk (twisted grain). */
const TRUNK_TWIST = 0.1;

type Transform = (point: Vec3) => Vec3;

const solid = (color: Vec3, random: Random, flutter: number): VertexStyle => ({
  color: () => {
    const jitter = 0.9 + random() * 0.2;
    return [color[0] * jitter, color[1] * jitter, color[2] * jitter];
  },
  flutter
});

const YELLOWED: Vec3 = [1.2, 1.02, 0.5];

/**
 * Per card colour, the same look as the 3D shader's instance tint: the sunlit outer skin is
 * lighter and warmer, the shaded inside darker and bluer, the hue shifts per branch, and a few
 * cards turn yellow.
 */
const getSprayTint = (spray: FoliageSpray, yellowed: boolean): Vec3 => {
  const light = 0.42 + spray.shade * 0.68;
  const sun = spray.shade;
  const warm = Math.max(spray.hue, 0);
  const cool = Math.max(-spray.hue, 0);
  const tint: Vec3 = [
    light * (1 + warm * 0.12 - cool * 0.14 + sun * 0.04 - (1 - sun) * 0.08),
    light * (1 + warm * 0.05 - cool * 0.02 + sun * 0.02),
    light * (1 - warm * 0.25 + cool * 0.05 - sun * 0.06 + (1 - sun) * 0.14)
  ];
  if (!yellowed) return tint;
  return [tint[0] * YELLOWED[0], tint[1] * YELLOWED[1], tint[2] * YELLOWED[2]];
};

/**
 * Wood inside the crown sits in the leaves' shade, and the trunk foot is darker (damp soil,
 * moss): a cheap baked occlusion (model space, metres).
 */
const createWoodShade = (model: TreeModel) => {
  const centre = model.crownCentre;
  const radius = Math.max(model.bounds.radius * 0.85, 0.01);
  const height = Math.max(model.bounds.height - centre[1], 0.01);
  return (point: Vec3) => {
    const crown = Math.hypot(
      (point[0] - centre[0]) / radius,
      (point[1] - centre[1]) / height,
      (point[2] - centre[2]) / radius
    );
    const inside = 0.82 + 0.18 * smoothstep(0.35, 1.1, crown);
    return inside * (0.88 + 0.12 * smoothstep(0, 0.9, point[1]));
  };
};

/** Bark relief coordinates: around the limb (twisted on the trunk), along it in circumferences. */
const createBarkUv = (limb: WoodLimb): TubeUv => {
  const along = getLimbAlong(limb.points, limb.radii);
  const twist = limb.depth === 0 ? TRUNK_TWIST : 0;
  return (index, around) => toBarkUv(around + along[index]! * twist, along[index]!);
};

/** Primary limbs drop points where they run nearly straight (the elbows and bends stay). */
const MIN_LIMB_TURN = 0.1;

const getTurn = (previous: Vec3, point: Vec3, next: Vec3) => {
  const before = normalize(subtract(point, previous));
  const after = normalize(subtract(next, point));
  const cosine = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
  return Math.acos(Math.min(1, Math.max(-1, cosine)));
};

const dropStraightPoints = (limb: WoodLimb): WoodLimb => {
  const kept = [0];
  for (let index = 1; index < limb.points.length - 1; index += 1) {
    const previous = limb.points[kept[kept.length - 1]!]!;
    const turn = getTurn(previous, limb.points[index]!, limb.points[index + 1]!);
    if (turn >= MIN_LIMB_TURN) kept.push(index);
  }
  kept.push(limb.points.length - 1);
  return {
    ...limb,
    points: kept.map((index) => limb.points[index]!),
    radii: kept.map((index) => limb.radii[index]!)
  };
};

/**
 * LOD detail branches keep every other point (a coarser curve, half the rings); primary limbs
 * keep only the points that bend.
 */
const simplifyLimb = (limb: WoodLimb, detail: IslandDetail): WoodLimb => {
  if (limb.points.length < 4) return limb;
  if (limb.depth === 1 && !limb.root && detail.barkRelief) return dropStraightPoints(limb);
  if (limb.depth < detail.detailWoodDepth) return limb;
  const keep = (_: unknown, index: number, list: unknown[]) =>
    index % 2 === 0 || index === list.length - 1;
  return { ...limb, points: limb.points.filter(keep), radii: limb.radii.filter(keep) };
};

type ShadeAt = (point: Vec3) => number;

const getBarkUv = (detail: IslandDetail, limb: WoodLimb) =>
  detail.barkRelief ? createBarkUv(limb) : undefined;

const getWoodStyle = (
  detail: IslandDetail,
  shadeAt: ShadeAt,
  limb: WoodLimb,
  random: Random
): VertexStyle => {
  if (!detail.barkRelief) return solid(detail.bark, random, 0);
  const young = limb.depth >= 2 ? 1.1 : 1;
  return {
    color: (position) => {
      const shade = shadeAt(position) * young * (0.94 + random() * 0.12);
      return [detail.bark[0] * shade, detail.bark[1] * shade, detail.bark[2] * shade];
    },
    flutter: 0
  };
};

/** Wood colour and bark coordinates of a limb: birch, conifer archetype or the species default. */
const getLimbSurface = (
  model: TreeModel,
  limb: WoodLimb,
  units: number,
  shadeAt: ShadeAt,
  random: Random
): { style: VertexStyle; uvAt: TubeUv | undefined } => {
  const detail = DETAIL[model.species];
  if (model.species === "birch") {
    return {
      style: createBirchWoodStyle(model, limb, units, shadeAt, random),
      uvAt: createBirchBarkUv(limb)
    };
  }
  if (model.look) {
    return {
      style: createConiferWoodStyle(model, model.look, limb, units, shadeAt, random),
      uvAt: createConiferBarkUv(model.look, limb)
    };
  }
  return { style: getWoodStyle(detail, shadeAt, limb, random), uvAt: getBarkUv(detail, limb) };
};

/** Growth stages 1-2: seen at arm's length, carrying their sprays on the finest twigs. */
const isSaplingModel = (model: TreeModel) =>
  typeof model.stage === "number" && model.stage <= SAPLING_STAGE;

/**
 * Wood levels from here on are LOD detail. Saplings keep every drawn level: dropping their twigs
 * would leave the leaves floating.
 */
const getDetailWoodDepth = (model: TreeModel, detail: IslandDetail) =>
  isSaplingModel(model)
    ? detail.maxWoodDepth + 1
    : detail.detailWoodDepth;

const addWood = (
  builder: MeshBuilder,
  model: TreeModel,
  toIsland: Transform,
  units: number,
  random: Random
) => {
  const detail = DETAIL[model.species];
  const detailDepth = getDetailWoodDepth(model, detail);
  const shadeAt = createWoodShade(model);
  for (const source of model.wood) {
    if (source.depth > detail.maxWoodDepth || source.minor) continue;
    const limb = simplifyLimb(source, detail);
    const sides = limb.root ? ROOT_SIDES : (detail.sides[limb.depth] ?? 3);
    const radii = limb.radii.map((radius) => radius * units);
    const { style, uvAt } = getLimbSurface(model, limb, units, shadeAt, random);
    builder.detail = limb.depth >= detailDepth;
    addCurvedTube(builder, limb.points.map(toIsland), radii, sides, style, undefined, uvAt,
      findTreeJunction(limb, model.wood, units));
  }
  builder.detail = false;
};

const NO_SHIFT: Vec3 = [0, 0, 0];
const NO_TONE: Vec3 = [1, 1, 1];

const multiply = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

const randomUnit = (random: Random): Vec3 =>
  normalize([random() - 0.5, random() - 0.5, random() - 0.5]);

/**
 * Varied card pose: tilted growth (some cards face the light, others turn edge-on), a size
 * spread and a sideways shift that spreads stacked cards over their clump.
 */
const scatterCard = (spray: FoliageSpray, size: number, scatter: number, random: Random) => {
  if (scatter === 0) return { growth: spray.growth, shift: NO_SHIFT, size };
  const growth = normalize(add(spray.growth, scale(randomUnit(random), scatter * 2)));
  const shift = scale(randomUnit(random), size * scatter * random());
  return { growth, shift, size: size * (1 - scatter * 0.5 + random() * scatter * 1.1) };
};

/**
 * Broadleaf saplings stand at arm's length in the possessed view: their cards fold along the
 * twig for volume. Pole and mature crowns keep flat cards (hundreds per tree in a forest).
 */
const CARD_FOLD = 0.45;
/** Folded cards cost four triangles: a sapling keeps at most this many (the kept ones grow). */
const MAX_FOLDED_SPRAYS = 200;
const isBroadleaf = (model: TreeModel) => !model.look && model.species !== "pine";
const getCardFold = (model: TreeModel) => {
  if (!isBroadleaf(model)) return 0;
  return isSaplingModel(model) ? CARD_FOLD : 0;
};

/** Young oak spray (few large lobed leaves): oak saplings read leaf by leaf at arm's length. */
const YOUNG_OAK_CELL = LEAF_SPRAY_RECTS[0]!;
const getSprayCell = (model: TreeModel, spray: FoliageSpray, cells: AtlasRect[]) => {
  const oakLeaf = model.species === "oak" && !model.look && spray.variant < CHERRY_SPRAY_VARIANT;
  return isSaplingModel(model) && oakLeaf ? YOUNG_OAK_CELL : cells[spray.variant % cells.length]!;
};

/** How an island tree mesh is built: the drawn look, or the shape an offline bake measures. */
export interface IslandTreeMeshOptions {
  /**
   * Broadleaf cards turn towards their spray's facing side (the drawn look). Off: every card keeps
   * the random turn about its growth, so a render-only card turn never moves the baked wildlife
   * crown profiles (crown-profile-measure.ts); the same random numbers are drawn either way.
   */
  cardFacing: boolean;
}

/** The mesh the renderers draw. */
export const DRAWN_TREE_MESH: IslandTreeMeshOptions = { cardFacing: true };

/** Keeps evenly spread sprays up to the budget, grown so the crown stays as closed. */
const addSprays = (
  builder: MeshBuilder,
  model: TreeModel,
  toIsland: Transform,
  units: number,
  random: Random,
  options: IslandTreeMeshOptions
) => {
  const { cardScatter, yellowing } = DETAIL[model.species];
  const fold = getCardFold(model);
  const speciesSprays = model.look?.maxSprays ?? DETAIL[model.species].maxSprays;
  const maxSprays = fold > 0 ? Math.min(speciesSprays, MAX_FOLDED_SPRAYS) : speciesSprays;
  const foliageTone = model.look?.foliage ?? NO_TONE;
  const kept = Math.min(model.foliage.length, maxSprays) / Math.max(1, model.foliage.length);
  const grow = Math.pow(1 / Math.max(kept, 1e-3), 0.42);
  const cells = SPRAY_CELLS[model.species];
  const facesSprays = options.cardFacing && isBroadleaf(model);
  model.foliage.forEach((spray, index) => {
    if (Math.floor((index + 1) * kept) === Math.floor(index * kept)) return;
    // Blossoms never yellow; the check comes first so oak cards keep their random sequence.
    const blossom = model.species === "oak" && spray.variant >= CHERRY_SPRAY_VARIANT;
    const tint = multiply(getSprayTint(spray, !blossom && yellowing > 0 && random() < yellowing), foliageTone);
    const style: VertexStyle = { color: () => tint, flutter: 1 };
    const size = spray.size * units * grow;
    const card = scatterCard(spray, size, cardScatter, random);
    addLeafCard(
      builder,
      add(toIsland(spray.position), card.shift),
      {
        cell: getSprayCell(model, spray, cells),
        facing: facesSprays ? spray.facing : undefined,
        fold,
        growth: card.growth,
        outward: spray.outward,
        size: card.size
      },
      random,
      style
    );
  });
};

/** Broadleaf bend weights: mostly whole-tree sway, the limb ends a little more by their reach. */
const BROADLEAF_WIND = { branch: 0.25, trunk: 0.8 } as const;
/** Mature island trees stand about this tall (units); smaller ones bend proportionally less. */
const MATURE_TREE_HEIGHT = 3;
const MIN_SWAY_SCALE = 0.3;

/**
 * The wind field moves a vertex by a world distance times its bend weight, the same for every tree:
 * a one-unit sapling bent as far as a mature crown and wobbled like rubber. Bend weights scale with
 * the tree's height, so a sapling's stem stays nearly rigid while a mature crown sways as before.
 */
const scaleSwayToHeight = (mesh: PropMesh) => {
  const sway = Math.min(1, Math.max(MIN_SWAY_SCALE, mesh.height / MATURE_TREE_HEIGHT));
  for (let vertex = 0; vertex < mesh.wind.length; vertex += 2) mesh.wind[vertex]! *= sway;
  return mesh;
};

/**
 * Island version of a tree model: metres to island units, wood down to the main limbs, fewer
 * larger sprays (palms: palm-island-mesh.ts); one prop mesh that the island's instanced prop pipeline,
 * felling and sprite baker handle like any other prop.
 */
export const createIslandTreeMesh = (
  model: TreeModel,
  units: number,
  random: Random,
  options = DRAWN_TREE_MESH
): PropMesh => {
  if (model.species === "palm") return createPalmIslandMesh(model, units, random);
  const builder = new MeshBuilder();
  const toIsland: Transform = (point) => scale(point, units);
  addWood(builder, model, toIsland, units, random);
  addSprays(builder, model, toIsland, units, random, options);
  const mesh = applyTreeWind(builder.finish(), model.look?.wind ?? BROADLEAF_WIND);
  return scaleSwayToHeight(mesh);
};
