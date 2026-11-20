import { describe, expect, it } from "vitest";

import {
  createSkyModelInputs,
  fillSkyModelInputs,
  SKY_MODEL,
  SKY_MODEL_GLSL,
  writeSkyModelRadiance
} from "../src/render-common/atmosphere/sky-model";
import {
  createSkyViewLut,
  fillSkyViewLut,
  sampleSkyViewLut,
  SKY_VIEW_LUT_GLSL,
  skyViewElevation,
  skyViewV
} from "../src/render-common/atmosphere/sky-view-lut";
import { computeEnvironment, TIME_PRESETS } from "../src/render-common/environment";
import { DEFAULT_SUN } from "../src/shared/world/lighting";

const inputsAt = (hour: number, rain = 0) => {
  const inputs = createSkyModelInputs();
  fillSkyModelInputs(computeEnvironment(DEFAULT_SUN, hour, rain, 0, 0.45 + rain * 0.5, 0), inputs);
  return inputs;
};

const directions = () => {
  const result: [number, number, number][] = [];
  for (let elevation = -0.05; elevation < 1.55; elevation += 0.11)
    for (let azimuth = 0; azimuth < 2 * Math.PI; azimuth += 0.37)
      result.push([Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth)]);
  return result;
};

const luma = (rgb: ArrayLike<number>) => 0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!;

describe("sky-view LUT", () => {
  it("maps rows densely at the horizon and inverts its mapping", () => {
    for (const elevation of [-0.08, -0.03, 0, 0.01, 0.2, 0.9, Math.PI / 2])
      expect(skyViewElevation(skyViewV(elevation))).toBeCloseTo(elevation, 6);
    expect(skyViewV(0.05) - skyViewV(0)).toBeGreaterThan(skyViewV(1.05) - skyViewV(1));
  });

  it("reproduces the analytic sky model within a few percent of its luminance", () => {
    for (const hour of Object.values(TIME_PRESETS)) {
      const inputs = inputsAt(hour);
      const lut = createSkyViewLut();
      fillSkyViewLut(lut, inputs);
      const exact = new Float64Array(3), sampled = new Float64Array(3);
      for (const [x, y, z] of directions()) {
        writeSkyModelRadiance(inputs, x, y, z, exact);
        sampleSkyViewLut(lut, inputs, x, y, z, sampled);
        expect(Math.abs(luma(sampled) - luma(exact)) / luma(exact)).toBeLessThan(0.05);
      }
    }
  });

  it("brightens and warms the sky toward the low sun", () => {
    const inputs = inputsAt(TIME_PRESETS.dusk);
    const length = Math.hypot(inputs.sun[0]!, inputs.sun[2]!);
    const x = inputs.sun[0]! / length, z = inputs.sun[2]! / length;
    const toward = new Float64Array(3), away = new Float64Array(3);
    const lut = createSkyViewLut();
    fillSkyViewLut(lut, inputs);
    sampleSkyViewLut(lut, inputs, x * 0.99, 0.1, z * 0.99, toward);
    sampleSkyViewLut(lut, inputs, -x * 0.99, 0.1, -z * 0.99, away);
    expect(luma(toward)).toBeGreaterThan(luma(away));
    expect(toward[0]! / toward[2]!).toBeGreaterThan(away[0]! / away[2]!);
  });

  it("generates the GLSL twins from the shared constants", () => {
    expect(SKY_MODEL_GLSL).toContain(`pow(smoothstep(0.0, 1.0, direction.y), ${SKY_MODEL.zenithPower.toFixed(4)})`);
    expect(SKY_MODEL_GLSL).toContain("vec3(0.0350, 0.2150, 0.6600)");
    expect(SKY_VIEW_LUT_GLSL).toContain("texture(uSkyViewLut, vec2(u, v)).rgb");
  });
});
