import { deterministicPow,DMath } from "../../../math/deterministic-math";
import { segmentFraction } from "../../../settlement/settlement-geometry";
import { createFbm, createRidgedNoise, type Noise2,smoothstep } from "../../noise";
import { type MountainTemplate,sampleMountainTemplate } from "./mountain-template";

/**
 * A terrain stamp of the map editor: a mountain (a peak, or a ridge along a drag) raised level by
 * level, or a lake (a pond deepened and widened level by level; a channel along a drag). Plain
 * values: the stamp list is what a saved map stores (phase 3).
 */
export interface TerrainStamp {
  id: number;
  /** "lake": dug into the ground and filled with water; unset: a mountain. */
  kind?: "lake";
  /** Mountain: 1 a boulder, 2 an outcrop, 3 .. 6 a hill growing into a mountain; lake: 1 .. 5. */
  level: number;
  /** Seed of the irregular outline and the ridged detail. */
  seed: number;
  /** Optional processed source profile. Unset keeps the original procedural shape. */
  template?: MountainTemplate;
  /** Ridge end (a drag), else a single peak. */
  toX?: number;
  toZ?: number;
  x: number;
  z: number;
}

export const MAX_MOUNTAIN_LEVEL = 6;
/**
 * First level with stamped rocks (an outcrop): from here on the open ground of the footprint and
 * a ring around its foot turn to mine gravel (the generator's apron rule).
 */
const ROCKY_LEVEL = 2;

/** Rise above the ground (world units) and footprint radius (cells) per level (index level-1). */
const LEVELS = [
  { radius: 1.2, rise: 0 },
  { radius: 3, rise: 0.7 },
  { radius: 5, rise: 2.2 },
  { radius: 7, rise: 3.6 },
  { radius: 9.5, rise: 5.2 },
  { radius: 12, rise: 7 }
] as const;
/** Outline warp: the footprint radius varies by up to this share (no round cones). */
const OUTLINE_WARP = 0.28;
/** Concave flank: steeper below the crest, easing out to the foot. */
const FLANK_CURVE = 1.6;
/** Ridged detail on the flanks (share of the rise). */
const RIDGE_DETAIL = 0.22;
/** Gravel ring beyond the foot: width (cells) at ROCKY_LEVEL, growth per level. */
const RING_WIDTH = { base: 1, perLevel: 0.75 } as const;
/**
 * The ring is broken like the generator's apron: its width varies along the foot between
 * `least` and `least + extra` times the level's width (tongues and thin rims).
 */
const RING_BREAKUP = { extra: 0.95, least: 0.35 } as const;
/** Footprint ratio over which the gravel fades out at the ring's outer edge. */
const RING_FADE = 0.08;

const getRingWidth = (level: number) =>
  RING_WIDTH.base + RING_WIDTH.perLevel * (level - ROCKY_LEVEL);

export const getLevelShape = (level: number) =>
  LEVELS[Math.max(1, Math.min(MAX_MOUNTAIN_LEVEL, level)) - 1]!;

export const MAX_LAKE_LEVEL = 5;
/** Lake radius (cells) and depth below its surface (world units) per level (index level-1). */
const LAKE_LEVELS = [
  { depth: 0.7, radius: 2.5 },
  { depth: 1.1, radius: 3.8 },
  { depth: 1.5, radius: 5.5 },
  { depth: 2, radius: 7.5 },
  { depth: 2.6, radius: 10 }
] as const;
/** A channel (a lake drawn by a drag) is this share of the level's width. */
const CHANNEL_WIDTH = 0.55;
/** A lake's shore (bank) reaches this far out beyond its rim (footprint ratio). */
export const LAKE_SHORE = 1.3;

export const isLake = (stamp: TerrainStamp) => stamp.kind === "lake";

const isRidge = (stamp: TerrainStamp) => stamp.toX !== undefined && stamp.toZ !== undefined;

export const getMaxLevel = (stamp: Pick<TerrainStamp, "kind">) =>
  stamp.kind === "lake" ? MAX_LAKE_LEVEL : MAX_MOUNTAIN_LEVEL;

