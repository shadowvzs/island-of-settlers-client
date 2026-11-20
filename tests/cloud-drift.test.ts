import { describe, expect, it } from "vitest";

import { computeEnvironment, type EnvironmentState } from "../src/render-common/environment";
import { WORLD_TIME_SCALE } from "../src/render-common/environment-clock";
import { createSharedUniformValues, updateSharedUniformValues } from "../src/render-common/shader-uniforms";
import { CLOUD_FIELD_GLSL } from "../src/render-common/shaders/cloud-glsl";
import { COMMON_UNIFORMS_GLSL } from "../src/render-common/shaders/common-glsl";
import { createThreeUniforms } from "../src/renderers/three/three-materials";

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.97 };
const BASE = computeEnvironment(SUN, 12, 0, 0);

const windy = (windX: number, windZ = 0): EnvironmentState => ({ ...BASE, windX, windZ });

type Values = ReturnType<typeof createSharedUniformValues>;

const at = (values: Values, environment: EnvironmentState, time: number) =>
  updateSharedUniformValues(values, { environment, time });

describe("shared cloud drift", () => {
  it("integrates static wind over the slow cloud clock", () => {
    const values = createSharedUniformValues();
    const environment = windy(1.5, -0.5);
    at(values, environment, 0);
    expect([...values.uCloudDrift]).toEqual([0, 0]);

    at(values, environment, 3 * WORLD_TIME_SCALE);
    expect(values.uCloudTime).toBe(3);
    expect(values.uCloudDrift[0]).toBeCloseTo(4.5);
    expect(values.uCloudDrift[1]).toBeCloseTo(-1.5);
  });

  it("keeps forward drift through a wind reversal instead of scaling absolute time", () => {
    const values = createSharedUniformValues();
    at(values, windy(1.2), 0);
    at(values, windy(1.2), 3 * WORLD_TIME_SCALE);
    const forward = values.uCloudDrift[0]!;

    // The old wind * cloudTime field would jump to -2.4 here; accumulated wind still travels on.
    at(values, windy(-0.4), 6 * WORLD_TIME_SCALE);
    expect(values.uCloudDrift[0]).toBeGreaterThan(forward);
    expect(values.uCloudDrift[0]).toBeCloseTo(4.8);
  });

  it("does not cancel motion when a wind change would zero wind times absolute time", () => {
    const values = createSharedUniformValues();
    at(values, windy(1.2, 0.525), 3000);
    const initial = [...values.uCloudDrift];
    expect(initial[0]).toBeCloseTo(1200);
    expect(initial[1]).toBeCloseTo(525);

    const changed = 1000 / 1000.1;
    at(values, windy(1.2 * changed, 0.525 * changed), 3000.3);
    expect(values.uCloudDrift[0]).toBeGreaterThan(initial[0]!);
    expect(values.uCloudDrift[1]).toBeGreaterThan(initial[1]!);
  });

  it("restarts drift from zero after a rewound clock", () => {
    const values = createSharedUniformValues();
    const environment = windy(1, 0.5);
    at(values, environment, 0);
    at(values, environment, 30);
    expect(values.uCloudDrift[0]).toBeCloseTo(10);

    at(values, environment, 0);
    expect([...values.uCloudDrift]).toEqual([0, 0]);
    at(values, environment, 3);
    expect(values.uCloudDrift[0]).toBeCloseTo(1);
    expect(values.uCloudDrift[1]).toBeCloseTo(0.5);

    at(values, environment, 1.5);
    expect([...values.uCloudDrift]).toEqual([0, 0]);
  });

  it("adds no drift while the cloud clock does not advance", () => {
    const values = createSharedUniformValues();
    at(values, windy(1), 0);
    at(values, windy(1), 3 * WORLD_TIME_SCALE);
    const snapshot = [...values.uCloudDrift];

    at(values, windy(4, -2), 3 * WORLD_TIME_SCALE);
    expect([...values.uCloudDrift]).toEqual(snapshot);
    expect(values.uCloudTime).toBe(3);
  });

  it("declares and binds one drift uniform for sky clouds and projected shadows", () => {
    const values = createSharedUniformValues();
    const uniforms = createThreeUniforms(values);
    expect(uniforms.uCloudDrift!.value).toBe(values.uCloudDrift);

    at(values, windy(2, 1), 0);
    at(values, windy(2, 1), 3 * WORLD_TIME_SCALE);
    expect(Array.from(uniforms.uCloudDrift!.value as Float32Array)).toEqual([6, 3]);

    expect(COMMON_UNIFORMS_GLSL).toContain("uniform vec2 uCloudDrift;");
    const density = CLOUD_FIELD_GLSL.slice(
      CLOUD_FIELD_GLSL.indexOf("float cloudDensity"),
      CLOUD_FIELD_GLSL.indexOf("float cloudShadow")
    );
    const shadow = CLOUD_FIELD_GLSL.slice(CLOUD_FIELD_GLSL.indexOf("float cloudShadow"));
    expect(density).toContain("uCloudDrift");
    expect(density).not.toContain("uCloudTime");
    expect(shadow).toContain("cloudDensity");
    expect(shadow).not.toContain("uWind");
  });
});
