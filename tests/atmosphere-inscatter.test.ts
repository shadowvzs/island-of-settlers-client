import { OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";

import { ATMOSPHERE_GLSL } from "../src/render-common/atmosphere/atmosphere-glsl";
import { computeEnvironment, getSunVector, TIME_PRESETS } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../src/render-common/shaders/color-output-glsl";
import { createAtmosphereState } from "../src/renderers/three/atmosphere/atmosphere-state";
import { DEFAULT_SUN } from "../src/shared/world/lighting";

const WORLD = { cellsX: 128, cellsZ: 128, seaLevel: 0 };

const luminance = (rgb: ArrayLike<number>) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;

const updateAt = (hour: number, rain = 0) => {
  const values = createSharedUniformValues(WORLD);
  const environment = computeEnvironment(DEFAULT_SUN, hour, rain, 0, 0.45 + rain * 0.5, 0);
  createAtmosphereState(WORLD, QUALITY_PRESETS.high, values)
    .update(new OrthographicCamera(), environment, false);
  return { environment, values };
};

/** The GLSL `atmospherePhase` on the CPU. */
const phase = (cosTheta: number, g: number) => {
  const denominator = 1 + g * g - 2 * g * cosTheta;
  return (1 - g * g) / (denominator * Math.sqrt(denominator));
};

describe("R06a sun inscatter", () => {
  it("only redistributes the haze: the phase averages 1 over the sphere", () => {
    const rows = 2000;
    let sum = 0;
    for (let row = 0; row < rows; row++) sum += phase(1 - (2 * (row + 0.5)) / rows, 0.65);
    expect(sum / rows).toBeCloseTo(1, 2);
    expect(phase(1, 0.65)).toBeGreaterThan(phase(-1, 0.65) * 50);
  });

  it("points the lobe at the sun with the airlight's own luminance", () => {
    const { environment, values } = updateAt(TIME_PRESETS.day);
    const sun = getSunVector(environment.sun);
    for (let axis = 0; axis < 3; axis++) expect(values.uAtmosphereSun[axis]).toBeCloseTo(sun[axis]!, 5);
    expect(values.uAtmosphereSun[3]).toBeCloseTo(0.12, 5);
    expect(luminance(values.uAtmosphereSunTint)).toBeCloseTo(luminance(values.uAtmosphereAirlightLinear), 5);
    expect(values.uAtmosphereSunTint[3]).toBeCloseTo(0.65, 5);
  });

  it("warms the lobe at dusk and weakens it at night and in rain", () => {
    const dusk = updateAt(TIME_PRESETS.dusk).values.uAtmosphereSunTint;
    const day = updateAt(TIME_PRESETS.day).values.uAtmosphereSunTint;
    expect(dusk[0]! / dusk[2]!).toBeGreaterThan(day[0]! / day[2]!);
    expect(updateAt(TIME_PRESETS.night).values.uAtmosphereSun[3]).toBeCloseTo(0.036, 5);
    expect(updateAt(TIME_PRESETS.day, 1).values.uAtmosphereSun[3]).toBeLessThan(0.04);
  });

  it("composes every material through the direction-dependent airlight", () => {
    expect(ATMOSPHERE_GLSL).toContain("return mix(radiance, atmosphereAirlight(direction, tau),");
    expect(ATMOSPHERE_GLSL).toContain(
      "return composeAtmosphereLinearToward(radiance, tau, normalize(uAtmosphereForward));"
    );
    expect(SURFACE_COLOR_OUTPUT_GLSL).toContain("atmosphereViewDirection(worldPosition));");
  });
});
