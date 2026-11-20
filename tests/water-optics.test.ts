import { describe, expect, it } from "vitest";

import { WATER_GLSL } from "../src/render-common/shaders/water-glsl";
import { createWaterMaterial } from "../src/renderers/three/three-materials";

/** Evaluate the production scalar shader body; native review covers GLSL compilation/precision. */
const fresnelBody = WATER_GLSL.match(/float waterFresnel\(float cosTheta\) \{([^}]+)\}/)?.[1];
if (!fresnelBody) throw new Error("Missing production water Fresnel function");
// oxlint-disable-next-line typescript/no-implied-eval -- Execute checked-in scalar GLSL, not a copied test formula.
const shaderFresnel = new Function(
  "cosTheta",
  "clamp",
  fresnelBody.replace(/\bfloat\b/g, "const")
) as (cosTheta: number, clamp: (value: number, low: number, high: number) => number) => number;
const fresnel = (cosTheta: number) =>
  shaderFresnel(cosTheta, (value, low, high) => Math.max(low, Math.min(high, value)));

/** Exact unpolarized dielectric boundary, independent of the shader's Schlick approximation. */
const dielectricReflectance = (cosIncident: number, ior: number) => {
  const cosTransmitted = Math.sqrt(1 - (1 - cosIncident * cosIncident) / (ior * ior));
  const parallel = (ior * cosIncident - cosTransmitted) / (ior * cosIncident + cosTransmitted);
  const perpendicular = (cosIncident - ior * cosTransmitted) / (cosIncident + ior * cosTransmitted);
  return (parallel * parallel + perpendicular * perpendicular) / 2;
};

describe("water boundary reflectance", () => {
  it("agrees with air/water optics at normal and grazing incidence", () => {
    expect(fresnel(1)).toBeCloseTo(dielectricReflectance(1, 1.333), 4);
    expect(fresnel(0)).toBeCloseTo(dielectricReflectance(0, 1.333), 12);
    // Schlick is approximate for water's low index: retain a bound against the full equations.
    for (let step = 0; step <= 256; step++) {
      const cosine = step / 256;
      expect(Math.abs(fresnel(cosine) - dielectricReflectance(cosine, 1.333))).toBeLessThan(0.061);
    }
  });

  it("stays bounded and increases continuously toward grazing", () => {
    let previous = fresnel(1);
    for (let step = 1; step <= 256; step++) {
      const value = fresnel(1 - step / 256);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      expect(value - previous).toBeLessThan(0.02);
      previous = value;
    }
    expect(fresnel(-1)).toBe(1);
    expect(fresnel(2)).toBe(fresnel(1));
  });

  it("keeps the still-water fast path and the two-phase river advection", () => {
    expect(WATER_GLSL).toContain("if (length(flow) <= 0.01)");
    expect(WATER_GLSL).toContain("float phaseA = fract(time * 0.4);");
    expect(WATER_GLSL).toContain("float phaseB = fract(time * 0.4 + 0.5);");
    expect(WATER_GLSL).toContain("mix(rippleSlope(xz - offsetA, time), rippleSlope(xz - offsetB + 13.7, time), mixB)");
  });

  it("divides the production layer's body and bed transmission before foam", () => {
    const bodyAt = WATER_GLSL.indexOf("color = color * (1.0 - reflection)");
    const bedAt = WATER_GLSL.indexOf("transmit *= 1.0 - reflection;");
    const foamAt = WATER_GLSL.indexOf("float foamCover = waterFoamCover(");
    expect(bodyAt).toBeGreaterThan(0);
    expect(bedAt).toBeGreaterThan(bodyAt);
    expect(foamAt).toBeGreaterThan(bedAt);
    expect(WATER_GLSL).not.toContain("uAmbientSky * facing * facing * 0.22");
  });
});

describe("water camera and capture contract", () => {
  it.each([false, true])("uses the actual perspective eye without another capture (refraction=%s)", refraction => {
    const material = createWaterMaterial({}, refraction);
    try {
      expect(material.fragmentShader).toContain("uniform vec3 cameraPosition;");
      expect(material.fragmentShader).toContain("uniform bool isOrthographic;");
      expect(material.fragmentShader).toContain("isOrthographic ? uViewDirection : normalize(cameraPosition - vWorld)");
      expect(material.fragmentShader).toContain("sunGlint(normal, clouds, viewDirection)");
      // The renderer supplies camera uniforms; this material needs no owned camera/target state.
      expect(Object.keys(material.uniforms)).toEqual([]);
      expect(Boolean(material.defines.NO_REFRACTION !== undefined)).toBe(!refraction);
    } finally {
      material.dispose();
    }
  });
});
