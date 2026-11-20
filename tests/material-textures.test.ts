import { describe, expect, it } from "vitest";

import {
  downsampleGroundLayers,
  generateMaterialLayer,
  GROUND_LAYER_COUNT,
  MATERIAL_TILE_SIZE,
  packGroundLayers
} from "../src/render-common/materials/material-textures";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { GROUND_LAYERS_GLSL } from "../src/render-common/shaders/ground-common-glsl";
import {
  GROUND_DETAIL_COUNT, GROUND_LITTER_COUNT, GROUND_VARIANT_TILE_COUNT
} from "../src/render-common/shaders/ground-variant-layers-glsl";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { MATERIAL_COUNT } from "../src/shared/world/world-data";

const SIZE = 128;
const SEED = 1234;
const GRASS_MATERIALS = [0, 1, 2] as const;

const meanChannel = (pixels: Uint8Array, channel: number) => {
  let sum = 0;
  for (let index = channel; index < pixels.length; index += 4) sum += pixels[index]!;
  return sum / (pixels.length / 4);
};

const pixelAt = (pixels: Uint8Array, size: number, x: number, y: number) => {
  const index = (y * size + x) * 4;
  return [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!] as const;
};

/** Mean absolute per-channel difference between neighbouring texels. */
const neighbourStep = (from: readonly number[], to: readonly number[]) =>
  (Math.abs(from[0]! - to[0]!) + Math.abs(from[1]! - to[1]!) + Math.abs(from[2]! - to[2]!)) / 3;

/** Seam step / average interior step. A wrapped, seamless tile stays near 1 at every mip. */
const seamRatio = (pixels: Uint8Array, size: number) => {
  let horizontal = 0;
  let vertical = 0;
  let seamX = 0;
  let seamY = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const current = pixelAt(pixels, size, x, y);
      const stepX = neighbourStep(current, pixelAt(pixels, size, (x + 1) % size, y));
      const stepY = neighbourStep(current, pixelAt(pixels, size, x, (y + 1) % size));
      horizontal += stepX;
      vertical += stepY;
      if (x === size - 1) seamX += stepX;
      if (y === size - 1) seamY += stepY;
    }
  }
  return {
    x: seamX / size / (horizontal / (size * size)),
    y: seamY / size / (vertical / (size * size))
  };
};

/** Box-filtered next mip, the same average the GPU mip chain applies. */
const downsample = (pixels: Uint8Array, size: number) => {
  const half = size >> 1;
  const result = new Uint8Array(half * half * 4);
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        let sum = 0;
        for (let offsetY = 0; offsetY < 2; offsetY += 1) {
          for (let offsetX = 0; offsetX < 2; offsetX += 1) {
            const from = ((y * 2 + offsetY) * size + x * 2 + offsetX) * 4 + channel;
            sum += pixels[from]!;
          }
        }
        result[(y * half + x) * 4 + channel] = Math.round(sum / 4);
      }
    }
  }
  return result;
};

const meanColor = (pixels: Uint8Array) =>
  [0, 1, 2].map(channel => meanChannel(pixels, channel));

const collect = (pixels: Uint8Array, extract: (index: number) => number) => {
  const values = new Set<number>();
  for (let index = 0; index < pixels.length; index += 4) values.add(extract(index));
  return values;
};

