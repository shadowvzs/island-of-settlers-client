import { deflateSync } from "node:zlib";

import type { AtlasMip } from "../../../src/render-common/baker/atlas-mips";
import { encodeKtx2Rgba8 } from "../../../src/render-common/baker/ktx2-rgba8";
import { getMicroDetailCell, MICRO_CLASS_IDS, MICRO_DETAIL_ALBEDO_SCALE, MICRO_DETAIL_COLUMNS,
  MICRO_DETAIL_MIP_LEVELS, MICRO_DETAIL_PADDING, MICRO_DETAIL_ROWS, MICRO_DETAIL_TILE_SIZE, type MicroClass,
  type MicroClassId, type MicroDetailClassStats } from "../../../src/render-common/materials/micro-detail";
import type { RecipeContext } from "../../../src/render-common/materials/recipe-helpers";
import { paintBladeMicro } from "./blade-art";
import { paintGrainMicro } from "./grain-art";
import { createMicroContext, toneAt } from "./micro-canvas";
import { paintSnowMicro } from "./snow-art";
import { paintSoilMicro } from "./soil-art";

export const MICRO_DETAIL_SEED = 5281;
const WRITER = "island-of-settlers micro-detail-atlas v1";
const ALBEDO_MIN = 0.6;
const ALBEDO_MAX = 1.4;

const PAINTERS: Record<MicroClassId, (context: RecipeContext) => void> = {
  blades: paintBladeMicro,
  grains: paintGrainMicro,
  snow: paintSnowMicro,
  soil: paintSoilMicro
};

/** Normal strength per class: painted height difference × bump per texel. */
const BUMP: Record<MicroClassId, number> = { blades: 1.5, grains: 2.2, snow: 1.3, soil: 3 };

export interface BakedMicroDetailAtlas {
  /** Atlas levels 0..4 (576² … 36²), wrap-padded per level. */
  levels: AtlasMip[];
  stats: MicroDetailClassStats[];
  /** The unpadded 256² RGBA tiles in class order (previews). */
  tiles: Uint8Array[];
}

const percentile = (values: ArrayLike<number>, share: number) => {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
};

const mean = (values: ArrayLike<number>) => {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index]!;
  return sum / values.length;
};

/** Divides by the mean and clamps; repeated so the clamped result still averages ×1.0. */
const normaliseAlbedo = (tone: Float32Array) => {
  for (let pass = 0; pass < 4; pass += 1) {
    const average = mean(tone);
    for (let index = 0; index < tone.length; index += 1) {
      tone[index] = Math.min(ALBEDO_MAX, Math.max(ALBEDO_MIN, tone[index]! / average));
    }
  }
};

const writeNormal = (pixels: Uint8Array, height: Float32Array, size: number, bump: number) => {
  const mask = size - 1;
  const heightAt = (x: number, y: number) => height[(y & mask) * size + (x & mask)]!;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * bump;
    const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * bump;
    const length = Math.hypot(dx, dy, 1), offset = (y * size + x) * 4;
    pixels[offset] = Math.round((-dx / length) * 127.5 + 127.5);
    pixels[offset + 1] = Math.round((-dy / length) * 127.5 + 127.5);
  }
};

/** Exponent that moves the mean of 0..1 values to 0.5 (bisection; the mean falls as it grows). */
const centringExponent = (values: Float32Array) => {
  let low = 0.05, high = 20;
  for (let step = 0; step < 40; step += 1) {
    const exponent = Math.sqrt(low * high);
    const average = mean(values.map(value => value ** exponent));
    if (average > 0.5) low = exponent;
    else high = exponent;
  }
  return Math.sqrt(low * high);
};

/**
 * Cavity height: the 1st … 99th percentile of the painted height mapped to 0..1, then bent so
 * every class averages 0.5. A centred cavity term then leaves the mean brightness unchanged.
 */
const writeHeight = (pixels: Uint8Array, height: Float32Array) => {
  const low = percentile(height, 0.01), high = percentile(height, 0.99);
  const scale = 1 / Math.max(1e-6, high - low);
  const unitHeight = height.map(value => Math.min(1, Math.max(0, (value - low) * scale)));
  const exponent = centringExponent(unitHeight);
  for (let index = 0; index < height.length; index += 1) {
    pixels[index * 4 + 3] = Math.round(unitHeight[index]! ** exponent * 255);
  }
};

