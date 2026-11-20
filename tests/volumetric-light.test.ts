import { describe, expect, it } from "vitest";

import { getSunRaysSlider } from "../src/app/settings/sections/helpers";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  getSunRaysChoice,
  normalizeQualityOverrides,
  parseQualityOverrides,
  resolveQualityPreset,
  setSunRaysChoice
} from "../src/render-common/quality-overrides";
import {
  createVolumetricLightTuning,
  VOLUMETRIC_LIGHT_TUNING,
  type VolumetricLightScene,
  volumetricLightStrength
} from "../src/render-common/volumetric-light";

const DAWN: VolumetricLightScene = {
  cloudCover: 0.45, daylight: 1, possession: 1, rain: 0, shadowWeight: 1, sunHeight: 0.25
};

describe("R06c sun shaft strength", () => {
  it("runs only in the possessed view", () => {
    expect(volumetricLightStrength(DAWN)).toBeGreaterThan(0.9);
    expect(volumetricLightStrength({ ...DAWN, possession: 0 })).toBe(0);
  });

  it("is subtle at noon and absent at night", () => {
    const noon = volumetricLightStrength({ ...DAWN, sunHeight: 0.82 });
    expect(noon).toBeGreaterThan(0);
    expect(noon).toBeLessThan(volumetricLightStrength(DAWN) * 0.4);
    expect(volumetricLightStrength({ ...DAWN, daylight: 0 })).toBe(0);
  });

  it("fades out with overcast, rain and missing shadows", () => {
    expect(volumetricLightStrength({ ...DAWN, cloudCover: 0.95 })).toBe(0);
    expect(volumetricLightStrength({ ...DAWN, rain: 1 })).toBe(0);
    expect(volumetricLightStrength({ ...DAWN, shadowWeight: 0 })).toBe(0);
  });
});

describe("R06c presets and the Sun rays slider", () => {
  it("runs on High only", () => {
    expect(QUALITY_PRESETS.high.volumetricLight).toBe("fps-half");
    for (const level of ["medium", "low", "minimal"] as const)
      expect(QUALITY_PRESETS[level].volumetricLight).toBe("off");
  });

  it("0 % drops the pass on High and round-trips through storage", () => {
    const overrides = setSunRaysChoice("high", {}, 0);
    expect(overrides).toEqual({ sunRays: 0 });
    expect(resolveQualityPreset("high", overrides).volumetricLight).toBe("off");
    expect(getSunRaysChoice("high", parseQualityOverrides(JSON.stringify(overrides)))).toBe(0);
    expect(setSunRaysChoice("high", overrides, 100)).toEqual({});
    expect(resolveQualityPreset("high", {})).toBe(QUALITY_PRESETS.high);
  });

  it("scales the intensity linearly up to 200 % and leaves the rest of the tuning alone", () => {
    const preset = resolveQualityPreset("high", setSunRaysChoice("high", {}, 150));
    expect(preset).toMatchObject({ volumetricLight: "fps-half", volumetricLightStrength: 1.5 });
    expect(resolveQualityPreset("high", { sunRays: 900 }).volumetricLightStrength).toBe(2);
    expect(createVolumetricLightTuning()).toEqual(VOLUMETRIC_LIGHT_TUNING);
    const doubled = createVolumetricLightTuning(2);
    expect(doubled).toEqual({ ...VOLUMETRIC_LIGHT_TUNING, intensity: VOLUMETRIC_LIGHT_TUNING.intensity * 2 });
    expect(createVolumetricLightTuning(0.5).intensity).toBeCloseTo(VOLUMETRIC_LIGHT_TUNING.intensity / 2);
    expect(createVolumetricLightTuning(7).intensity).toBe(doubled.intensity);
  });

  it("migrates the stored checkbox: false is 0 %, true or absent is 100 %", () => {
    expect(parseQualityOverrides('{"sunRays":false}')).toEqual({ sunRays: 0 });
    expect(getSunRaysChoice("high", parseQualityOverrides('{"sunRays":false}'))).toBe(0);
    expect(getSunRaysChoice("high", parseQualityOverrides('{"sunRays":true}'))).toBe(100);
    expect(normalizeQualityOverrides("high", parseQualityOverrides('{"sunRays":true}'))).toEqual({});
    expect(getSunRaysChoice("high", parseQualityOverrides("{}"))).toBe(100);
    expect(parseQualityOverrides('{"sunRays":"on","grass":false}')).toEqual({ grass: false });
    expect(parseQualityOverrides('{"sunRays":-20}')).toEqual({ sunRays: 0 });
    expect(parseQualityOverrides('{"sunRays":137.4}')).toEqual({ sunRays: 137 });
  });

  it("is disabled with its reason below High and without sun shadows", () => {
    expect(setSunRaysChoice("medium", {}, 150)).toEqual({});
    expect(getSunRaysSlider("medium", {})).toMatchObject({ disabled: true, maxPercent: 200, percent: 0 });
    expect(getSunRaysSlider("medium", {}).title).toContain("High detail level only");
    expect(getSunRaysSlider("high", { sunShadows: false })).toMatchObject({ disabled: true, percent: 0 });
    expect(getSunRaysSlider("high", { sunShadows: false }).title).toContain("Needs sun shadows");
    expect(getSunRaysSlider("high", { sunRays: 150 })).toMatchObject({ disabled: false, percent: 150 });
    expect(getSunRaysSlider("high", {})).toMatchObject({ disabled: false, percent: 100 });
  });
});
