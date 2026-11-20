import { describe, expect, it } from "vitest";

import { computeSnowKeep } from "../src/render-common/snow-distribution";
import { createSnowMap, SNOW_MAP_GLSL } from "../src/render-common/snow-map";
import { THEME_COUNT } from "../src/shared/world/generation/island-themes";
import { MATERIAL_COUNT, type WorldData } from "../src/shared/world/world-data";

type SnowWorld = Parameters<typeof computeSnowKeep>[0];

const GRID = 16;
const STRIDE = GRID + 1;

const makeWorld = (
  heights: Float32Array,
  coast = 10,
  river = 10
): SnowWorld => {
  const count = STRIDE * STRIDE;
  return {
    ambientOcclusion: new Uint8Array(count).fill(255),
    cellsX: GRID,
    cellsZ: GRID,
    coastDistance: new Float32Array(count).fill(coast),
    heights,
    riverDistance: new Float32Array(count).fill(river),
    splat: new Uint8Array(count * MATERIAL_COUNT)
  };
};

const withThemes = (world: SnowWorld): WorldData => ({
  ...world,
  themeWeights: new Uint8Array(STRIDE * STRIDE * THEME_COUNT)
}) as unknown as WorldData;

const flatHeights = () => new Float32Array(STRIDE * STRIDE);

describe("snow keep field", () => {
  it("keeps flat ground white and steep sun-facing slopes bare", () => {
    const flat = computeSnowKeep(makeWorld(flatHeights()));
    expect(flat[8 * STRIDE + 8]).toBeCloseTo(1, 6);

    const heights = flatHeights();
    for (let z = 0; z <= GRID; z += 1)
      for (let x = 0; x <= GRID; x += 1) heights[z * STRIDE + x] = x * 2;
    const steep = computeSnowKeep(makeWorld(heights));
    expect(steep[8 * STRIDE + 8]).toBeLessThan(flat[8 * STRIDE + 8]!);
    expect(steep[8 * STRIDE + 8]).toBeLessThan(0.5);
  });

  it("keeps more snow in a lee hollow than on a windward crest", () => {
    const ridge = flatHeights();
    for (let z = 0; z <= GRID; z += 1)
      for (let x = 0; x <= GRID; x += 1) ridge[z * STRIDE + x] = x <= 4 ? 6 : 0;
    const lee = makeWorld(ridge);
    lee.ambientOcclusion[8 * STRIDE + 8] = 0;
    const leeKeep = computeSnowKeep(lee)[8 * STRIDE + 8]!;

    const windward = flatHeights();
    for (let z = 0; z <= GRID; z += 1)
      for (let x = 0; x <= GRID; x += 1) windward[z * STRIDE + x] = x * 1.5;
    const crestKeep = computeSnowKeep(makeWorld(windward))[8 * STRIDE + 8]!;

    expect(leeKeep).toBeGreaterThan(crestKeep);
  });

  it("keeps full snow two cells from the coast or a river", () => {
    const vertex = 8 * STRIDE + 8;
    expect(computeSnowKeep(makeWorld(flatHeights(), 2))[vertex]).toBe(1);
    expect(computeSnowKeep(makeWorld(flatHeights(), 10, 2))[vertex]).toBe(1);
  });

  it("writes the keep field to G only when winter is active", () => {
    const flat = makeWorld(flatHeights());
    const plain = createSnowMap(withThemes(flat));
    expect(plain.distribution).toBe(false);
    expect(plain.pixels[(8 * STRIDE + 8) * 4 + 1]).toBe(255);

    const winter = createSnowMap(withThemes(flat), { visualWinter: true });
    expect(winter.distribution).toBe(true);
    expect(winter.pixels[(8 * STRIDE + 8) * 4 + 1]).toBe(255);

    const heights = flatHeights();
    for (let z = 0; z <= GRID; z += 1)
      for (let x = 0; x <= GRID; x += 1) heights[z * STRIDE + x] = x * 2;
    const steep = createSnowMap(withThemes(makeWorld(heights)), { visualWinter: true });
    expect(steep.pixels[(8 * STRIDE + 8) * 4 + 1]).toBe(0);
    expect(SNOW_MAP_GLSL).toContain("float getSnowKeep(vec2 xz)");
  });
});
