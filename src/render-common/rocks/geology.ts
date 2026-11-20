import { createFbm, type Noise2,smoothstep } from "../../shared/world/noise";
import { deriveSeed, type Random } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import { ROCK_FAMILY, type RockFamily } from "./rock-shapes";
import type { RockTerrain } from "./rock-terrain";

/**
 * Geological presets, one visual family: layered (horizontal or dipping plates, shelves),
 * fractured (vertical columns and blocks), weathered (rounded stone, soil, plants), mountain
 * (huge broad planes along the slope).
 */
export type Geology = "layered" | "fractured" | "weathered" | "mountain";

export interface GeologyStyle {
  /** Slabs follow the slope (mountain) instead of standing upright. */
  alongSlope: boolean;
  /** How much fresh rock tall faces expose (weathered geology stays mostly weathered). */
  exposure: number;
  /** How far a slab's front stands out of the face (world units at face height ~2.2). */
  protrude: [number, number];
  families: RockFamily[];
  /** Lean in and out of the face (radians). */
  lean: number;
  moss: number;
  /** Macro slab size (width, height, depth) at a face height of about 2.2. */
  size: [Vec3, Vec3];
  /** Extra roll on top of the regional strata dip (radians). */
  roll: number;
}

export const GEOLOGY: Record<Geology, GeologyStyle> = {
  fractured: {
    alongSlope: false,
    exposure: 1,
    protrude: [0.08, 0.45],
    families: [ROCK_FAMILY.panel, ROCK_FAMILY.broken],
    lean: 0.12,
    moss: 0.35,
    roll: 0.08,
    size: [
      [1.3, 2.6, 1.3],
      [2.0, 4.2, 1.8]
    ]
  },
  layered: {
    alongSlope: false,
    exposure: 0.9,
    protrude: [0.06, 0.55],
    families: [ROCK_FAMILY.panel, ROCK_FAMILY.slab],
    lean: 0.1,
    moss: 0.45,
    roll: 0.06,
    size: [
      [2.6, 0.9, 1.4],
      [4.2, 1.5, 2.0]
    ]
  },
  mountain: {
    alongSlope: true,
    exposure: 1,
    protrude: [0.12, 0.45],
    families: [ROCK_FAMILY.panel, ROCK_FAMILY.panel, ROCK_FAMILY.blocky],
    lean: 0.18,
    moss: 0.2,
    roll: 0.25,
    size: [
      [2.6, 2.2, 0.7],
      [4.2, 3.6, 1.1]
    ]
  },
  weathered: {
    alongSlope: true,
    exposure: 0.35,
    protrude: [0.1, 0.4],
    families: [ROCK_FAMILY.weathered, ROCK_FAMILY.blocky],
    lean: 0.2,
    moss: 0.75,
    roll: 0.3,
    size: [
      [1.8, 1.6, 1.5],
      [2.8, 2.4, 2.0]
    ]
  }
};

/** Regional fields: which geology, the strata dip, the stone tint and the major fractures. */
export interface GeologyMap {
  dip: Noise2;
  fracture: Noise2;
  geology: (x: number, z: number) => Geology;
  tint: Noise2;
}

/** Stone tint shift at a position (the local island theme: warm sandstone in the desert). */
export type TintShift = (x: number, z: number) => number;

const NO_TINT_SHIFT: TintShift = () => 0;

/** A lab cliff forces one geology; the local island theme shifts the stone tint. */
interface GeologyOptions {
  forced?: Geology;
  tintShift?: TintShift;
}

export const createGeologyMap = (
  terrain: RockTerrain,
  seed: number,
  { forced, tintShift = NO_TINT_SHIFT }: GeologyOptions = {}
): GeologyMap => {
  const kind = createFbm(deriveSeed(seed, "geology"), { octaves: 2 });
  const dip = createFbm(deriveSeed(seed, "strata-dip"), { octaves: 2 });
  const tint = createFbm(deriveSeed(seed, "rock-tint"), { octaves: 3 });
  const fracture = createFbm(deriveSeed(seed, "fractures"), { octaves: 2 });
  const geology = (x: number, z: number): Geology => {
    if (forced) return forced;
    if (terrain.mountain(x, z) > 0.55) return "mountain";
    const value = kind(x * 0.05, z * 0.05);
    if (value < -0.18) return "fractured";
    return value > 0.22 ? "weathered" : "layered";
  };
  return {
    dip: (x, z) => dip(x * 0.04, z * 0.04) * 0.35,
    fracture: (x, z) => fracture(x * 0.32 + 7, z * 0.32 - 3),
    geology,
    tint: (x, z) => tint(x * 0.07, z * 0.07) * 0.9 + tintShift(x, z)
  };
};

/** Major fractures: a few long narrow bands where macro slabs leave a deep gap. */
export const isOnFracture = (map: GeologyMap, x: number, z: number) =>
  Math.abs(map.fracture(x, z)) < 0.045;

/**
 * Size of a macro slab, scaled with the face height (small faces get smaller slabs); one in four
 * is a major slab that spans several layers (the big forms the face is read by).
 */
export const pickSlabSize = (style: GeologyStyle, faceHeight: number, random: Random): Vec3 => {
  const major = !style.alongSlope && random() < 0.25 ? 1.6 : 1;
  const scale = (0.45 + smoothstep(0.6, 6, faceHeight) * 0.8) * major;
  const [low, high] = style.size;
  return [0, 1, 2].map(
    (axis) => (low[axis]! + random() * (high[axis]! - low[axis]!)) * scale
  ) as unknown as Vec3;
};
