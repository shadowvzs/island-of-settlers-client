import { describe, expect, it } from "vitest";

import {
  generateMaterialLayer, GROUND_LAYER_COUNT, MATERIAL_TILE_SIZE, packGroundLayers
} from "../src/render-common/materials/material-textures";
import { createPeriodicNoise } from "../src/render-common/materials/periodic-noise";
import { MATERIAL_COUNT } from "../src/shared/world/world-data";

describe("periodic ground detail and its packed texture budget", () => {
  it("keeps grain, aggregate and warped-field noise periodic, including slopes across tile edges", () => {
    const noise = createPeriodicNoise(1234), epsilon = .00001;
    for (const period of [3, 7, 9, 24, 62, 84, 104, 144]) {
      for (const [u, v] of [[.13, .71], [-.21, .34], [0, .47], [.36, 1]]) {
        expect(noise.gradient(u!, v!, period)).toBeCloseTo(noise.gradient(u! + 1, v! - 2, period), 10);
        expect(noise.fbm(u!, v!, period, 2)).toBeCloseTo(noise.fbm(u! + 1, v! - 2, period, 2), 10);
        const source = noise.worley(u!, v!, period), repeated = noise.worley(u! + 1, v! - 2, period);
        for (const channel of ["nearest", "second", "nearestId", "offsetX", "offsetY"] as const)
          expect(source[channel]).toBeCloseTo(repeated[channel], 10);
      }
      const slopeAt = (u: number) => (noise.gradient(u + epsilon, .37, period) -
        noise.gradient(u - epsilon, .37, period)) / (2 * epsilon);
      expect(slopeAt(0)).toBeCloseTo(slopeAt(1), 6);
    }
  });

  it("keeps normal slopes centred, with matte roughness and cavity AO in their original channels", () => {
    for (let material = 0; material < MATERIAL_COUNT; material++) {
      const layer = generateMaterialLayer(material, 64, 1234);
      expect(layer.albedoHeight.byteLength).toBe(64 * 64 * 4);
      expect(layer.normalRoughness.byteLength).toBe(layer.albedoHeight.byteLength);
      let normalX = 0, normalY = 0, occlusion = 0, roughness = 0;
      for (let offset = 0; offset < layer.normalRoughness.length; offset += 4) {
        const x = layer.normalRoughness[offset]! / 127.5 - 1;
        const y = layer.normalRoughness[offset + 1]! / 127.5 - 1;
        expect(x * x + y * y).toBeLessThanOrEqual(1.015);
        normalX += x; normalY += y;
        occlusion += layer.normalRoughness[offset + 2]!;
        roughness += layer.normalRoughness[offset + 3]!;
      }
      expect(Math.abs(normalX / 4096)).toBeLessThan(.06);
      expect(Math.abs(normalY / 4096)).toBeLessThan(.06);
      expect(occlusion / 4096).toBeGreaterThan(180);
      expect(roughness / 4096).toBeGreaterThan(150);
    }
  });

  it("packs both channels layer after layer without padding and retains the exact byte budget", () => {
    const size = MATERIAL_TILE_SIZE;
    const layers = Array.from({ length: GROUND_LAYER_COUNT }, (_, material) => {
      const albedoHeight = new Uint8Array(size * size * 4), normalRoughness = albedoHeight.slice();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        albedoHeight.set([material * 23, x & 255, y & 255, (x + y) & 255], offset);
        normalRoughness.set([x & 255, material * 23, (x - y) & 255, y & 255], offset);
      }
      return { albedoHeight, normalRoughness };
    });
    const set = packGroundLayers(layers);
    expect([set.layerCount, set.size]).toEqual([GROUND_LAYER_COUNT, 512]);
    // 9 painted + 4 variant + 2 litter layers x 512² x RGBA8 per channel pair (2 MiB per layer).
    expect(set.albedoHeight.byteLength + set.normalRoughness.byteLength).toBe(GROUND_LAYER_COUNT * 2_097_152);
    const layerBytes = size * size * 4;
    for (let material = 0; material < MATERIAL_COUNT; material++) {
      for (const x of [0, 17, size - 1]) for (const y of [0, 11, size - 1]) {
        const from = (y * size + x) * 4, to = material * layerBytes + from;
        for (const channel of ["albedoHeight", "normalRoughness"] as const)
          expect(set[channel].subarray(to, to + 4)).toEqual(layers[material]![channel].subarray(from, from + 4));
      }
    }
  });
});
