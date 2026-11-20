import { describe, expect, it } from "vitest";

import {
  apparentSunElevation,
  relativeAirMass,
  SUN_DISC_PEAK,
  SUN_SETTING_APPARENT_ELEVATION,
  sunPresence,
  writeMoonTint,
  writeSunAureoleRadiance,
  writeSunDiscChroma,
  writeSunDiscRadiance
} from "../src/render-common/atmosphere/sun-radiance";
import { LOWEST_LIGHT_ELEVATION } from "../src/render-common/environment";

const degrees = (value: number) => (value * Math.PI) / 180;
const disc = (elevation: number, overcast = 0, daylight = 1) =>
  writeSunDiscRadiance({ daylight, elevation, overcast }, new Float64Array(3));
const aureole = (elevation: number) =>
  writeSunAureoleRadiance({ daylight: 1, elevation, overcast: 0 }, new Float64Array(3));

describe("sun radiance through the air", () => {
  it("uses the Kasten-Young air mass: 1 overhead, about 38 at the horizon", () => {
    expect(relativeAirMass(Math.PI / 2)).toBeCloseTo(1, 3);
    expect(relativeAirMass(degrees(30))).toBeCloseTo(1.995, 2);
    expect(relativeAirMass(0)).toBeCloseTo(37.9, 0);
    expect(relativeAirMass(-0.2)).toBe(relativeAirMass(0));
  });

  it("maps the game's lowest light onto a sun just above the horizon and keeps the zenith", () => {
    expect(apparentSunElevation(LOWEST_LIGHT_ELEVATION)).toBeCloseTo(SUN_SETTING_APPARENT_ELEVATION, 6);
    expect(apparentSunElevation(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(apparentSunElevation(0.97)).toBeGreaterThan(0.97 * 0.96);
    expect(apparentSunElevation(0)).toBe(0);
  });

  it("keeps the overhead sun white and HDR, the setting sun red, dimmer and still bright", () => {
    const [red, , blue] = disc(Math.PI / 2);
    expect(red).toBeCloseTo(SUN_DISC_PEAK, 1);
    expect(blue! / red!).toBeGreaterThan(0.9);
    const noon = disc(0.97), sunset = disc(0.185), low = disc(LOWEST_LIGHT_ELEVATION);
    expect(noon[2]! / noon[0]!).toBeGreaterThan(0.8);
    expect(sunset[1]! / sunset[0]!).toBeGreaterThan(0.2);
    expect(low[1]! / low[0]!).toBeLessThan(0.1);
    expect(low[2]! / low[0]!).toBeLessThan(0.01);
    expect(low[0]!).toBeLessThan(sunset[0]!);
    expect(sunset[0]!).toBeLessThan(noon[0]!);
    expect(low[0]!).toBeGreaterThan(1.5);
  });

  it("reddens monotonically as the sun sinks", () => {
    let previous = Infinity;
    for (const elevation of [1.2, 0.8, 0.5, 0.3, 0.2, 0.12]) {
      const [red, green] = disc(elevation);
      expect(green! / red!).toBeLessThan(previous);
      previous = green! / red!;
    }
  });

  it("fades out with daylight and dims under overcast", () => {
    expect(sunPresence(0)).toBe(0);
    expect(sunPresence(1)).toBe(1);
    expect([...disc(0.6, 0, 0)]).toEqual([0, 0, 0]);
    expect(disc(0.6, 1)[0]).toBeCloseTo(disc(0.6)[0]! * 0.2, 6);
  });

  it("matches the disc overhead; at sunset the glow is less red and never outshines the disc", () => {
    const overhead = aureole(Math.PI / 2);
    expect(overhead[0]).toBeCloseTo(disc(Math.PI / 2)[0]!, 1);
    for (const elevation of [0.3, 0.185, LOWEST_LIGHT_ELEVATION]) {
      const glow = aureole(elevation), sun = disc(elevation);
      expect(glow[1]! / glow[0]!).toBeGreaterThan(sun[1]! / sun[0]!);
      expect(glow[0]! * 0.0006 * 37).toBeLessThan(sun[0]!);
    }
  });

  it("gives water glints the disc's hue: white at noon, red at the lowest sun", () => {
    const noon = writeSunDiscChroma(0.97, new Float64Array(3));
    expect(Math.max(...noon)).toBeCloseTo(1, 6);
    expect(noon[2]).toBeGreaterThan(0.8);
    const low = writeSunDiscChroma(LOWEST_LIGHT_ELEVATION, new Float64Array(3));
    expect(low[0]).toBeCloseTo(1, 6);
    expect(low[1]).toBeLessThan(0.1);
  });

  it("tints the moon grey-white high in the sky and warmer near the horizon", () => {
    const high = writeMoonTint(0.6, new Float64Array(3));
    expect(Math.abs(high[0]! - high[2]!)).toBeLessThan(0.05);
    const low = writeMoonTint(LOWEST_LIGHT_ELEVATION, new Float64Array(3));
    expect(low[2]! / low[0]!).toBeLessThan(0.5);
    expect(low[1]! / low[0]!).toBeLessThan(high[1]! / high[0]!);
  });
});
