import { OrthographicCamera, PerspectiveCamera } from "three";
import { afterEach, describe, expect, it } from "vitest";

import { createEnvironmentController } from "../src/app/environment-controller";
import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from "../src/render-common/atmosphere/atmosphere-glsl";
import {
  advanceRainbowMoisture,
  rainbowReview,
  rainbowStrength,
  rainbowWeatherStrength
} from "../src/render-common/atmosphere/rainbow";
import { RAINBOW_SECONDARY_BOW } from "../src/render-common/atmosphere/rainbow-glsl";
import { computeEnvironment } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createSharedUniformValues, SCALAR_UNIFORMS } from "../src/render-common/shader-uniforms";
import { createAtmosphereState } from "../src/renderers/three/atmosphere/atmosphere-state";

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.4 };
const DAY = { daylight: 1, snow: 0 };

/** Seconds (0.1 s frames) of a shower ending at t = 0, with the bow strength at each second. */
const showerTimeline = () => {
  const controller = createEnvironmentController(SUN, { hour: 16, rain: true, snow: false });
  controller.update(0);
  controller.toggleRain();
  const strengths: number[] = [];
  for (let frame = 0; frame <= 4000; frame++) {
    const environment = controller.update(0.1);
    if (frame % 10 === 0) strengths.push(rainbowStrength({ ...environment, daylight: 1 }, 1));
  }
  return strengths;
};

describe("rainbow weather", () => {
  afterEach(() => { rainbowReview.force = null; });

  it("keeps the moisture at the rain and drains it slowly afterwards", () => {
    expect(advanceRainbowMoisture(0.2, 0.9, 0.1)).toBe(0.9);
    expect(advanceRainbowMoisture(1, 0, 24)).toBeCloseTo(0.9, 5);
    expect(advanceRainbowMoisture(0.01, 0, 10)).toBe(0);
    expect(advanceRainbowMoisture(0.5, 0, -5)).toBe(0.5);
    expect(advanceRainbowMoisture(Number.NaN, Number.NaN, 1)).toBe(0);
  });

  it("shows no bow in heavy rain, in dry air or without moisture", () => {
    expect(rainbowWeatherStrength(1, 1)).toBe(0);
    expect(rainbowWeatherStrength(1, 0.5)).toBe(0);
    expect(rainbowWeatherStrength(0, 0)).toBe(0);
    expect(rainbowWeatherStrength(0.8, 0)).toBe(1);
    expect(rainbowWeatherStrength(0.8, 0.2)).toBeGreaterThan(0);
  });

  it("fades in over 10-20 s as a shower clears, holds and fades out over 1-3 min", () => {
    const strengths = showerTimeline();
    const firstVisible = strengths.findIndex(value => value > 0.02);
    const full = strengths.findIndex(value => value > 0.98);
    const fading = strengths.findIndex((value, second) => second > full && value < 0.98);
    const gone = strengths.findIndex((value, second) => second > full && value < 0.02);
    expect(full - firstVisible).toBeGreaterThanOrEqual(10);
    expect(full - firstVisible).toBeLessThanOrEqual(20);
    expect(fading - full).toBeGreaterThan(30);
    expect(gone - fading).toBeGreaterThanOrEqual(60);
    expect(gone - fading).toBeLessThanOrEqual(180);
    expect(strengths.at(-1)).toBe(0);
  });

  it("needs the sun, liquid rain and the enabled view", () => {
    const after = { afterRain: 0.9, rain: 0 };
    expect(rainbowStrength({ ...after, ...DAY }, 1)).toBe(1);
    expect(rainbowStrength({ ...after, ...DAY }, 0)).toBe(0);
    expect(rainbowStrength({ ...after, ...DAY }, 0.5)).toBeCloseTo(0.5, 5);
    expect(rainbowStrength({ ...after, daylight: 0, snow: 0 }, 1)).toBe(0);
    expect(rainbowStrength({ ...after, daylight: 1, snow: 1 }, 1)).toBe(0);
    expect(rainbowStrength({ daylight: 1, rain: 0, snow: 0 }, 1)).toBe(0);
  });

  it("lets the review hook replace only the weather share", () => {
    rainbowReview.force = 0.75;
    expect(rainbowStrength({ ...DAY, rain: 1 }, 1)).toBeCloseTo(0.75, 5);
    expect(rainbowStrength({ ...DAY, rain: 1 }, 0)).toBe(0);
    expect(rainbowStrength({ daylight: 0, rain: 0, snow: 0 }, 1)).toBe(0);
  });

  it("resets the moisture when the day mode switches to a permanent clear day", () => {
    const controller = createEnvironmentController(SUN, { hour: 16, mode: "nature", rain: true, snow: false });
    expect(controller.update(0.1).afterRain).toBe(1);
    controller.setDayMode("sun");
    expect(controller.update(0.1).afterRain).toBe(0);
  });
});

describe("rainbow presets and shader", () => {
  it("is on for Medium and High, off for Low and Minimal", () => {
    expect(QUALITY_PRESETS.high.rainbow).toBe(true);
    expect(QUALITY_PRESETS.medium.rainbow).toBe(true);
    expect(QUALITY_PRESETS.low.rainbow).toBe(false);
    expect(QUALITY_PRESETS.minimal.rainbow).toBe(false);
  });

  it("binds one scalar strength that defaults to off", () => {
    expect(createSharedUniformValues().uAtmosphereRainbow).toBe(0);
    expect(SCALAR_UNIFORMS).toContain("uAtmosphereRainbow");
    expect(ATMOSPHERE_UNIFORMS_GLSL).toContain("uniform float uAtmosphereRainbow;");
  });

  it("adds one bow to the shared airlight with red outside violet", () => {
    expect(ATMOSPHERE_GLSL).toContain("+ atmosphereRainbowRadiance(direction)");
    expect(ATMOSPHERE_GLSL).toContain("theta - 40.600");
    expect(ATMOSPHERE_GLSL).toContain("theta - 42.400");
    expect(ATMOSPHERE_GLSL).not.toContain("texture(");
  });

  it("keeps the secondary bow and Alexander's band off by default", () => {
    expect(RAINBOW_SECONDARY_BOW).toBe(false);
    expect(ATMOSPHERE_GLSL).not.toContain("atmosphereRainbowSecondary");
    expect(ATMOSPHERE_GLSL).not.toContain("theta - 53.600");
    expect(ATMOSPHERE_GLSL).not.toContain("RAINBOW_OUTER_GLOW * (");
  });
});

describe("rainbow atmosphere state", () => {
  const world = { cellsX: 128, cellsZ: 128, seaLevel: 0 };
  const environment = { ...computeEnvironment(SUN, 16, 0, 0, 0.45, 0), afterRain: 0.9 };
  const strengthFor = (quality: keyof typeof QUALITY_PRESETS, possessed: boolean) => {
    const values = createSharedUniformValues(world);
    const camera = possessed ? new PerspectiveCamera() : new OrthographicCamera();
    createAtmosphereState(world, QUALITY_PRESETS[quality], values).update(camera, environment, possessed, 1, 0);
    return values.uAtmosphereRainbow;
  };

  it("draws the bow only in the possessed view on Medium and High", () => {
    expect(strengthFor("high", true)).toBeGreaterThan(0.9);
    expect(strengthFor("medium", true)).toBeGreaterThan(0.9);
    expect(strengthFor("low", true)).toBe(0);
    expect(strengthFor("minimal", true)).toBe(0);
    expect(strengthFor("high", false)).toBe(0);
  });
});