describe("generated grass material atlas", () => {
  const meadow = generateMaterialLayer(0, SIZE, SEED);
  const lush = generateMaterialLayer(1, SIZE, SEED);
  const shade = generateMaterialLayer(2, SIZE, SEED);

  it("is deterministic for the same material and seed", () => {
    const repeated = generateMaterialLayer(0, SIZE, SEED);
    expect(repeated.albedoHeight).toEqual(meadow.albedoHeight);
    expect(repeated.normalRoughness).toEqual(meadow.normalRoughness);
  });

  it("keeps colour, height, normal, occlusion and roughness variation", () => {
    for (const layer of [meadow, lush, shade]) {
      expect(collect(layer.albedoHeight, index =>
        (layer.albedoHeight[index]! << 16) |
        (layer.albedoHeight[index + 1]! << 8) |
        layer.albedoHeight[index + 2]!).size).toBeGreaterThan(400);
      expect(collect(layer.albedoHeight, index => layer.albedoHeight[index + 3]!).size)
        .toBeGreaterThan(8);
      expect(collect(layer.normalRoughness, index => layer.normalRoughness[index]!).size)
        .toBeGreaterThan(8);
      expect(collect(layer.normalRoughness, index => layer.normalRoughness[index + 2]!).size)
        .toBeGreaterThan(8);
      expect(collect(layer.normalRoughness, index => layer.normalRoughness[index + 3]!).size)
        .toBeGreaterThan(8);
    }
  });

  it("keeps visible soil, green blades and dry stems in the meadow tile", () => {
    let soil = 0;
    let blades = 0;
    let dry = 0;
    const count = meadow.albedoHeight.length / 4;
    for (let index = 0; index < meadow.albedoHeight.length; index += 4) {
      const red = meadow.albedoHeight[index]! / 255;
      const green = meadow.albedoHeight[index + 1]! / 255;
      const blue = meadow.albedoHeight[index + 2]! / 255;
      if (red >= green * 0.98 && green >= blue * 1.1 && red > 0.18 && red < 0.55) soil += 1;
      if (green > red * 1.08 && green > blue * 1.4) blades += 1;
      if (red > green * 0.88 && green > blue * 1.15 && red > 0.35 && green > 0.28) dry += 1;
    }
    expect(soil / count).toBeGreaterThan(0.06);
    expect(blades / count).toBeGreaterThan(0.55);
    expect(dry / count).toBeGreaterThan(0.045);
  });

  it("separates meadow, lush and shaded floor by colour and moisture", () => {
    const greenDominance = (pixels: Uint8Array) =>
      meanChannel(pixels, 1) - (meanChannel(pixels, 0) + meanChannel(pixels, 2)) * 0.5;
    expect(greenDominance(meadow.albedoHeight)).toBeGreaterThan(0);
    expect(greenDominance(lush.albedoHeight)).toBeGreaterThan(greenDominance(meadow.albedoHeight));
    expect(meanChannel(shade.albedoHeight, 1)).toBeLessThan(meanChannel(meadow.albedoHeight, 1));
  });

  it("stays seamless at tile edges and through the simulated mip chain", () => {
    for (const material of GRASS_MATERIALS) {
      let pixels = generateMaterialLayer(material, SIZE, SEED).albedoHeight;
      let size = SIZE;
      const firstMean = meanColor(pixels);
      for (let level = 0; level < 4; level += 1) {
        const seam = seamRatio(pixels, size);
        expect(seam.x, `material ${material} mip ${level} x seam`).toBeLessThan(2.5);
        expect(seam.y, `material ${material} mip ${level} y seam`).toBeLessThan(2.5);
        const currentMean = meanColor(pixels);
        currentMean.forEach((channel, index) => {
          expect(Math.abs(channel - firstMean[index]!)).toBeLessThan(0.5);
        });
        if (level === 3) break;
        pixels = downsample(pixels, size);
        size >>= 1;
      }
    }
  });

  it("halves every layer on its own with the mip box filter for a smaller tile tier", () => {
    const layers = [generateMaterialLayer(0, SIZE, SEED), generateMaterialLayer(4, SIZE, SEED)];
    const set = packGroundLayers(layers, SIZE);
    expect(downsampleGroundLayers(set, SIZE)).toBe(set);
    const quarter = downsampleGroundLayers(set, SIZE / 4);
    expect([quarter.size, quarter.layerCount]).toEqual([SIZE / 4, 2]);
    const layerBytes = (SIZE / 4) ** 2 * 4;
    layers.forEach((layer, index) => {
      for (const channel of ["albedoHeight", "normalRoughness"] as const) {
        const expected = downsample(downsample(layer[channel], SIZE), SIZE / 2);
        expect(quarter[channel].subarray(index * layerBytes, (index + 1) * layerBytes)).toEqual(expected);
      }
    });
  });

  it("keeps the two texture-array contract: 512² High, 256² Minimal, one layer per material + variants", () => {
    expect(MATERIAL_TILE_SIZE).toBe(512);
    expect(GROUND_LAYER_COUNT)
      .toBe(MATERIAL_COUNT + GROUND_VARIANT_TILE_COUNT + GROUND_LITTER_COUNT + GROUND_DETAIL_COUNT);
    expect(GROUND_LAYERS_GLSL.match(/uniform sampler2DArray/g)).toHaveLength(2);
    for (const glsl of Object.values(GROUND_VARIANT_GLSL)) {
      expect(glsl).toContain(GROUND_LAYERS_GLSL);
      expect(glsl).not.toMatch(/ATLAS_|atlasCellUv|uAlbedoAtlas|uNormalAtlas/);
    }
    expect(QUALITY_PRESETS.high.groundTileSize).toBe(512);
    expect(QUALITY_PRESETS.low.groundTileSize).toBe(512);
    expect(QUALITY_PRESETS.minimal.groundTileSize).toBe(256);
    expect(QUALITY_PRESETS.high.liteGround).toBe(false);
    expect(QUALITY_PRESETS.minimal.liteGround).toBe(true);
  });
});
