import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { TERRAIN_GENERATOR_VERSION, validGenerationProvenance } from "../src/shared/world/generation/generation-provenance";
import { applyTerrainVariation } from "../src/shared/world/generation/terrain-variation";

describe("terrain relief amplitude", () => {
  it("keeps sea and coastal ramp exact, makes flat inland level and preserves natural heights", () => {
    const original = new Float32Array([-4, -.1, 0, .3, .7, 2, 8]);
    const natural = original.slice(), flat = original.slice(), hilly = original.slice();
    applyTerrainVariation(natural, 1);
    applyTerrainVariation(flat, 0);
    applyTerrainVariation(hilly, 2);
    expect(natural).toEqual(original);
    expect([...flat]).toEqual([...new Float32Array([-4, -.1, 0, .3, .7, .7, .7])]);
    expect(hilly.slice(0, 5)).toEqual(original.slice(0, 5));
    expect(hilly[6]).toBeCloseTo(15.3);
  });

  it("bounds relief and handles invalid direct caller values without corrupting heights", () => {
    for (const amount of [NaN, Infinity, -1, 99]) {
      const heights = new Float32Array([-1, .3, 8]);
      applyTerrainVariation(heights, amount);
      expect([...heights].every(Number.isFinite)).toBe(true);
      expect(heights[0]).toBe(-1);
      expect(heights[2]).toBeGreaterThanOrEqual(.7 - 1e-6);
      expect(heights[2]).toBeLessThanOrEqual(15.3 + 1e-6);
    }
  });

  it("records a bounded replayable terrain setting in the exact generation recipe", () => {
    const provenance = (terrainVariation: number) => ({ version: 1,
      generatorVersion: TERRAIN_GENERATOR_VERSION, options: { ...DEFAULT_WORLD_OPTIONS, terrainVariation } });
    for (const amount of [0, .5, 1, 1.5, 2]) expect(validGenerationProvenance(provenance(amount))).toBe(true);
    for (const amount of [-1, 2.1, NaN, Infinity]) expect(validGenerationProvenance(provenance(amount))).toBe(false);
  });
});
