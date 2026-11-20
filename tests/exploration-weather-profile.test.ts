import { describe, expect, it } from "vitest";

import type { EnvironmentState } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  copyExplorationWeatherEnvironment,
  EXPLORATION_WEATHER_HARD_CAPS,
  explorationWeatherBranch,
  explorationWeatherBudget
} from "../src/renderers/three/exploration-weather";

describe("exploration weather profile", () => {
  it("keeps the ordinary isometric branch and every weather object disabled by default", () => {
    expect(explorationWeatherBranch(false)).toEqual({
      explorationLightning: false,
      explorationRain: false,
      explorationSky: false,
      explorationSplashes: false,
      mode: "iso",
      ordinaryClouds: true,
      ordinaryRain: true
    });
    expect(explorationWeatherBranch(true)).toEqual({
      explorationLightning: true,
      explorationRain: true,
      explorationSky: true,
      explorationSplashes: true,
      mode: "fps",
      ordinaryClouds: false,
      ordinaryRain: false
    });
    expect(explorationWeatherBranch(true, explorationWeatherBudget(QUALITY_PRESETS.minimal)))
      .toMatchObject({
        explorationLightning: false,
        explorationRain: false,
        explorationSky: true,
        explorationSplashes: false,
        mode: "fps"
      });
  });

  it("derives a bounded budget from the existing device preset, never forcing High", () => {
    const high = explorationWeatherBudget(QUALITY_PRESETS.high);
    const medium = explorationWeatherBudget(QUALITY_PRESETS.medium);
    const low = explorationWeatherBudget(QUALITY_PRESETS.low);
    const minimal = explorationWeatherBudget(QUALITY_PRESETS.minimal);
    expect(high.drops).toBeGreaterThan(medium.drops);
    expect(medium.drops).toBeGreaterThan(low.drops);
    expect(low.drops).toBeGreaterThan(0);
    expect(minimal.drops).toBe(0);
    expect(minimal.splashes).toBe(0);
    expect(minimal.audioVoices).toBe(0);
    expect(minimal.lightning).toBe(false);
    expect(minimal.boltSegments).toBe(0);
    expect(minimal.worldLight).toBe(false);
    expect(minimal.skyDetail).toBe("simple");
    for (const budget of [high, medium, low, minimal]) {
      expect(budget.drops).toBeLessThanOrEqual(EXPLORATION_WEATHER_HARD_CAPS.drops);
      expect(budget.splashes).toBeLessThanOrEqual(EXPLORATION_WEATHER_HARD_CAPS.splashes);
      expect(budget.audioVoices).toBeLessThanOrEqual(EXPLORATION_WEATHER_HARD_CAPS.thunderVoices);
      expect(budget.shelterProbesPerFrame)
        .toBeLessThanOrEqual(EXPLORATION_WEATHER_HARD_CAPS.shelterProbesPerFrame);
      expect(budget.boltSegments).toBeLessThanOrEqual(EXPLORATION_WEATHER_HARD_CAPS.boltSegments);
    }
  });

  it("only lowers a tier through per-session limits and can disable every optional effect", () => {
    const high = explorationWeatherBudget(QUALITY_PRESETS.high);
    expect(explorationWeatherBudget(QUALITY_PRESETS.high, { maxDrops: 10 }).drops).toBe(10);
    expect(explorationWeatherBudget(QUALITY_PRESETS.high, { maxDrops: 999_999 }).drops)
      .toBe(high.drops);
    expect(explorationWeatherBudget(QUALITY_PRESETS.high, { maxSplashes: 3 }).splashes).toBe(3);
    expect(explorationWeatherBudget(QUALITY_PRESETS.high, { audio: false }).audioVoices).toBe(0);
    const noBolt = explorationWeatherBudget(QUALITY_PRESETS.high, { lightning: false });
    expect(noBolt.lightning).toBe(false);
    expect(noBolt.boltSegments).toBe(0);
    expect(noBolt.worldLight).toBe(false);
    expect(explorationWeatherBudget(QUALITY_PRESETS.high, { maxAudioVoices: 1 }).audioVoices)
      .toBe(1);
  });

  it("copies the current environment values without retaining or mutating the source", () => {
    const source: EnvironmentState = {
      ambientGround: [0.1, 0.2, 0.3],
      ambientSky: [0.2, 0.3, 0.4],
      bakedShadowWeight: 1,
      cloudCover: 0.7,
      daylight: 0.5,
      fogColor: [0.4, 0.5, 0.6],
      rain: 0.8,
      shadowStrength: 1,
      snow: 0,
      sun: { azimuthX: 0.2, azimuthZ: 0.9, elevation: 0.4 },
      sunColor: [0.9, 0.8, 0.7],
      windX: 1.2,
      windZ: -0.4
    };
    const copy = copyExplorationWeatherEnvironment(source);
    expect(copy).toMatchObject({
      cloudCover: 0.7, daylight: 0.5, rain: 0.8, windX: 1.2, windZ: -0.4
    });
    expect(copy.ambientSky).toEqual([0.2, 0.3, 0.4]);
    expect(copy.ambientSky).not.toBe(source.ambientSky);
    (source.ambientSky as unknown as number[])[0] = 9;
    expect(copy.ambientSky[0]).toBe(0.2);
    (copy.fogColor as unknown as number[])[1] = 9;
    expect(source.fogColor[1]).toBe(0.5);
    expect(copyExplorationWeatherEnvironment(null).rain).toBe(0);
  });
});
