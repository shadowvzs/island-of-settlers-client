import { describe, expect, it } from "vitest";

import { type AtlasRegion,buildAtlasMips } from "../src/render-common/baker/atlas-mips";
import { type BakedPasses,mergeBakedPasses } from "../src/render-common/baker/prop-baker";
import { createAtlasTexture } from "../src/renderers/three/three-materials";

const fill = (size: number, color: [number, number, number], alpha: number) => {
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < data.length; index += 4) {
    data.set([...color, alpha], index);
  }
  return data;
};

const coverage = (data: Uint8Array, width: number, region: AtlasRegion, threshold = 0.5) => {
  let count = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! / 255 >= threshold) count += 1;
    }
  }
  return count / (region.width * region.height);
};

describe("region-aware atlas mipmaps", () => {
  it("keeps adjacent sprite regions separate at every level", () => {
    const size = 16;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * 4;
        data.set(x < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], offset);
      }
    }
    const regions = [
      { height: 16, width: 8, x: 0, y: 0 },
      { height: 16, width: 8, x: 8, y: 0 }
    ];
    const mips = buildAtlasMips(data, size, size, regions, { mode: "alpha-test", maxLevels: 2 });
    expect(mips[0]!.data).toBe(data);
    for (const mip of mips.slice(1)) {
      const half = mip.width / 2;
      for (let y = 0; y < mip.height; y += 1) {
        for (let x = 0; x < half; x += 1) {
          const left = (y * mip.width + x) * 4;
          const right = (y * mip.width + half + x) * 4;
          expect(mip.data[left]).toBe(255);
          expect(mip.data[left + 2]).toBe(0);
          expect(mip.data[right]).toBe(0);
          expect(mip.data[right + 2]).toBe(255);
        }
      }
    }
  });

  it("restores the base thresholded coverage in alpha-test mode", () => {
    const size = 16;
    const data = fill(size, [120, 160, 90], 0);
    for (let y = 4; y < 8; y += 1) {
      for (let x = 4; x < 8; x += 1) {
        data[(y * size + x) * 4 + 3] = 255;
      }
    }
    const region = { height: size, width: size, x: 0, y: 0 };
    const target = coverage(data, size, region);
    const mips = buildAtlasMips(data, size, size, [region], { mode: "alpha-test", maxLevels: 2 });
    for (const mip of mips.slice(1)) {
      const scaled = { height: mip.height, width: mip.width, x: 0, y: 0 };
      expect(coverage(mip.data, mip.width, scaled)).toBeCloseTo(target, 1);
    }
  });

  it("keeps one-texel stems connected with thinFeatureKeep", () => {
    const size = 32;
    const data = fill(size, [90, 70, 50], 0);
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) data[(y * size + x) * 4 + 3] = 255;
    }
    for (let y = 0; y < size; y += 1) data[(y * size + 20) * 4 + 3] = 240;
    const region = { height: size, width: size, x: 0, y: 0 };
    const mips = buildAtlasMips(data, size, size, [region], {
      maxLevels: 2, mode: "alpha-test", thinFeatureKeep: 0.3
    });
    for (const mip of mips.slice(1)) {
      const column = 20 / (size / mip.width);
      for (let y = 0; y < mip.height; y += 1) {
        expect(mip.data[(y * mip.width + Math.floor(column)) * 4 + 3]).toBeGreaterThanOrEqual(128);
      }
      const scaled = { height: mip.height, width: mip.width, x: 0, y: 0 };
      expect(coverage(mip.data, mip.width, scaled)).toBeGreaterThanOrEqual(coverage(data, size, region) - 0.01);
    }
  });

  it("still drops a lone texel with thinFeatureKeep", () => {
    const size = 8;
    const data = fill(size, [90, 70, 50], 0);
    data[(7 * size + 7) * 4 + 3] = 255;
    for (let y = 1; y < 5; y += 1) {
      for (let x = 1; x < 5; x += 1) data[(y * size + x) * 4 + 3] = 255;
    }
    const mips = buildAtlasMips(data, size, size, [{ height: size, width: size, x: 0, y: 0 }], {
      maxLevels: 1, mode: "alpha-test", thinFeatureKeep: 0.3
    });
    expect(mips[1]!.data[(3 * 4 + 3) * 4 + 3]).toBeLessThan(128);
  });

  it("normalizes normal-map RGB at every generated mip level", () => {
    const size = 8;
    const data = fill(size, [180, 80, 210], 255);
    const region = { height: size, width: size, x: 0, y: 0 };
    const mips = buildAtlasMips(data, size, size, [region], { mode: "normal", maxLevels: 2 });
    expect(mips[0]!.data).toBe(data);
    for (const mip of mips.slice(1)) {
      for (let offset = 0; offset < mip.data.length; offset += 4) {
        const x = mip.data[offset]! / 127.5 - 1;
        const y = mip.data[offset + 1]! / 127.5 - 1;
        const z = mip.data[offset + 2]! / 127.5 - 1;
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
      }
    }
  });

  it("uploads manual mips without asking the GPU to regenerate them", () => {
    const data = fill(8, [120, 150, 90], 255);
    const mips = buildAtlasMips(data, 8, 8, [{ height: 8, width: 8, x: 0, y: 0 }], { maxLevels: 2 });
    const texture = createAtlasTexture(data, 8, 8, mips);
    try {
      expect(texture.generateMipmaps).toBe(false);
      expect(texture.mipmaps).toHaveLength(mips.length);
      expect((texture.mipmaps[0] as { data: Uint8Array }).data).toBe(data);
    } finally {
      texture.dispose();
    }
  });

  it("merges the colour and normal mip chains from split bake workers", () => {
    const color = fill(8, [120, 150, 90], 255);
    const normal = fill(8, [128, 128, 255], 255);
    const colorMips = buildAtlasMips(color, 8, 8, [{ height: 8, width: 8, x: 0, y: 0 }], { maxLevels: 2 });
    const normalMips = buildAtlasMips(normal, 8, 8, [{ height: 8, width: 8, x: 0, y: 0 }], {
      maxLevels: 2, mode: "normal"
    });
    const part = (pixels: BakedPasses["pixels"], mips: BakedPasses["mips"]): BakedPasses =>
      ({ height: 8, mips, pixels, sprites: [], width: 8 });
    const merged = mergeBakedPasses([
      part({ color }, { color: colorMips }),
      part({ normal }, { normal: normalMips }),
      part({ wind: new Uint8Array(16) }, {})
    ]);
    expect(merged.atlas.albedoMips).toBe(colorMips);
    expect(merged.atlas.normalMips).toBe(normalMips);
  });
});
