import { createRandom } from "../../shared/world/rng";
import { MATERIAL_COUNT } from "../../shared/world/world-data";
import { toByte } from "../color";
import {
  GROUND_DETAIL_COUNT, GROUND_LITTER_COUNT, GROUND_VARIANT_TILE_COUNT
} from "../shaders/ground-variant-layers-glsl";
import { MATERIAL_BUMP, MATERIAL_RECIPES } from "./material-recipes";
import { createPeriodicNoise } from "./periodic-noise";
import { createPaint, createTileCanvas, type TileCanvas } from "./tile-canvas";

/** Edge of a painted material tile (px); presets may upload a halved tier (QualityPreset.groundTileSize). */
export const MATERIAL_TILE_SIZE = 512;
/**
 * Layers of the ground texture arrays. The base materials keep their MATERIAL id as layer index;
 * the render-only variant tiles (GROUND-PALETTE step 2: coarse stones, moss, swamp mud, cracked earth;
 * ground-variant-layers-glsl.ts), the crown litter tiles (pine needles, leaf litter) and the climate detail tiles
 * (basalt, river pebbles) append after them, so the base layers and every shader layer constant stay unchanged.
 */
export const GROUND_LAYER_COUNT =
  MATERIAL_COUNT + GROUND_VARIANT_TILE_COUNT + GROUND_LITTER_COUNT + GROUND_DETAIL_COUNT;

/**
 * One generated material (PBR set packed in two RGBA textures):
 * albedoHeight = albedo RGB + height A (height blending), normalRoughness = normal x / z in RG,
 * ambient occlusion B, roughness A.
 */
export interface MaterialLayer {
  albedoHeight: Uint8Array;
  normalRoughness: Uint8Array;
}

/**
 * Every ground layer packed layer after layer (a texture array: no padding, the GPU repeats each
 * layer and builds its own mips). Painted at runtime today; an offline-baked set (KTX2, R14b) would
 * replace it at the texture creation (three-ground-layers.ts) without touching the shaders.
 */
export interface GroundLayerSet {
  albedoHeight: Uint8Array;
  layerCount: number;
  normalRoughness: Uint8Array;
  /** Layer edge (px). */
  size: number;
}

/** Separable box blur with wrap around (running sums, O(n) per radius). */
const blurWrapped = (source: Float32Array, size: number, radius: number) => {
  const mask = size - 1;
  const horizontal = new Float32Array(source.length);
  const result = new Float32Array(source.length);
  const width = radius * 2 + 1;
  for (let line = 0; line < size; line += 1) {
    let rowSum = 0;
    for (let k = -radius; k <= radius; k += 1) rowSum += source[line * size + (k & mask)]!;
    for (let x = 0; x < size; x += 1) {
      horizontal[line * size + x] = rowSum / width;
      rowSum += source[line * size + ((x + radius + 1) & mask)]!;
      rowSum -= source[line * size + ((x - radius) & mask)]!;
    }
  }
  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += horizontal[(k & mask) * size + x]!;
    for (let y = 0; y < size; y += 1) {
      result[y * size + x] = sum / width;
      sum += horizontal[((y + radius + 1) & mask) * size + x]!;
      sum -= horizontal[((y - radius) & mask) * size + x]!;
    }
  }
  return result;
};

/** Ambient occlusion from the height field: texels below their surroundings get less sky. */
const computeOcclusion = (height: Float32Array, size: number) => {
  const near = blurWrapped(height, size, 2);
  const wide = blurWrapped(height, size, 9);
  return Float32Array.from(height, (value, index) => {
    const hidden =
      Math.max(0, near[index]! - value) * 1.2 + Math.max(0, wide[index]! - value) * 0.8;
    return Math.max(0.45, 1 - hidden);
  });
};

const writeAlbedoHeight = (canvas: TileCanvas, target: Uint8Array) => {
  for (let index = 0; index < canvas.height.length; index += 1) {
    target[index * 4] = toByte(canvas.color[index * 3]!);
    target[index * 4 + 1] = toByte(canvas.color[index * 3 + 1]!);
    target[index * 4 + 2] = toByte(canvas.color[index * 3 + 2]!);
    target[index * 4 + 3] = toByte(canvas.height[index]!);
  }
};

