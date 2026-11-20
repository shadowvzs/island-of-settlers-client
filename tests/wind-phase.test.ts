import { describe, expect, it } from "vitest";

import { computeEnvironment, type EnvironmentState } from "../src/render-common/environment";
import { createSharedUniformValues, updateSharedUniformValues } from "../src/render-common/shader-uniforms";
import { createThreeUniforms } from "../src/renderers/three/three-materials";
import { createPropMaterial } from "../src/renderers/three/three-prop-materials";

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.97 };
const BASE = computeEnvironment(SUN, 12, 0, 0);
const windy = (windX: number, windZ = 0): EnvironmentState => ({ ...BASE, windX, windZ });

type Values = ReturnType<typeof createSharedUniformValues>;
const at = (values: Values, environment: EnvironmentState, time: number) =>
  updateSharedUniformValues(values, { environment, time });

describe("shared vegetation wind phase", () => {
  it("starts at the elapsed time and advances at unit direction speed", () => {
    const values = createSharedUniformValues();
    at(values, windy(1.2, 0.6), 0);
    expect([...values.uWindPhase]).toEqual([0, 0]);

    at(values, windy(1.2, 0.6), 3);
    expect(values.uWindPhase[0]).toBeCloseTo(3 * 1.2 / Math.hypot(1.2, 0.6), 6);
    expect(values.uWindPhase[1]).toBeCloseTo(3 * 0.6 / Math.hypot(1.2, 0.6), 6);
  });

  it("does not speed up when rain raises the wind strength", () => {
    const values = createSharedUniformValues();
    at(values, windy(1), 0);
    at(values, windy(2.4), 3);
    expect(values.uWindPhase[0]).toBeCloseTo(3, 6);
    expect(values.uWindPhase[1]).toBeCloseTo(0, 6);
  });

  it("turns through a 90-degree change without jumping the noise field", () => {
    const values = createSharedUniformValues();
    at(values, windy(1), 0);
    at(values, windy(1), 3);
    expect(values.uWindPhase[0]).toBeCloseTo(3, 6);

    at(values, windy(0, 1), 6);
    // The interval averages the old and new direction instead of teleporting the noise field.
    expect(values.uWindPhase[0]).toBeCloseTo(4.5, 6);
    expect(values.uWindPhase[1]).toBeCloseTo(1.5, 6);
    expect(values.uWindPhase[0]).toBeGreaterThan(3);
  });

  it("pauses on a repeated timestamp and restarts after a rewound clock", () => {
    const values = createSharedUniformValues();
    at(values, windy(1, 0.5), 0);
    at(values, windy(1, 0.5), 10);
    const paused = [...values.uWindPhase];
    at(values, windy(4, -2), 10);
    expect([...values.uWindPhase]).toEqual(paused);

    at(values, windy(1, 0.5), 0);
    expect([...values.uWindPhase]).toEqual([0, 0]);
  });

  it("binds one phase uniform for props, impostors and crop gusts", () => {
    const values = createSharedUniformValues();
    const uniforms = createThreeUniforms(values);
    expect(uniforms.uWindPhase!.value).toBe(values.uWindPhase);
    const material = createPropMaterial(uniforms, false);
    try {
      expect(material.vertexShader).toContain("uniform vec2 uWindPhase;");
      expect(material.vertexShader).toContain("uWindPhase * 0.35");
      expect(material.vertexShader).not.toContain("direction * time * 0.35");
    } finally {
      material.dispose();
    }
  });
});
