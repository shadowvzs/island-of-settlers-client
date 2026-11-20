import { describe, expect, it } from "vitest";

import { computeEnvironment } from "../src/render-common/environment";
import { WORLD_TIME_SCALE } from "../src/render-common/environment-clock";
import { createSharedUniformValues, updateSharedUniformValues } from "../src/render-common/shader-uniforms";
import { CLOUD_FIELD_GLSL } from "../src/render-common/shaders/cloud-glsl";
import { COMMON_UNIFORMS_GLSL } from "../src/render-common/shaders/common-glsl";

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.97 };

describe("world and cloud clock", () => {
  it("runs one game minute per three real seconds", () => {
    expect(WORLD_TIME_SCALE).toBe(3);
  });

  it("drives cloud drift from the shared slow clock without slowing other animations", () => {
    const values = createSharedUniformValues({ cellsX: 256, cellsZ: 256 });
    updateSharedUniformValues(values, { environment: computeEnvironment(SUN, 12, 0, 0), time: 30 });
    expect(values.uTime).toBe(30);
    expect(values.uCloudTime).toBe(10);
    expect(values.uCloudDrift[0]).toBeCloseTo(8);
    expect(values.uCloudDrift[1]).toBeCloseTo(3.5);
    expect(COMMON_UNIFORMS_GLSL).toContain("uniform float uCloudTime;");
    expect(COMMON_UNIFORMS_GLSL).toContain("uniform vec2 uCloudDrift;");
    expect(CLOUD_FIELD_GLSL).toContain("uCloudDrift * 0.012");
    expect(CLOUD_FIELD_GLSL).not.toContain("uWind * uCloudTime");
  });
});
