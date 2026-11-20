import { describe, expect, it } from "vitest";

import type { GroundLayerSet } from "../src/render-common/materials/material-textures";
import { getWinterGroundMaterials } from "../src/render-common/seasonal-appearance/winter-shore";
import { createWaterMaterial } from "../src/renderers/three/three-materials";

/** The prepared winter differs only in the winter palette share (full instead of the season ice ramp). */
const paletteIndependent = (source: string) => source.replace(
  /float getWinterWaterShare\(\) \{\n  return [^;]*;/,
  "float getWinterWaterShare() {\n  return SEASONAL_SHARE;"
);

describe("winter water and banks", () => {
  for (const refraction of [true, false]) {
    it(`changes only the winter palette share with refraction ${refraction}`, () => {
      const uniforms = {}, normal = createWaterMaterial(uniforms, refraction);
      const winter = createWaterMaterial(uniforms, refraction, true);
      expect(winter.fragmentShader).not.toBe(normal.fragmentShader);
      expect(paletteIndependent(winter.fragmentShader)).toBe(paletteIndependent(normal.fragmentShader));
      expect(winter.vertexShader).toBe(normal.vertexShader);
      expect(winter.defines).toEqual(normal.defines);
      expect(winter.uniforms).toBe(uniforms);
      expect(winter.blending).toBe(normal.blending);
      expect(winter.transparent).toBe(normal.transparent);
      expect(createWaterMaterial(uniforms, refraction, false).fragmentShader).toBe(normal.fragmentShader);
      normal.dispose(); winter.dispose();
    });
  }

  it("cools only bank layers and preserves source bytes, relief, normal channels and layer size", () => {
    const size = 4, layerCount = 9, layerTexels = size * size;
    const albedoHeight = Uint8Array.from({ length: layerTexels * layerCount * 4 },
      (_, index) => [210, 165, 105, 73][index % 4]!);
    const normalRoughness = new Uint8Array(albedoHeight.length).fill(128);
    const source: GroundLayerSet = { albedoHeight, layerCount, normalRoughness, size };
    const before = albedoHeight.slice(), winter = getWinterGroundMaterials(source);
    expect(getWinterGroundMaterials(source)).toBe(winter);
    expect(source.albedoHeight).toEqual(before);
    expect(winter.albedoHeight.length).toBe(before.length);
    expect([winter.size, winter.layerCount]).toEqual([size, layerCount]);
    expect(winter.normalRoughness).toBe(normalRoughness);
    for (let texel = 0; texel < layerTexels * layerCount; texel++) {
      const material = Math.floor(texel / layerTexels), offset = texel * 4;
      expect(winter.albedoHeight[offset + 3]).toBe(before[offset + 3]);
      if (![3, 4, 7].includes(material)) {
        expect(winter.albedoHeight.subarray(offset, offset + 4)).toEqual(before.subarray(offset, offset + 4));
        continue;
      }
      expect(winter.albedoHeight[offset + 2]).toBeGreaterThan(winter.albedoHeight[offset]!);
      expect(winter.albedoHeight[offset + 1]).toBeLessThan(before[offset + 1]!);
    }
  });
});
