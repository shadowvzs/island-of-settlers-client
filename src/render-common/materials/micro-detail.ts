import { MATERIAL } from "../../shared/world/world-data";

/**
 * Layout of the ground micro-detail atlas (card T06a): four tileable 256² micro tiles in a 2×2
 * atlas with 16 px wrap padding, baked offline by `npm run micro-detail-atlas` into one linear
 * RGBA8 KTX2 file with an explicit 5-level mip chain (576² … 36², 1.69 MiB on the GPU).
 *
 * Channels (all linear data, never sRGB-decoded):
 * - R, G = tangent-free normal x / z offset, 127.5-centred, the same convention as the ground
 *   normal atlas (`material-textures.ts`); texture u follows world x, v follows world z;
 * - B = albedo multiplier × 127.5 (128 ≈ ×1.0; the art stays inside ×0.6 … ×1.4 and every class
 *   averages ×1.0, so the near band keeps the base tile's mean colour);
 * - A = micro height 0..1 (low = cavity), for cavity occlusion.
 *
 * Pure data, worker-safe and free of Three.
 */
export const MICRO_DETAIL_TILE_SIZE = 256;
export const MICRO_DETAIL_PADDING = 16;
export const MICRO_DETAIL_COLUMNS = 2;
export const MICRO_DETAIL_ROWS = 2;
/** World units per repeat: 256 texels / 0.75 units ≈ 341 texels per unit (≈ 4.7 mm per texel). */
export const MICRO_DETAIL_UNITS = 0.75;
/** 576, 288, 144, 72, 36: the deepest level whose padding is still a whole texel (16 >> 4 = 1). */
export const MICRO_DETAIL_MIP_LEVELS = 5;
export const MICRO_DETAIL_CELL = MICRO_DETAIL_TILE_SIZE + MICRO_DETAIL_PADDING * 2;
/** The atlas is square because the grid is 2 × 2. */
export const MICRO_DETAIL_ATLAS_SIZE = MICRO_DETAIL_CELL * MICRO_DETAIL_COLUMNS;
/** Fractions of one cell, for the shader (`MICRO_INNER`, `MICRO_PAD` in card T06b). */
export const MICRO_DETAIL_INNER = MICRO_DETAIL_TILE_SIZE / MICRO_DETAIL_CELL;
export const MICRO_DETAIL_PAD = MICRO_DETAIL_PADDING / MICRO_DETAIL_CELL;
/** Albedo multiplier = B byte / this value. */
export const MICRO_DETAIL_ALBEDO_SCALE = 127.5;

export const MICRO_CLASS = { blades: 0, soil: 1, grains: 2, snow: 3 } as const;
export type MicroClass = (typeof MICRO_CLASS)[keyof typeof MICRO_CLASS];
export type MicroClassId = keyof typeof MICRO_CLASS;
/** Class ids in atlas order (index = class). */
export const MICRO_CLASS_IDS: readonly MicroClassId[] = ["blades", "soil", "grains", "snow"];

/** Micro class of every ground material; rock shares the crystalline snow grain if it renders. */
export const MICRO_CLASS_OF_MATERIAL: Readonly<Record<number, MicroClass>> = {
  [MATERIAL.grass]: MICRO_CLASS.blades,
  [MATERIAL.lushGrass]: MICRO_CLASS.blades,
  [MATERIAL.forestFloor]: MICRO_CLASS.blades,
  [MATERIAL.dirt]: MICRO_CLASS.soil,
  [MATERIAL.sand]: MICRO_CLASS.grains,
  [MATERIAL.rock]: MICRO_CLASS.snow,
  [MATERIAL.snow]: MICRO_CLASS.snow,
  [MATERIAL.gravel]: MICRO_CLASS.grains,
  [MATERIAL.mine]: MICRO_CLASS.soil
};

/** Atlas cell of a class: (class % columns, ⌊class / columns⌋). */
export const getMicroDetailCell = (microClass: MicroClass) => ({
  column: microClass % MICRO_DETAIL_COLUMNS,
  row: Math.floor(microClass / MICRO_DETAIL_COLUMNS)
});

const fract = (value: number) => value - Math.floor(value);

/**
 * Atlas uv (0..1, flipY false) of world position x, z in a class cell: the CPU mirror of the
 * T06b `sampleMicroDetail` lookup, used by the previews and tests.
 */
export const getMicroDetailAtlasUv = (microClass: MicroClass, x: number, z: number): [number, number] => {
  const { column, row } = getMicroDetailCell(microClass);
  const u = (column + MICRO_DETAIL_PAD + fract(x / MICRO_DETAIL_UNITS) * MICRO_DETAIL_INNER) / MICRO_DETAIL_COLUMNS;
  const v = (row + MICRO_DETAIL_PAD + fract(z / MICRO_DETAIL_UNITS) * MICRO_DETAIL_INNER) / MICRO_DETAIL_ROWS;
  return [u, v];
};

export interface MicroDetailClassStats {
  /** Mean albedo multiplier of level 0 (≈ 1). */
  albedoMean: number;
  /** 5th and 95th percentile of the albedo multiplier. */
  albedoRange: [number, number];
  /** Mean height 0..1 (for centring cavity occlusion). */
  heightMean: number;
  id: MicroClassId;
  index: MicroClass;
  /** Mean length of the normal x / z offset (decoded −1..1). */
  slopeMean: number;
}

export interface MicroDetailAtlasFile {
  bytes: number;
  file: string;
  gpuBytes: number;
  levels: number;
  sha256: string;
  size: number;
}

/** `assets/textures/terrain/micro-detail-atlas.json`, written by the offline bake. */
export interface MicroDetailAtlasManifest {
  classes: MicroDetailClassStats[];
  file: MicroDetailAtlasFile;
  seed: number;
  version: number;
}