const describeTile = (pixels: Uint8Array, microClass: MicroClass): MicroDetailClassStats => {
  const texels = pixels.length / 4;
  const albedo = new Float32Array(texels), height = new Float32Array(texels), slope = new Float32Array(texels);
  for (let index = 0; index < texels; index += 1) {
    albedo[index] = pixels[index * 4 + 2]! / MICRO_DETAIL_ALBEDO_SCALE;
    height[index] = pixels[index * 4 + 3]! / 255;
    slope[index] = Math.hypot(pixels[index * 4]! / 127.5 - 1, pixels[index * 4 + 1]! / 127.5 - 1);
  }
  const round = (value: number) => Number(value.toFixed(4));
  return {
    albedoMean: round(mean(albedo)),
    albedoRange: [round(percentile(albedo, 0.05)), round(percentile(albedo, 0.95))],
    heightMean: round(mean(height)),
    id: MICRO_CLASS_IDS[microClass]!,
    index: microClass,
    slopeMean: round(mean(slope))
  };
};

/** Paints one class tile (deterministic per seed) and packs it into RGBA. */
export const paintMicroTile = (microClass: MicroClass, seed = MICRO_DETAIL_SEED) => {
  const id = MICRO_CLASS_IDS[microClass]!, size = MICRO_DETAIL_TILE_SIZE;
  const context = createMicroContext(size, seed + microClass * 1013);
  PAINTERS[id](context);
  const { canvas } = context;
  const tone = Float32Array.from({ length: size * size }, (_, index) => toneAt(canvas, index));
  normaliseAlbedo(tone);
  const pixels = new Uint8Array(size * size * 4);
  writeNormal(pixels, canvas.height, size, BUMP[id]);
  for (let index = 0; index < tone.length; index += 1) {
    pixels[index * 4 + 2] = Math.round(tone[index]! * MICRO_DETAIL_ALBEDO_SCALE);
  }
  writeHeight(pixels, canvas.height);
  return pixels;
};

/** 2×2 box average; tile sizes are powers of two, so every level stays seamlessly tileable. */
export const halveRgbaTile = (pixels: Uint8Array, size: number) => {
  const half = size / 2, result = new Uint8Array(half * half * 4);
  for (let y = 0; y < half; y += 1) for (let x = 0; x < half; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      const at = (row: number, column: number) => pixels[(row * size + column) * 4 + channel]!;
      const sum = at(y * 2, x * 2) + at(y * 2, x * 2 + 1) + at(y * 2 + 1, x * 2) + at(y * 2 + 1, x * 2 + 1);
      result[(y * half + x) * 4 + channel] = Math.round(sum / 4);
    }
  }
  return result;
};

/** One atlas level: every tile level copied into its cell with `padding` texels of wrap-around. */
const packLevel = (tiles: readonly Uint8Array[], level: number): AtlasMip => {
  const tile = MICRO_DETAIL_TILE_SIZE >> level, padding = MICRO_DETAIL_PADDING >> level;
  const cell = tile + padding * 2, width = cell * MICRO_DETAIL_COLUMNS, height = cell * MICRO_DETAIL_ROWS;
  const data = new Uint8Array(width * height * 4);
  tiles.forEach((pixels, microClass) => {
    const { column, row } = getMicroDetailCell(microClass as MicroClass);
    for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) {
      const sourceX = (x - padding + tile) % tile, sourceY = (y - padding + tile) % tile;
      const from = (sourceY * tile + sourceX) * 4, to = ((row * cell + y) * width + column * cell + x) * 4;
      data.set(pixels.subarray(from, from + 4), to);
    }
  });
  return { data, height, width };
};

/** Paints the four classes and builds the padded, explicit mip chain of the atlas. */
export const bakeMicroDetailAtlas = (seed = MICRO_DETAIL_SEED): BakedMicroDetailAtlas => {
  const tiles = MICRO_CLASS_IDS.map((_, microClass) => paintMicroTile(microClass as MicroClass, seed));
  const chains = tiles.map(pixels => {
    const chain = [pixels];
    for (let level = 1; level < MICRO_DETAIL_MIP_LEVELS; level += 1) {
      chain.push(halveRgbaTile(chain[level - 1]!, MICRO_DETAIL_TILE_SIZE >> (level - 1)));
    }
    return chain;
  });
  const levels = Array.from({ length: MICRO_DETAIL_MIP_LEVELS }, (_, level) =>
    packLevel(chains.map(chain => chain[level]!), level));
  const stats = tiles.map((pixels, microClass) => describeTile(pixels, microClass as MicroClass));
  return { levels, stats, tiles };
};

/** Linear RGBA8 KTX2 (UNORM), zlib level 9; byte-identical for identical levels. */
export const encodeMicroDetailAtlas = (levels: readonly AtlasMip[]) =>
  encodeKtx2Rgba8(levels, { compress: data => deflateSync(data, { level: 9 }), srgb: false, writer: WRITER });
