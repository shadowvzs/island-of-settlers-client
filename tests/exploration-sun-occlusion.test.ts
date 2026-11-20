import { describe, expect, it } from "vitest";

import {
  explorationSunVisibility,
  sunTerrainVisibility
} from "../src/renderers/three/exploration-weather/exploration-sun-occlusion";

const eye = { x: 0, y: 2, z: 0 };
const radius = 0.034;
const flat = () => 0;
/** A ridge 20 cells east of the eye, `height` tall. */
const ridge = (height: number) => (x: number) => (x > 18 && x < 30 ? height : 0);
const eastAt = (elevation: number) => ({ x: Math.cos(elevation), y: Math.sin(elevation), z: 0 });

describe("sun terrain visibility", () => {
  it("never occludes without a height query, overhead or above flat ground", () => {
    expect(sunTerrainVisibility(eye, eastAt(0.2), radius)).toBe(1);
    expect(sunTerrainVisibility(eye, { x: 0, y: 1, z: 0 }, radius, ridge(100))).toBe(1);
    expect(sunTerrainVisibility(eye, eastAt(0.12), radius, flat)).toBe(1);
  });

  it("hides the disc behind a ridge and fades across its edge", () => {
    expect(sunTerrainVisibility(eye, eastAt(0.2), radius, ridge(12))).toBe(0);
    expect(sunTerrainVisibility(eye, eastAt(1.0), radius, ridge(12))).toBe(1);
    // The ridge top (10 above the eye, 18..30 cells away) stands roughly 0.35..0.5 rad high.
    const sweep = Array.from({ length: 61 }, (_, step) =>
      sunTerrainVisibility(eye, eastAt(0.3 + step * 0.005), radius, ridge(12)));
    expect(sweep.some(value => value > 0 && value < 1)).toBe(true);
    expect(sweep.every((value, index) => index === 0 || value >= sweep[index - 1]!)).toBe(true);
    expect(sunTerrainVisibility(eye, { x: -1, y: 0.2, z: 0 }, radius, ridge(12))).toBe(1);
  });

  it("ignores non-finite heights", () => {
    expect(sunTerrainVisibility(eye, eastAt(0.2), radius, () => Number.NaN)).toBe(1);
  });

  it("reads the environment light direction", () => {
    const sun = { azimuthX: 1, azimuthZ: 0, elevation: 0.2 };
    expect(explorationSunVisibility(sun, eye, ridge(12))).toBe(0);
    expect(explorationSunVisibility({ ...sun, azimuthX: -1 }, eye, ridge(12))).toBe(1);
  });
});
