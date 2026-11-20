import { Texture } from "three";
import { describe, expect, it } from "vitest";

import {
  applySeasonPrecipitation,
  isSeasonSnowClimate
} from "../src/render-common/seasonal-appearance/season-snowfall";
import { SUMMER_WEIGHTS } from "../src/render-common/seasonal-appearance/season-weights";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";
import { createPropMaterial, getWinterDefines } from "../src/renderers/three/three-prop-materials";

const snowUniforms = (userData: Record<string, boolean>) => {
  const texture = new Texture();
  Object.assign(texture.userData, userData);
  return { uSnowMap: { value: texture } };
};

describe("global winter on the GPU (T1)", () => {
  it("leaves the summer weather exact and snows first on the way to winter", () => {
    const target = { rain: 0, snow: 0 };
    expect(applySeasonPrecipitation(0.7, 0.2, SUMMER_WEIGHTS, target)).toEqual({ rain: 0.7, snow: 0.2 });
    expect(applySeasonPrecipitation(0, 0, { ...SUMMER_WEIGHTS, snowfall: 1 }, target).snow).toBeGreaterThan(0.5);
    const covered = applySeasonPrecipitation(1, 0, { ...SUMMER_WEIGHTS, snowCover: 1 }, target);
    expect(covered).toEqual({ rain: 0, snow: 1 });
    expect(isSeasonSnowClimate({ ...SUMMER_WEIGHTS, snowCover: 0.6 })).toBe(true);
    expect(isSeasonSnowClimate(SUMMER_WEIGHTS)).toBe(false);
  });

  it("compiles the season snow and its keep share into both ground variants only while armed", () => {
    const texture = new Texture();
    for (const variant of ["full", "lite"] as const) {
      const armed = createTerrainMaterial(snowUniforms({ distribution: true, seasonSnow: true,
        seasonalDistribution: true }), texture, texture, variant);
      expect(armed.defines).toMatchObject({ SEASON_SNOW: "", SNOW_DISTRIBUTION: "", SNOW_DISTRIBUTION_SEASONAL: "" });
      expect(armed.fragmentShader).toContain("coverSeasonSnow(mountainSplatA, mountainSplatB, mountainSplatC, xz, vWater.x,");
      // seasons-5: rock and mine ground take the snow where the slope holds it; the keep returns snow to stone.
      expect(armed.fragmentShader).toContain("getSeasonStoneHold(normal)");
      expect(armed.fragmentShader).toContain("getSnowReturnShares(");
      expect(armed.fragmentShader).toContain("return max(snowyShore, getSeasonIce());");
      const midWinter = createTerrainMaterial(snowUniforms({ seasonSnow: true, visualWinter: true }), texture, texture,
        variant);
      expect(midWinter.defines ?? {}).not.toHaveProperty("FROZEN_SHORE");
      expect(armed.fragmentShader).toContain("* distributionShare");
      const summer = createTerrainMaterial({}, texture, texture, variant);
      expect(summer.defines ?? {}).not.toHaveProperty("SEASON_SNOW");
    }
  });

  it("gives props the snow load while armed, and the tufts only the season thinning", () => {
    const uniforms = snowUniforms({ seasonSnow: true });
    expect(getWinterDefines(uniforms)).toEqual({ SEASON_SNOW: "", WINTER: "" });
    expect(getWinterDefines(uniforms, true)).toEqual({ SEASON_SNOW: "" });
    expect(getWinterDefines(snowUniforms({ hasSnow: true }))).toEqual({ WINTER: "" });
    expect(getWinterDefines({})).toEqual({});
    const tufts = createPropMaterial(uniforms, true);
    expect(tufts.vertexShader).toContain("getSeasonTuftKeep(tuftSnow, instanceData.x)");
    expect(createPropMaterial(uniforms, false).fragmentShader).toContain("getPropSnow(vWorld, winter)");
    // seasons-5: broadleaf leaves carry a share of the season's load (evergreen broadleaf: no blossom look).
    expect(createPropMaterial(uniforms, false).fragmentShader).toContain("getFoliageSnowLoad(kind, winter, snow)");
  });
});
