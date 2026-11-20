import { OrthographicCamera, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import { computeEnvironment } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { createAtmosphereState, withoutAtmosphere } from "../src/renderers/three/atmosphere/atmosphere-state";
import { createThreeUniforms } from "../src/renderers/three/three-materials";

const world = { cellsX: 128, cellsZ: 128, seaLevel: 0 };
const environment = computeEnvironment({ azimuthX: 0.8, azimuthZ: 0.6, elevation: 0.8 }, 12, 0);

describe("renderer atmospheric state", () => {
  it("uses the actual walking eye without making FOV or view distance weather controls", () => {
    const values = createSharedUniformValues(world);
    const state = createAtmosphereState(world, QUALITY_PRESETS.high, values);
    const camera = new PerspectiveCamera(65, 1, 0.1, 260);
    camera.position.set(24, 2, 40);
    camera.lookAt(30, 2, 40);
    state.update(camera, environment, true);
    expect(Array.from(values.uAtmosphereEye)).toEqual([24, 2, 40]);
    const density = values.uAtmosphereProfile[0];
    camera.fov = 30;
    camera.far = 500;
    state.update(camera, environment, true);
    expect(values.uAtmosphereProfile[0]).toBe(density);
    expect(values.uAtmosphereFar).toBe(500);
    expect(values.uAtmosphereProfile[3]).toBe(0);
  });

  it("keeps strategic weather independent of the artificial camera distance", () => {
    const values = createSharedUniformValues(world);
    const state = createAtmosphereState(world, QUALITY_PRESETS.high, values);
    const camera = new OrthographicCamera();
    camera.position.set(300, 300, 300);
    camera.lookAt(0, 0, 0);
    state.update(camera, environment, false);
    const profile = Array.from(values.uAtmosphereProfile);
    const bounds = Array.from(values.uAtmosphereBoundsMax);
    camera.position.multiplyScalar(2);
    state.update(camera, environment, false);
    expect(Array.from(values.uAtmosphereProfile)).toEqual(profile);
    expect(Array.from(values.uAtmosphereBoundsMax)).toEqual(bounds);
    expect(values.uAtmosphereProfile[3]).toBe(1);
  });

  it("shortens the orthographic fog path as the camera zooms in", () => {
    const values = createSharedUniformValues(world);
    const state = createAtmosphereState(world, QUALITY_PRESETS.high, values);
    const camera = new OrthographicCamera(-1, 1, 50, -50, 1, 1800);
    camera.position.set(300, 300, 300);
    camera.lookAt(0, 0, 0);
    state.update(camera, environment, false);
    const wide = values.uAtmosphereOrthoDepth;
    camera.top = 10;
    camera.bottom = -10;
    camera.updateProjectionMatrix();
    state.update(camera, environment, false);
    const close = values.uAtmosphereOrthoDepth;
    expect(wide).toBeGreaterThan(close);
    expect(close).toBeGreaterThan(0);
    expect(close).toBeLessThan(wide / 3);
    expect(values.uAtmosphereFar).toBe(0);
  });

  it("retains cheap walking weather on Minimal and increases extinction during rain", () => {
    const values = createSharedUniformValues(world);
    const state = createAtmosphereState(world, QUALITY_PRESETS.minimal, values);
    const camera = new PerspectiveCamera();
    state.update(camera, environment, false);
    expect(values.uAtmosphereProfile[0]).toBe(0);
    state.update(camera, environment, true);
    const clearDensity = values.uAtmosphereProfile[0]!;
    expect(clearDensity).toBeGreaterThan(0);
    // Keep owned/visible ground readable in the walking view: the old 0.007 veil was too strong.
    expect(clearDensity).toBeLessThan(0.003);
    state.update(camera, { ...environment, rain: 1 }, true);
    expect(values.uAtmosphereProfile[0]).toBeGreaterThan(clearDensity);
  });

  it("restores normal air after failed captures and supports nested exclusions", () => {
    const uniforms = createThreeUniforms(createSharedUniformValues(world));
    expect(() => withoutAtmosphere(uniforms, () => {
      expect(uniforms.uAtmospherePass!.value).toBe(0);
      withoutAtmosphere(uniforms, () => expect(uniforms.uAtmospherePass!.value).toBe(0));
      expect(uniforms.uAtmospherePass!.value).toBe(0);
      throw new Error("capture failed");
    })).toThrow("capture failed");
    expect(uniforms.uAtmospherePass!.value).toBe(1);
  });
});