/** Normals from the float height by central differences (wrapping), then AO and roughness. */
const writeNormalOcclusionRoughness = (canvas: TileCanvas, bump: number, target: Uint8Array) => {
  const { height, mask, size } = canvas;
  const occlusion = computeOcclusion(height, size);
  const heightAt = (x: number, y: number) => height[(y & mask) * size + (x & mask)]!;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * bump;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * bump;
      const length = Math.hypot(dx, dy, 1);
      const index = y * size + x;
      target[index * 4] = Math.round((-dx / length) * 127.5 + 127.5);
      target[index * 4 + 1] = Math.round((-dy / length) * 127.5 + 127.5);
      target[index * 4 + 2] = toByte(occlusion[index]!);
      target[index * 4 + 3] = toByte(canvas.roughness[index]!);
    }
  }
};

/** Paints one tileable material (CPU, deterministic). Runs inside a worker. */
export const generateMaterialLayer = (
  material: number,
  size: number,
  seed: number
): MaterialLayer => {
  const recipe = MATERIAL_RECIPES[material];
  if (!recipe) throw new Error(`No recipe for material ${material}`);
  const materialSeed = seed + material * 1013;
  const canvas = createTileCanvas(size);
  recipe({
    canvas,
    noise: createPeriodicNoise(materialSeed),
    paint: createPaint(),
    random: createRandom(materialSeed)
  });
  const layer: MaterialLayer = {
    albedoHeight: new Uint8Array(size * size * 4),
    normalRoughness: new Uint8Array(size * size * 4)
  };
  writeAlbedoHeight(canvas, layer.albedoHeight);
  writeNormalOcclusionRoughness(canvas, MATERIAL_BUMP[material] ?? 2, layer.normalRoughness);
  return layer;
};

/** The painted layers as one texture array set (layer order = array order). */
export const packGroundLayers = (layers: readonly MaterialLayer[], size = MATERIAL_TILE_SIZE): GroundLayerSet => {
  const layerBytes = size * size * 4;
  const albedoHeight = new Uint8Array(layerBytes * layers.length);
  const normalRoughness = new Uint8Array(layerBytes * layers.length);
  layers.forEach((layer, index) => {
    albedoHeight.set(layer.albedoHeight, index * layerBytes);
    normalRoughness.set(layer.normalRoughness, index * layerBytes);
  });
  return { albedoHeight, layerCount: layers.length, normalRoughness, size };
};

/** One 2 x 2 box-filtered level of every layer (the same filter as a mip step; tiles wrap evenly). */
const halveLayers = (source: Uint8Array, size: number, layerCount: number) => {
  const half = size / 2;
  const target = new Uint8Array(half * half * 4 * layerCount);
  const row = size * 4;
  for (let layer = 0; layer < layerCount; layer += 1) {
    const from = layer * size * row, to = layer * half * half * 4;
    for (let y = 0; y < half; y += 1) for (let x = 0; x < half; x += 1) {
      const top = from + y * 2 * row + x * 8, out = to + (y * half + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const sum = source[top + channel]! + source[top + 4 + channel]! + source[top + row + channel]! +
          source[top + row + 4 + channel]!;
        target[out + channel] = (sum + 2) >> 2;
      }
    }
  }
  return target;
};

/** The set at a smaller power-of-two tier (the painted tiles' lower mip levels); the source stays. */
export const downsampleGroundLayers = (set: GroundLayerSet, size: number): GroundLayerSet => {
  if (size >= set.size) return set;
  let { albedoHeight, normalRoughness } = set;
  for (let edge = set.size; edge > size; edge /= 2) {
    albedoHeight = halveLayers(albedoHeight, edge, set.layerCount);
    normalRoughness = halveLayers(normalRoughness, edge, set.layerCount);
  }
  return { albedoHeight, layerCount: set.layerCount, normalRoughness, size };
};
