import { describe, expect, it } from "vitest";

import { createEnvironmentController } from "../src/app/environment-controller";
import { computeEnvironment } from "../src/render-common/environment";
import {
  applyMonsoonWeather, getMonsoonGust, getMonsoonRainScale
} from "../src/render-common/seasonal-appearance/monsoon-weather";
import { SUMMER_WEIGHTS } from "../src/render-common/seasonal-appearance/season-weights";
import { nextWeather, weatherDwellSeconds, type WeatherState } from "../src/shared/environment/weather-states";
import { createStatefulRandom } from "../src/shared/world/rng";

const SUN = { azimuthX: 0.6, azimuthZ: -0.8, elevation: 0.9 };

/** Share of wet states (rain, storm) over a long chain. */
const wetShare = (climate: "monsoon" | "temperate") => {
  const random = createStatefulRandom(7);
  let state: WeatherState = "clear";
  let wet = 0;
  for (let step = 0; step < 4000; step++) {
    state = nextWeather(state, climate, random);
    if (state === "rain" || state === "storm") wet++;
  }
  return wet / 4000;
};

describe("monsoon weather (M1)", () => {
  it("leaves the summer environment untouched", () => {
    const environment = computeEnvironment(SUN, 12, 0.5, 0, 0.7);
    const before = structuredClone(environment);
    expect(applyMonsoonWeather(environment, 0, 3)).toEqual(before);
  });

  it("brings stronger wind, heavier cloud and a darker sky", () => {
    const summer = computeEnvironment(SUN, 12, 1, 0, 0.95);
    const monsoon = applyMonsoonWeather(computeEnvironment(SUN, 12, 1, 0, 0.95), 1, 3);
    expect(Math.hypot(monsoon.windX, monsoon.windZ)).toBeGreaterThan(Math.hypot(summer.windX, summer.windZ) * 1.4);
    expect(monsoon.cloudCover).toBeGreaterThan(summer.cloudCover);
    expect(monsoon.sunColor[0]).toBeLessThan(summer.sunColor[0]);
    expect(getMonsoonRainScale(1)).toBeGreaterThan(1);
    expect(getMonsoonRainScale(0)).toBe(1);
  });

  it("gusts within 0..1 and varies over time", () => {
    const gusts = Array.from({ length: 200 }, (_, index) => getMonsoonGust(index * 0.25));
    expect(Math.min(...gusts)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...gusts)).toBeLessThanOrEqual(1);
    expect(Math.max(...gusts) - Math.min(...gusts)).toBeGreaterThan(0.4);
  });

  it("rains much more often in the monsoon chain, with longer downpours", () => {
    expect(wetShare("monsoon")).toBeGreaterThan(wetShare("temperate") * 1.8);
    const longest = (monsoon: number) => weatherDwellSeconds("rain", () => 0.5, monsoon);
    expect(longest(1)).toBeGreaterThan(longest(0) * 1.5);
    expect(weatherDwellSeconds("clear", () => 0.5, 1)).toBeLessThan(weatherDwellSeconds("clear", () => 0.5, 0));
  });

  it("falls as sleet on a snowy island (rain and snow, no rain-to-cloud rule)", () => {
    const controller = createEnvironmentController(SUN, { hour: 12, rain: false, snow: false });
    controller.setSnowy(true);
    controller.setSeasonSource(() => ({ ...SUMMER_WEIGHTS, monsoon: 1 }));
    controller.update(0);
    controller.setWeather("rain", 0);
    const sleet = controller.update(0.1);
    expect(sleet.rain).toBeGreaterThan(0.5);
    expect(sleet.snow).toBeGreaterThan(0.3);
  });
});
