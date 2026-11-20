import { Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  createSkyModelInputs,
  fillSkyModelInputs,
  writeSkyModelRadiance
} from "../src/render-common/atmosphere/sky-model";
import { computeEnvironment, getSunVector, TIME_PRESETS } from "../src/render-common/environment";
import {
  createSkyLight,
  SKY_SH_FLOATS,
  writeHemisphereSkyLight
} from "../src/render-common/lighting/sky-irradiance";
import { createSharedUniformValues, updateSharedUniformValues } from "../src/render-common/shader-uniforms";
import { LIGHTING_GLSL } from "../src/render-common/shaders/common-glsl";
import { WATER_GLSL } from "../src/render-common/shaders/water-glsl";
import { createSkyLightProbe } from "../src/renderers/three/sky-light-probe";
import { DEFAULT_SUN } from "../src/shared/world/lighting";

type Rgb = [number, number, number];

/** The GLSL `skyIrradiance` / `skyReflection` polynomial on the CPU. */
const evaluate = (coefficients: Float32Array, [x, y, z]: Rgb): Rgb => {
  const polynomial = [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y];
  const result: Rgb = [0, 0, 0];
  for (let index = 0; index < 9; index++)
    for (let channel = 0; channel < 3; channel++)
      result[channel]! += coefficients[index * 3 + channel]! * polynomial[index]!;
  return result;
};

/** The SKY_IRRADIANCE_L1 path: linear band plus the quadratic band's vertical part. */
const evaluateLite = (coefficients: Float32Array, [x, y, z]: Rgb): Rgb => {
  const polynomial = [1, y, z, x];
  const result: Rgb = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    for (let index = 0; index < 4; index++)
      result[channel]! += coefficients[index * 3 + channel]! * polynomial[index]!;
    result[channel]! -= (coefficients[18 + channel]! + coefficients[24 + channel]!) * y * y;
  }
  return result;
};

const environmentAt = (hour: number, rain = 0) =>
  computeEnvironment(DEFAULT_SUN, hour, rain, 0, 0.45 + rain * 0.5, 0);

const luma = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b;

const maxDifference = (actual: Rgb, expected: readonly number[]) =>
  Math.max(...actual.map((value, channel) => Math.abs(value - expected[channel]!)));

const UP: Rgb = [0, 1, 0];
const DOWN: Rgb = [0, -1, 0];

