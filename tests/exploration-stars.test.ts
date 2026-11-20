import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { celestialPole, starlightForHour, starRotation } from "../src/render-common/environment";
import { EXPLORATION_SKY_FRAGMENT_GLSL } from "../src/renderers/three/exploration-weather/exploration-sky-shader";
import { createExplorationStarUniforms } from "../src/renderers/three/exploration-weather/exploration-stars";
import { EXPLORATION_STARS_GLSL } from "../src/renderers/three/exploration-weather/exploration-stars-glsl";

const base = { azimuthX: 0, azimuthZ: 1, elevation: 0.7 };
const night = (moonPhase: number, daylight = 0) =>
  ({ daylight, moonPhase, starPole: celestialPole(base), starRotation: 1, timeSeconds: 12 });

describe("exploration night stars", () => {
  it("adds the stars with the moon, before both cloud layers and the camera air", () => {
    const main = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("void main()");
    const stars = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationStarRadiance(", main);
    const clouds = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("explorationHighCloudLayer(", main);
    const air = EXPLORATION_SKY_FRAGMENT_GLSL.indexOf("composeAtmosphereLinearToward(", main);
    expect(stars).toBeGreaterThan(-1);
    expect(stars).toBeLessThan(clouds);
    expect(clouds).toBeLessThan(air);
  });

  it("keeps every star at least 0.75 px and skips the sky by day", () => {
    expect(EXPLORATION_STARS_GLSL).toContain("max(pixelAngle * (0.75 + 0.3 * rank), 0.00001)");
    expect(EXPLORATION_STARS_GLSL).toContain("if (uStarParams.x <= 0.0 || direction.y < -0.02) return vec3(0.0);");
  });

  it("shows stars only at night, without rain, and fewer under a full moon", () => {
    const stars = createExplorationStarUniforms();
    const params = stars.uniforms.uStarParams!.value;
    stars.update(night(0.5, 0.6), 3, 0);
    expect(params.x).toBe(0);
    stars.update(night(0), 3, 0);
    expect(params.x).toBe(1);
    expect(params.y).toBeCloseTo(0, 6);
    expect(params.z).toBe(2);
    stars.update(night(0.5), 1, 0);
    expect(params.y).toBeGreaterThan(0.08);
    expect(params.z).toBe(1);
    stars.update(night(0), 3, 0.4);
    expect(params.x).toBe(0);
    stars.update({ ...night(0), starlight: 0.5 }, 3, 0);
    expect(params.x).toBe(0.5);
  });

  it("brings the stars out through astronomical twilight", () => {
    expect(starlightForHour(12)).toBe(0);
    expect(starlightForHour(18.2)).toBeCloseTo(0, 6);
    expect(starlightForHour(18.7)).toBeCloseTo(0.5, 6);
    expect(starlightForHour(23)).toBe(1);
    expect(starlightForHour(3)).toBe(1);
    expect(starlightForHour(5.3)).toBeCloseTo(0.5, 6);
    expect(starlightForHour(6)).toBe(0);
  });

  it("turns the star sphere about a fixed pole, once per sidereal day", () => {
    const stars = createExplorationStarUniforms();
    stars.update({ ...night(0), starRotation: 2.3 }, 3, 0);
    const pole = celestialPole(base);
    const axis = new Vector3(pole.azimuthX * Math.cos(pole.elevation), Math.sin(pole.elevation),
      pole.azimuthZ * Math.cos(pole.elevation));
    const turned = axis.clone().applyMatrix3(stars.uniforms.uStarFrame!.value);
    expect(turned.distanceTo(axis)).toBeLessThan(1e-6);
    expect(pole.azimuthZ).toBe(-1);
    expect(starRotation(0, 0)).toBe(0);
    expect(starRotation(0, 12)).toBeGreaterThan(Math.PI);
    expect(starRotation(0, 12)).toBeLessThan(Math.PI * 1.01);
  });
});
