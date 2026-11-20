import { describe, expect, it } from "vitest";

import {
  EXPLORATION_MOON_DISC_RADIUS,
  EXPLORATION_SKY_DISC_GLSL,
  EXPLORATION_SUN_DISC_RADIUS,
  writeMoonLitAxis
} from "../src/renderers/three/exploration-weather/exploration-sky-disc-glsl";
import {
  EXPLORATION_SKY_FRAGMENT_GLSL,
  EXPLORATION_SKY_VERTEX_GLSL
} from "../src/renderers/three/exploration-weather/exploration-sky-shader";

describe("exploration sky discs", () => {
  it("draws the moon before both cloud layers so clouds occlude it", () => {
    const main = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("void main()");
    const moon = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationMoonRadiance(", main);
    const highClouds = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationHighCloudLayer(", main);
    const lowClouds = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationLowerClouds(", main);
    expect(moon).toBeGreaterThan(-1);
    expect(moon).toBeLessThan(highClouds);
    expect(highClouds).toBeLessThan(lowClouds);
  });

  it("adds the HDR sun behind the clouds through the sun output over the tonemapped sky", () => {
    const main = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("void main()");
    const lowClouds = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationLowCloudOpacity(", main);
    const air = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("composeAtmosphereLinearToward(", main);
    const sun = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationSunRadiance(", main);
    const output = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationSunOutput(radiance", main);
    expect(lowClouds).toBeLessThan(air);
    expect(air).toBeLessThan(sun);
    expect(sun).toBeLessThan(output);
    expect(EXPLORATION_SKY_FRAGMENT_GLSL).toContain("float localTransmittance = (1.0 - highOpacity)");
    expect(EXPLORATION_SKY_VERTEX_GLSL).toContain("vSunDirectVisibility = explorationSunCloudVisibility(");
  });

  it("caps the cloud glow below clipped white so dusk rims do not bloom into a halo", () => {
    const main = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("void main()");
    expect(EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationCloudGlowRadiance(", main)).toBeGreaterThan(main);
    expect(EXPLORATION_SKY_FRAGMENT_GLSL).toContain("const float SUN_CLOUD_GLOW_PEAK = 0.7");
    expect(EXPLORATION_SKY_FRAGMENT_GLSL).toContain("max(SUN_CLOUD_GLOW_PEAK - max(lit.r");
  });

  it("keeps the concealment veil to the horizon band of the sky (no light bands above it)", () => {
    expect(EXPLORATION_SKY_FRAGMENT_GLSL).toContain("explorationSkyConcealment(airRay, direction)");
    expect(EXPLORATION_SKY_FRAGMENT_GLSL).toContain("if (horizonBand <= 0.0) return 0.0;");
  });

  it("lights the moon sphere from the phase angle towards its sun, with earthshine", () => {
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("uniform vec2 uMoonLitAxis;");
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("uniform vec3 uMoonTint;");
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("float cosPhaseAngle = -cos(phase * SKY_TAU);");
    expect(EXPLORATION_SKY_DISC_GLSL).toContain(
      "dot(surfaceNormal, vec3(litAxis * sinPhaseAngle, cosPhaseAngle))"
    );
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("SKY_MOON_EARTHSHINE * (1.0 - illumination)");
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("(1.0 - smoothstep(0.0, 0.05, sunPresence))");
  });

  it("points the lit axis at the moon's sun in the light's tangent frame", () => {
    const axis = new Float32Array(2);
    const below = { azimuthX: 1, azimuthZ: 0, elevation: -0.3 };
    writeMoonLitAxis([0, Math.sin(0.5), Math.cos(0.5)], below, axis);
    expect(Math.hypot(axis[0]!, axis[1]!)).toBeCloseTo(1, 5);
    const east = writeMoonLitAxis([0, Math.sin(0.5), Math.cos(0.5)], below, new Float32Array(2));
    const west = writeMoonLitAxis([0, Math.sin(0.5), Math.cos(0.5)],
      { ...below, azimuthX: -1 }, new Float32Array(2));
    expect(east[0]).toBeCloseTo(-west[0]!, 5);
    expect(east[1]).toBeCloseTo(west[1]!, 5);
  });

  it("renders the enlarged moon and sun discs with a lunar phase mask", () => {
    expect(EXPLORATION_MOON_DISC_RADIUS).toBeCloseTo(0.0084999 * 3, 7);
    expect(EXPLORATION_SUN_DISC_RADIUS).toBeCloseTo(0.0169998 * 2, 7);
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("uniform float uMoonPhase;");
    expect(EXPLORATION_SKY_DISC_GLSL).toContain("float illumination = 0.5 * (1.0 - cos(phase * SKY_TAU));");
    expect(EXPLORATION_SKY_DISC_GLSL).toContain(
      `SKY_SUN_CHORD_RADIUS = ${EXPLORATION_SUN_DISC_RADIUS.toFixed(7)}`
    );
    expect(EXPLORATION_SKY_DISC_GLSL).toContain(
      `SKY_MOON_CHORD_RADIUS = ${EXPLORATION_MOON_DISC_RADIUS.toFixed(7)}`
    );
  });
});