describe("SH9 sky light", () => {
  it("reproduces the plain hemisphere exactly as a fallback", () => {
    const irradiance = new Float32Array(SKY_SH_FLOATS);
    const reflection = new Float32Array(SKY_SH_FLOATS);
    writeHemisphereSkyLight([0.5, 0.6, 0.7], [0.3, 0.2, 0.1], irradiance, reflection);
    expect(maxDifference(evaluate(irradiance, UP), [0.5, 0.6, 0.7])).toBeLessThan(1e-6);
    expect(maxDifference(evaluate(irradiance, [1, 0, 0]), [0.4, 0.4, 0.4])).toBeLessThan(1e-6);
    expect(maxDifference(evaluate(reflection, [0.3, 0.4, 0.866]), [0.5, 0.6, 0.7])).toBeLessThan(1e-6);
  });

  it("keeps the keyframe ambient on up- and down-facing surfaces", () => {
    for (const hour of Object.values(TIME_PRESETS)) {
      const environment = environmentAt(hour);
      const light = createSkyLight()(environment);
      expect(maxDifference(evaluate(light.irradiance, UP), environment.ambientSky)).toBeLessThan(0.03);
      expect(maxDifference(evaluate(light.irradiance, DOWN), environment.ambientGround))
        .toBeLessThan(0.03);
    }
  });

  it("matches the full sky light on flat and gently sloped Minimal ground", () => {
    const slope: Rgb = [0.34, 0.94, 0];
    for (const hour of Object.values(TIME_PRESETS)) {
      const light = createSkyLight()(environmentAt(hour));
      expect(maxDifference(evaluateLite(light.irradiance, UP), evaluate(light.irradiance, UP)))
        .toBeLessThan(1e-6);
      const full = evaluate(light.irradiance, slope);
      const lite = evaluateLite(light.irradiance, slope);
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(lite[channel]! - full[channel]!) / full[channel]!).toBeLessThan(0.03);
    }
  });

  it("warms the sun side and cools the far side at dusk", () => {
    const environment = environmentAt(TIME_PRESETS.dusk);
    const [x, , z] = getSunVector(environment.sun);
    const length = Math.hypot(x, z);
    const light = createSkyLight()(environment);
    const toward = evaluate(light.irradiance, [x / length, 0, z / length]);
    const away = evaluate(light.irradiance, [-x / length, 0, -z / length]);
    expect(toward[0] / toward[2]).toBeGreaterThan(away[0] / away[2]);
    expect(luma(toward)).toBeGreaterThan(luma(away));
  });

  it("reflects a deeper zenith and a paler horizon by day", () => {
    const light = createSkyLight()(environmentAt(TIME_PRESETS.day));
    const zenith = evaluate(light.reflection, UP);
    const horizon = evaluate(light.reflection, [0.6, 0.05, 0.8]);
    expect(luma(horizon)).toBeGreaterThan(luma(zenith));
    expect(zenith[2] / zenith[0]).toBeGreaterThan(horizon[2] / horizon[0]);
    expect(maxDifference(evaluate(light.reflection, [0.6, -0.05, 0.8]), horizon)).toBeLessThan(1e-5);
  });

  it("reflects the visible sky itself on water by day (one source with the sky shaders)", () => {
    for (const hour of [TIME_PRESETS.day, TIME_PRESETS.day + 2]) {
      const environment = environmentAt(hour);
      const light = createSkyLight()(environment);
      const inputs = createSkyModelInputs();
      fillSkyModelInputs(environment, inputs);
      const sky = new Float64Array(3);
      // Grazing reflections (the possessed view) show the horizon: SH9 keeps it within 15 %.
      for (const direction of [[0.995, 0.1, 0], [-0.995, 0.1, 0], [0, 0.1, 0.995]] as Rgb[]) {
        writeSkyModelRadiance(inputs, ...direction, sky);
        expect(Math.abs(luma(evaluate(light.reflection, direction)) / luma([...sky] as Rgb) - 1))
          .toBeLessThan(0.15);
      }
      // The steep zenith gradient rings in nine terms: never brighter than the sky above.
      writeSkyModelRadiance(inputs, ...UP, sky);
      expect(luma(evaluate(light.reflection, UP))).toBeLessThan(luma([...sky] as Rgb));
    }
  });

  it("lifts the reflection of a dark horizon to the palette's sky light (no airlight in it)", () => {
    const environment = environmentAt(TIME_PRESETS.night);
    const light = createSkyLight()(environment);
    const horizon = evaluate(light.reflection, [0.995, 0.1, 0]);
    expect(luma(horizon)).toBeGreaterThan(luma([...environment.ambientSky] as Rgb) * 0.8);
  });

  it("projects again only when the light changes, into the same arrays", () => {
    const sky = createSkyLight();
    const environment = environmentAt(TIME_PRESETS.day);
    const first = sky(environment);
    const { irradiance, revision } = first;
    expect(sky({ ...environment }).revision).toBe(revision);
    const later = sky(environmentAt(TIME_PRESETS.day + 1));
    expect(later.revision).toBe(revision + 1);
    expect(later.irradiance).toBe(irradiance);
  });

  it("feeds the shared raw uniforms every frame from the environment", () => {
    const values = createSharedUniformValues();
    expect(maxDifference(evaluate(values.uSkyIrradiance, UP), [0.52, 0.6, 0.72])).toBeLessThan(1e-6);
    const environment = environmentAt(TIME_PRESETS.night);
    updateSharedUniformValues(values, { environment, time: 1 });
    expect(maxDifference(evaluate(values.uSkyIrradiance, UP), environment.ambientSky))
      .toBeLessThan(0.03);
  });
});

describe("SH9 sky light on built-in materials", () => {
  it("gives the light probe the hemisphere rig's up-facing irradiance", () => {
    const environment = environmentAt(TIME_PRESETS.day);
    const { probe, update } = createSkyLightProbe();
    new Scene().add(probe);
    update(environment);
    const irradiance = probe.sh.getIrradianceAt(new Vector3(0, 1, 0), new Vector3())
      .multiplyScalar(probe.intensity);
    // The former HemisphereLight(sky, ground, 1.8) delivered 1.8 × ambientSky here.
    expect(maxDifference(irradiance.toArray() as Rgb, environment.ambientSky.map(value => value * 1.8)))
      .toBeLessThan(0.06);
  });
});

describe("SH9 sky light shaders", () => {
  it("replaces the hemisphere ambient in the shared surface lighting", () => {
    expect(LIGHTING_GLSL).toContain("vec3 sky = skyIrradiance(normal);");
    expect(LIGHTING_GLSL).not.toContain("mix(uAmbientGround, uAmbientSky");
    expect(LIGHTING_GLSL).toContain("#ifdef SKY_IRRADIANCE_L1");
  });

  it("reflects the sky light on water instead of a constant colour", () => {
    expect(WATER_GLSL).toContain("vec3 sky = skyReflection(reflect(-viewDirection, normal));");
    expect(WATER_GLSL).not.toContain("uAmbientSky * reflection");
    expect(WATER_GLSL).toContain("daySunGlint(normal, clouds, viewDirection)");
  });
});
