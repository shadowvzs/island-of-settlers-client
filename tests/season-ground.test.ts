import { Texture } from "three";
import { describe, expect, it } from "vitest";

import {
  createSeasonGroundUniforms,
  SEASON_GROUND_TUNING,
  writeSeasonGroundUniforms
} from "../src/render-common/seasonal-appearance/season-ground";
import { SUMMER_WEIGHTS } from "../src/render-common/seasonal-appearance/season-weights";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";

const write = (weights: Partial<typeof SUMMER_WEIGHTS>) => {
  const target = createSeasonGroundUniforms();
  writeSeasonGroundUniforms({ ...SUMMER_WEIGHTS, ...weights }, target);
  return target;
};

describe("ground season uniforms (C1)", () => {
  it("is all zero in summer, so a ground without the uniforms is the summer look", () => {
    expect(write({})).toEqual(createSeasonGroundUniforms());
    const target = createSeasonGroundUniforms();
    writeSeasonGroundUniforms(undefined, target);
    expect(target).toEqual(createSeasonGroundUniforms());
  });

  it("turns autumn grass straw-olive with more and warmer leaf litter", () => {
    const { litter, meadow } = write({ autumn: 1 });
    const tint = meadow.slice(0, 3).map(offset => offset + 1);
    expect(tint).toEqual([...SEASON_GROUND_TUNING.meadow.autumn].map(value => expect.closeTo(value, 6)));
    expect(tint[0]).toBeGreaterThan(tint[2]!);
    expect(meadow[3]).toBeCloseTo(SEASON_GROUND_TUNING.dryLean.autumn);
    expect(litter[3]).toBeCloseTo(0.8);
    expect(litter[0]).toBeGreaterThan(0);
  });

  it("dulls dormant grass, greens spring grass and wets the monsoon ground", () => {
    expect(write({ dormant: 1 }).meadow[1]).toBeLessThan(0);
    expect(write({ spring: 1 }).meadow[1]).toBeGreaterThan(0);
    const monsoon = write({ monsoon: 1 }).cover;
    expect(monsoon[0]).toBeCloseTo(SEASON_GROUND_TUNING.wetness.monsoon);
    expect(monsoon[1]).toBe(1);
    expect(write({ drySeason: 1 }).meadow[3]).toBeCloseTo(SEASON_GROUND_TUNING.dryLean.drySeason);
  });

  it("carries the snow cover ramp and keeps the damp band below the wet film", () => {
    const { cover } = write({ monsoon: 1, snowCover: 0.5, spring: 1 });
    expect(cover[3]).toBe(0.5);
    expect(cover[0]).toBeLessThanOrEqual(0.45);
  });

  it("compiles the season terms into both ground variants with summer defaults", () => {
    const texture = new Texture();
    for (const variant of ["full", "lite"] as const) {
      const material = createTerrainMaterial({}, texture, texture, variant);
      expect(material.fragmentShader).toContain("applySeasonMeadow(");
      expect(material.fragmentShader).toContain("getSeasonWetness(");
      expect(material.fragmentShader).toContain("uSeasonLitter.a");
      expect(material.uniforms.uSeasonMeadow!.value.toArray()).toEqual([0, 0, 0, 0]);
    }
  });
});
