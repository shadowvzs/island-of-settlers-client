import type { Vec3 } from "../props/mesh-builder";

export const TREE_SPECIES = ["oak", "palm", "pine", "birch"] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export type GrowthStage = 1 | 2 | 3 | 4 | 5;
/** Stages 1-2 are saplings: slim leader, no buttress roots, their twigs carry the leaves. */
export const SAPLING_STAGE = 2;
/** 0 invisible, 1 sapling .. 5 mature, "chopped" stump only. */
export type TreeStage = 0 | GrowthStage | "chopped";

/**
 * One woody limb (trunk, branch, twig) as a tapered polyline. depth 0 is the trunk. sway is the
 * wind weight at the base and at the tip (0 rooted .. 1 free), phase decorrelates neighbours.
 */
export interface WoodLimb {
  /** Dead branch or stub: grey bare wood, no needles. */
  dead?: boolean;
  depth: number;
  /** Hidden inside dense foliage: the island mesh leaves it out. */
  minor?: boolean;
  phase: number;
  points: Vec3[];
  radii: number[];
  /** Buttress root at the trunk foot (drawn coarser, never sways). */
  root?: boolean;
  sway: [number, number];
}

/**
 * A spray of leaves or needles drawn as one small card. outward points away from the crown
 * centre (soft volume lighting); shade 0 = deep inside the crown .. 1 = sunlit outer surface.
 */
export interface FoliageSpray {
  /** Direction the spray grows (the twig in the texture points this way). */
  growth: Vec3;
  /** Card facing before the renderer adds its own variation. */
  facing: Vec3;
  /** -1 cool blue-green .. 1 warm yellow-green. */
  hue: number;
  outward: Vec3;
  phase: number;
  position: Vec3;
  shade: number;
  size: number;
  sway: number;
  /** Texture variant within the species. */
  variant: number;
}

/**
 * Palm leaf: petiole -> rachis with leaflets (pinnate), or petiole -> fan (costapalmate); points
 * run from the crown outwards.
 */
export interface Frond {
  /** 0 young (upright, fresh) .. 1 old (hanging, yellowing). */
  age: number;
  blade: "fan" | "pinnate";
  /** Palm atlas cell (foliage-atlas.ts PALM_CELL). */
  cell: number;
  /** Leaflet tips hang below the rachis, as a share of the span (fan: segment tips). */
  droop: number;
  /** 0 green .. 1 dead and straw brown (the skirt of dry leaves on fan palms). */
  dry: number;
  /** Leaflets rise from the rachis in a V, as a share of the span (fan: pleat depth). */
  fold: number;
  /** First point with leaflets: the points before are the bare petiole (fan: the last point). */
  leafletStart: number;
  phase: number;
  points: Vec3[];
  /** Twist of the leaflet plane around the rachis (radians). */
  roll: number;
  shade: number;
  /** Extra twist towards the tip (old hanging fronds turn their leaflets on edge). */
  twist: number;
  /** Leaflet span (half width) per point; a fan's radius at its last point. */
  widths: number[];
}

/** Fruit hanging under a palm crown (coconuts, date bunches). */
interface Fruit {
  color: Vec3;
  position: Vec3;
  radius: number;
}

/** What remains after felling: trunk foot with an uneven cut. */
interface Stump {
  /** Bark colour family of the species. */
  barkTone: Vec3;
  /** Root flare multiplier at the ground. */
  flare: number;
  height: number;
  /** Ring segments (palms show horizontal leaf scars instead of furrows). */
  ringed: boolean;
  radius: number;
  /** Tilt of the cut plane (radians) and its direction. */
  slant: number;
  slantYaw: number;
}

/** Bark colouring that changes with age (birch: white bark, a rough darker base). */
export interface BarkLook {
  /** Share of the trunk height that is rough and darker. */
  roughBase: number;
  /** 0 young brown bark .. 1 mature white bark. */
  whiteness: number;
}

/** Island wind weights: whole tree sway (height based) and branch end movement (reach based). */
export interface TreeWind {
  branch: number;
  trunk: number;
}

/** Archetype look of species with archetypes (conifers): bark, needles, card budget, wind. */
export interface TreeLook {
  /** Bark tone at the foot and in the upper trunk (old pines: grey below, warmer above). */
  bark: Vec3;
  /** Procedural bark family of the Three shader (bark-uv.ts BARK_FAMILY). */
  barkFamily: number;
  barkTop: Vec3;
  /** Needle tint multiplier (cool dark spruce, blue-green mountain pine, ...). */
  foliage: Vec3;
  /** Island spray card budget. */
  maxSprays: number;
  wind: TreeWind;
}

export interface TreeModel {
  /** Age dependent bark colouring (species with a bark gradient only). */
  bark?: BarkLook;
  /** Bounding radius around the trunk axis and total height (camera framing). */
  bounds: { height: number; radius: number };
  /** Crown centre: foliage lighting and wind are relative to it. */
  crownCentre: Vec3;
  foliage: FoliageSpray[];
  fronds: Frond[];
  fruit: Fruit[];
  /** Archetype look (conifers); species defaults when unset. */
  look?: TreeLook;
  species: TreeSpecies;
  stage: TreeStage;
  stump: Stump | null;
  wood: WoodLimb[];
}

export const createEmptyModel = (species: TreeSpecies, stage: TreeStage): TreeModel => ({
  bounds: { height: 0, radius: 0 },
  crownCentre: [0, 0, 0],
  foliage: [],
  fronds: [],
  fruit: [],
  species,
  stage,
  stump: null,
  wood: []
});