const getLakeShape = (level: number) =>
  LAKE_LEVELS[Math.max(1, Math.min(MAX_LAKE_LEVEL, level)) - 1]!;

/** Footprint radius (cells) of a stamp at its level. */
export const getStampRadius = (stamp: TerrainStamp) => {
  if (!isLake(stamp)) return getLevelShape(stamp.level).radius;
  const { radius } = getLakeShape(stamp.level);
  return isRidge(stamp) ? radius * CHANNEL_WIDTH : radius;
};

interface StampNoise {
  cosine: number;
  detail: Noise2;
  outline: Noise2;
  sine: number;
}

const noiseCache = new Map<number, StampNoise>();

const getNoise = (seed: number) => {
  const known = noiseCache.get(seed);
  if (known) return known;
  const noise = {
    cosine: DMath.cos((seed >>> 0) * 2.399963229728653),
    detail: createRidgedNoise(seed, 3),
    outline: createFbm(seed + 17, { octaves: 2 }),
    sine: DMath.sin((seed >>> 0) * 2.399963229728653)
  };
  noiseCache.set(seed, noise);
  return noise;
};

/** Distance (cells) from a point to the stamp's spine (its centre, or its ridge line). */
const getSpineOffset = (stamp: TerrainStamp, x: number, z: number): [number, number] => {
  if (stamp.toX === undefined || stamp.toZ === undefined)
    return [x - stamp.x, z - stamp.z];
  const dx = stamp.toX - stamp.x;
  const dz = stamp.toZ - stamp.z;
  const t = segmentFraction(x, z, stamp.x, stamp.z, dx, dz);
  return [x - stamp.x - dx * t, z - stamp.z - dz * t];
};

/**
 * How far out a point lies in the stamp's warped footprint: 0 on the spine, 1 at the foot, more
 * beyond it.
 */
export const getFootprintRatio = (stamp: TerrainStamp, x: number, z: number) => {
  const radius = getStampRadius(stamp);
  const warp = 1 + OUTLINE_WARP * getNoise(stamp.seed).outline(x * 0.13, z * 0.13);
  return DMath.hypot(...getSpineOffset(stamp, x, z)) / (radius * warp);
};

/** Rise of the ground by the stamp at a point (0 outside its footprint). */
const getSingleStampRise = (stamp: TerrainStamp, x: number, z: number) => {
  const { rise } = getLevelShape(stamp.level);
  if (rise <= 0 || isLake(stamp)) return 0;
  const ratio = getFootprintRatio(stamp, x, z);
  if (ratio >= 1) return 0;
  const flank = deterministicPow(1 - ratio, FLANK_CURVE);
  const ridges = getNoise(stamp.seed).detail(x * 0.32, z * 0.32) - 0.5;
  const procedural = Math.max(0, flank + ridges * RIDGE_DETAIL * flank * (1 - flank) * 4);
  return rise * procedural;
};

/** Growing a source profile never lowers a valley that a previous level already raised. */
export const getStampRise = (stamp: TerrainStamp, x: number, z: number) => {
  if (!stamp.template) return getSingleStampRise(stamp, x, z);
  if (isLake(stamp) || stamp.level < ROCKY_LEVEL) return 0;
  const [dx, dz] = getSpineOffset(stamp, x, z);
  const distance = DMath.hypot(dx, dz);
  const noise = getNoise(stamp.seed);
  const warp = 1 + OUTLINE_WARP * noise.outline(x * 0.13, z * 0.13);
  const ridges = noise.detail(x * 0.32, z * 0.32) - 0.5;
  const localX = dx * noise.cosine - dz * noise.sine;
  const localZ = dx * noise.sine + dz * noise.cosine;
  let rise = 0;
  for (let level = ROCKY_LEVEL; level <= stamp.level; level += 1) {
    const shape = getLevelShape(level);
    const scale = shape.radius * warp;
    const ratio = distance / scale;
    if (ratio >= 1) continue;
    const blend = smoothstep(ROCKY_LEVEL, 4, level);
    const flank = deterministicPow(1 - ratio, FLANK_CURVE);
    const procedural = Math.max(0, flank + ridges * RIDGE_DETAIL * flank * (1 - flank) * 4);
    const source = blend > 0 ? sampleMountainTemplate(localX / scale, localZ / scale) : 0;
    rise = Math.max(rise, shape.rise * (procedural * (1 - blend) + source * blend));
  }
  return rise;
};

