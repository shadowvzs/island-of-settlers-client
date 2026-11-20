import { OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";

import {
  atmosphereBankEyeVisibility,
  atmosphereBankOpticalDepth,
  atmosphereBankSegmentDensity,
  toAtmosphereBankUniform
} from "../src/render-common/atmosphere/atmosphere-bank";
import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from "../src/render-common/atmosphere/atmosphere-glsl";
import { computeEnvironment } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { createAtmosphereState } from "../src/renderers/three/atmosphere/atmosphere-state";

const profile = { density: 0.01, softness: 0.55, verticalScale: 0.3 };
const bank = { center: [0, 5, 0] as const, radius: 10 };
const INSIDE_EYE = [0, 5, 0] as const;

describe("analytical atmosphere banks", () => {
  it("adds bounded optical depth through a soft ellipsoid", () => {
    const through = atmosphereBankSegmentDensity(
      { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] },
      bank,
      profile,
      INSIDE_EYE
    );
    expect(through).toBeGreaterThan(0.1);
    expect(through).toBeLessThan(0.2);
    expect(atmosphereBankSegmentDensity(
      { direction: [1, 0, 0], length: 40, origin: [-20, 20, 0] },
      bank,
      profile,
      INSIDE_EYE
    )).toBe(0);
  });

  it("applies a bank only while the camera is inside its clear-air shell", () => {
    const path = { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] } as const;
    expect(atmosphereBankEyeVisibility(INSIDE_EYE, bank, profile)).toBe(1);
    expect(atmosphereBankEyeVisibility([0, 300, 0], bank, profile)).toBe(0);
    expect(atmosphereBankEyeVisibility([0, 5, 10], bank, profile)).toBe(0);
    const through = atmosphereBankOpticalDepth(path, [bank], profile, INSIDE_EYE);
    expect(through).toBeGreaterThan(0.1);
    // Camera above the bank: the straight path still crosses it, but clear camera air stays clear.
    expect(atmosphereBankOpticalDepth(path, [bank], profile, [0, 300, 0])).toBe(0);
    // A bank behind/around a distant camera cannot tint a nearby building either.
    expect(atmosphereBankSegmentDensity(
      { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] },
      bank,
      profile,
      [500, 400, 500]
    )).toBe(0);
    const edge = atmosphereBankEyeVisibility([0, 5, 9], bank, profile);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });

  it("flattens the vertical shell and adds two banks", () => {
    const nearTop = atmosphereBankSegmentDensity(
      { direction: [0, 0, 1], length: 30, origin: [0, 9, -15] },
      bank,
      profile,
      INSIDE_EYE
    );
    expect(nearTop).toBe(0);
    const one = atmosphereBankOpticalDepth(
      { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] },
      [bank],
      profile,
      INSIDE_EYE
    );
    const two = atmosphereBankOpticalDepth(
      { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] },
      [bank, bank],
      profile,
      INSIDE_EYE
    );
    expect(two).toBeCloseTo(one * 2);
  });

  it("ignores disabled or invalid density", () => {
    expect(atmosphereBankOpticalDepth(
      { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] },
      [bank],
      { ...profile, density: 0 },
      INSIDE_EYE
    )).toBe(0);
    expect(atmosphereBankSegmentDensity(
      { direction: [1, 0, 0], length: 40, origin: [-20, 5, 0] },
      { ...bank, radius: 0 },
      profile,
      INSIDE_EYE
    )).toBe(0);
  });

  it("packs one finite vec4 for the shader", () => {
    expect(toAtmosphereBankUniform({
      center: [1, Number.NaN, 3], radius: Number.POSITIVE_INFINITY
    })).toEqual([1, 0, 3, 0]);
  });

  it("ships the shader uniforms, eye gate and two-bank evaluation", () => {
    expect(ATMOSPHERE_UNIFORMS_GLSL).toContain("uniform vec4 uAtmosphereBankA;");
    expect(ATMOSPHERE_UNIFORMS_GLSL).toContain("uniform vec4 uAtmosphereBankParams;");
    expect(ATMOSPHERE_GLSL).toContain("atmosphereBanksOpticalDepth");
    expect(ATMOSPHERE_GLSL).toContain("atmosphereBankEyeVisibility");
    expect(ATMOSPHERE_GLSL).toContain("atmosphereBankEyeVisibility(bank, uAtmosphereEye)");
  });
});

describe("High-only bank state", () => {
  const world = { cellsX: 128, cellsZ: 128, seaLevel: 0 };
  const environment = computeEnvironment(
    { azimuthX: 0.8, azimuthZ: 0.6, elevation: 0.8 },
    12,
    0
  );

  it("enables two drifting banks only in the High strategic view", () => {
    const values = createSharedUniformValues(world);
    const state = createAtmosphereState(world, QUALITY_PRESETS.high, values);
    const camera = new OrthographicCamera();
    camera.position.set(300, 300, 300);
    state.update(camera, environment, false, 0, 10);
    expect(values.uAtmosphereBankParams[3]).toBe(2);
    expect(values.uAtmosphereBankParams[0]).toBeGreaterThan(0);
    const first = Array.from(values.uAtmosphereBankA);
    state.update(camera, environment, false, 0, 20);
    expect(Array.from(values.uAtmosphereBankA)).not.toEqual(first);
    expect(first.every(Number.isFinite)).toBe(true);
    state.update(camera, environment, true, 1, 20);
    expect(values.uAtmosphereBankParams[3]).toBe(0);
  });

  it("keeps Medium and Minimal free of the extra bank work", () => {
    for (const quality of [QUALITY_PRESETS.medium, QUALITY_PRESETS.low, QUALITY_PRESETS.minimal]) {
      const values = createSharedUniformValues(world);
      const state = createAtmosphereState(world, quality, values);
      state.update(new OrthographicCamera(), environment, false);
      expect(values.uAtmosphereBankParams[3]).toBe(0);
      expect(values.uAtmosphereBankParams[0]).toBe(0);
    }
  });
});