/**
 * Mine gravel (apron) weight 0..1 at a point: the whole footprint of an outcrop, hill or mountain
 * and a broken ring beyond its foot that widens with the level (rock faces and snow keep their
 * ground).
 */
export const getStampRing = (stamp: TerrainStamp, x: number, z: number) => {
  if (stamp.level < ROCKY_LEVEL || isLake(stamp)) return 0;
  const { radius } = getLevelShape(stamp.level);
  const tongue = smoothstep(-0.3, 0.4, getNoise(stamp.seed).outline(x * 0.4 + 5, z * 0.4 - 9));
  const breakup = RING_BREAKUP.least + RING_BREAKUP.extra * tongue;
  const outer = 1 + (getRingWidth(stamp.level) * breakup) / radius;
  const ratio = getFootprintRatio(stamp, x, z);
  if (ratio >= outer) return 0;
  return 1 - smoothstep(outer - RING_FADE, outer, ratio);
};

/** Smooth union of two rises: overlapping mountains merge into one massif (no stacked spikes). */
const mergeRises = (first: number, second: number, softness: number) => {
  if (softness <= 0) return Math.max(first, second);
  const blend = Math.max(softness - Math.abs(first - second), 0) / softness;
  return Math.max(first, second) + (blend * blend * softness) / 4;
};

/** Merge softness of overlapping rises (world units). */
const MERGE_SOFTNESS = 0.8;

/** Combined rise of every stamp at a point. */
export const getTotalRise = (stamps: readonly TerrainStamp[], x: number, z: number) => {
  let total = 0;
  for (const stamp of stamps) {
    const rise = getStampRise(stamp, x, z);
    if (rise > 0) total = total > 0 ? mergeRises(total, rise, MERGE_SOFTNESS) : rise;
  }
  return total;
};

/** Combined mine gravel (apron) weight of every stamp at a point. */
export const getTotalRing = (stamps: readonly TerrainStamp[], x: number, z: number) => {
  let ring = 0;
  for (const stamp of stamps) {
    ring = Math.max(ring, getStampRing(stamp, x, z));
    if (ring >= 1) return 1;
  }
  return ring;
};

/** Cells (world units) a stamp can reach: its warped footprint plus its gravel ring. */
const getStampReach = (stamp: TerrainStamp) => {
  const radius = getStampRadius(stamp);
  if (isLake(stamp)) return radius * (1 + OUTLINE_WARP) * LAKE_SHORE;
  const widest = RING_BREAKUP.least + RING_BREAKUP.extra;
  return radius * (1 + OUTLINE_WARP) + getRingWidth(MAX_MOUNTAIN_LEVEL) * widest;
};

/** Bounding box (world units) of the stamp's reach. */
export const getStampBounds = (stamp: TerrainStamp) => {
  const reach = getStampReach(stamp);
  const toX = stamp.toX ?? stamp.x;
  const toZ = stamp.toZ ?? stamp.z;
  return {
    maxX: Math.max(stamp.x, toX) + reach,
    maxZ: Math.max(stamp.z, toZ) + reach,
    minX: Math.min(stamp.x, toX) - reach,
    minZ: Math.min(stamp.z, toZ) - reach
  };
};

/**
 * Depth of a lake's bed below its surface at a point (0 at and beyond the rim, deepest in the
 * middle, a little uneven) and the point's footprint ratio.
 */
export const getLakeBed = (stamp: TerrainStamp, x: number, z: number) => {
  const ratio = getFootprintRatio(stamp, x, z);
  const { depth } = getLakeShape(stamp.level);
  const scale = isRidge(stamp) ? CHANNEL_WIDTH : 1;
  if (ratio >= 1) return { depth: 0, ratio };
  const bowl = 1 - ratio * ratio;
  const uneven = 1 + (getNoise(stamp.seed).detail(x * 0.4, z * 0.4) - 0.5) * 0.3;
  return { depth: depth * scale * bowl * uneven, ratio };
};
