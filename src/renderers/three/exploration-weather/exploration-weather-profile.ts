/**
 * EXPLORE-01F presentation profile. The profile is selected only while the exploration weather
 * frame is present; the ordinary isometric renderer keeps its own presets and schedule. Budgets
 * can only be lowered, never raised above the selected device tier, so entering first person never
 * upgrades quality or enables an optional effect on the Minimal preset.
 */
import { type Color3, environmentOvercast, type EnvironmentState } from "../../../render-common/environment";
import type { QualityPreset } from "../../../render-common/quality";
import type { SunDirection } from "../../../shared/world/world-data";

export type ExplorationWeatherMode = "iso" | "fps";

/** Hard ceilings shared by every tier (tests and diagnostics use them as the invariant). */
export const EXPLORATION_WEATHER_HARD_CAPS = Object.freeze({
  boltSegments: 96,
  drops: 2_400,
  shelterProbesPerFrame: 16,
  splashSpawnsPerFrame: 4,
  splashes: 40,
  thunderVoices: 3
});

/** A copied, render-safe subset of the frame environment; no simulation object is retained. */
export interface ExplorationWeatherEnvironment {
  ambientSky: Color3;
  cloudCover: number;
  daylight: number;
  fogColor: Color3;
  /** 0 new moon, 0.5 full, 0.75 last quarter. */
  moonPhase?: number;
  /** The sun that lights the moon (environment.ts moonSunDirection). */
  moonSun?: SunDirection;
  rain: number;
  snow: number;
  /** Celestial pole and sidereal angle of the night stars (environment.ts). */
  starPole?: SunDirection;
  starRotation?: number;
  starlight?: number;
  sun: SunDirection;
  sunColor: Color3;
  windX: number;
  windZ: number;
}

export interface ExplorationWeatherBudget {
  audioVoices: number;
  boltSegments: number;
  cloudDetail: number;
  drops: number;
  lightning: boolean;
  rainHeight: number;
  rainRadius: number;
  shelterProbesPerFrame: number;
  skyDetail: "simple" | "full";
  splashSpawnsPerFrame: number;
  splashes: number;
  worldLight: boolean;
}

export interface ExplorationWeatherProfileOptions {
  audio?: boolean;
  lightning?: boolean;
  maxAudioVoices?: number;
  maxDrops?: number;
  maxSplashes?: number;
}

export interface ExplorationWeatherBranch {
  /** "iso" is the untouched ordinary path; the exploration branch is opt-in only. */
  mode: ExplorationWeatherMode;
  ordinaryClouds: boolean;
  ordinaryRain: boolean;
  explorationLightning: boolean;
  explorationRain: boolean;
  explorationSky: boolean;
  explorationSplashes: boolean;
}

const TIER_TUNING = {
  high: {
    audioVoices: 2, boltSegments: 80, cloudDetail: 3, drops: 1_800, lightning: true,
    rainHeight: 26, rainRadius: 22, shelterProbesPerFrame: 12, skyDetail: "full" as const,
    splashSpawnsPerFrame: 3, splashes: 28, worldLight: true
  },
  low: {
    audioVoices: 1, boltSegments: 48, cloudDetail: 1, drops: 900, lightning: true,
    rainHeight: 21, rainRadius: 17, shelterProbesPerFrame: 8, skyDetail: "full" as const,
    splashSpawnsPerFrame: 1, splashes: 10, worldLight: true
  },
  medium: {
    audioVoices: 2, boltSegments: 64, cloudDetail: 2, drops: 1_300, lightning: true,
    rainHeight: 24, rainRadius: 20, shelterProbesPerFrame: 10, skyDetail: "full" as const,
    splashSpawnsPerFrame: 2, splashes: 18, worldLight: true
  },
  minimal: {
    audioVoices: 0, boltSegments: 0, cloudDetail: 1, drops: 0, lightning: false,
    rainHeight: 0, rainRadius: 0, shelterProbesPerFrame: 0, skyDetail: "simple" as const,
    splashSpawnsPerFrame: 0, splashes: 0, worldLight: false
  }
} as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Rain and snowfall of a frame: their intensities, the shared overcast and the snow share. */
export const explorationPrecipitation = (rain: number, snow: number) => {
  const intensity = clamp01(rain), snowfall = clamp01(snow);
  return { intensity, overcast: environmentOvercast(intensity, snowfall),
    precipitation: Math.max(intensity, snowfall), snowShare: snowfall / Math.max(1e-3, intensity + snowfall) };
};

const clampInt = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, Math.floor(Number.isFinite(value) ? value : minimum)));

const copyColor = (value: readonly number[] | undefined, fallback: Color3): Color3 => [
  clamp01(value?.[0] ?? fallback[0]),
  clamp01(value?.[1] ?? fallback[1]),
  clamp01(value?.[2] ?? fallback[2])
];

/** The dry night fallback used only if 01G has not supplied an environment yet. */
export const EMPTY_EXPLORATION_WEATHER_ENVIRONMENT: ExplorationWeatherEnvironment = Object.freeze({
  ambientSky: [0.14, 0.19, 0.33] as Color3,
  cloudCover: 0.45,
  daylight: 0,
  fogColor: [0.24, 0.27, 0.36] as Color3,
  moonPhase: 0.5,
  rain: 0,
  snow: 0,
  sun: { azimuthX: 0.8, azimuthZ: 0.35, elevation: 0.5 },
  sunColor: [0.3, 0.36, 0.55] as Color3,
  windX: 0.8,
  windZ: 0.35
});

/**
 * Copies only the values weather presentation needs. Array values are copied, so the returned
 * record can never mutate the caller's environment or a simulation-owned array.
 */
export const copyExplorationWeatherEnvironment = (
  source?: Readonly<EnvironmentState> | null
): ExplorationWeatherEnvironment => {
  if (!source) {
    const empty = EMPTY_EXPLORATION_WEATHER_ENVIRONMENT;
    return {
      ...empty,
      ambientSky: [...empty.ambientSky] as Color3,
      fogColor: [...empty.fogColor] as Color3,
      sun: { ...empty.sun },
      sunColor: [...empty.sunColor] as Color3
    };
  }
  const sun = source.sun ?? EMPTY_EXPLORATION_WEATHER_ENVIRONMENT.sun;
  return {
    ambientSky: copyColor(source.ambientSky, EMPTY_EXPLORATION_WEATHER_ENVIRONMENT.ambientSky),
    cloudCover: clamp01(source.cloudCover),
    daylight: clamp01(source.daylight),
    fogColor: copyColor(source.fogColor, EMPTY_EXPLORATION_WEATHER_ENVIRONMENT.fogColor),
    moonPhase: clamp01(source.moonPhase ?? 0.5),
    moonSun: source.moonSun && { ...source.moonSun },
    rain: clamp01(source.rain),
    snow: clamp01(source.snow),
    starPole: source.starPole && { ...source.starPole },
    starRotation: source.starRotation,
    starlight: source.starlight,
    sun: {
      azimuthX: Number.isFinite(sun.azimuthX) ? sun.azimuthX : 0,
      azimuthZ: Number.isFinite(sun.azimuthZ) ? sun.azimuthZ : 1,
      elevation: Number.isFinite(sun.elevation) ? sun.elevation : 0
    },
    sunColor: copyColor(source.sunColor, EMPTY_EXPLORATION_WEATHER_ENVIRONMENT.sunColor),
    windX: Number.isFinite(source.windX) ? source.windX : 0,
    windZ: Number.isFinite(source.windZ) ? source.windZ : 0
  };
};

const tierOf = (quality: Pick<QualityPreset, "grassSamples" | "weatherParticles">) => {
  if (!quality.weatherParticles) return "minimal" as const;
  if (quality.grassSamples >= 8) return "high" as const;
  if (quality.grassSamples >= 6) return "medium" as const;
  return "low" as const;
};

/**
 * Selects the bounded FPS weather budget from the active device preset. `maxDrops`,
 * `maxSplashes` and `maxAudioVoices` are additional per-session limits (for tests, a phone
 * profile or a coordinator bench); they cannot raise the device tier.
 */
export const explorationWeatherBudget = (
  quality: QualityPreset,
  options: ExplorationWeatherProfileOptions = {}
): ExplorationWeatherBudget => {
  const tier = TIER_TUNING[tierOf(quality)];
  const audioEnabled = options.audio ?? true;
  const lightningEnabled = (options.lightning ?? true) && tier.lightning;
  const drops = clampInt(
    Math.min(options.maxDrops ?? tier.drops, tier.drops),
    0,
    EXPLORATION_WEATHER_HARD_CAPS.drops
  );
  const splashes = clampInt(
    Math.min(options.maxSplashes ?? tier.splashes, tier.splashes),
    0,
    EXPLORATION_WEATHER_HARD_CAPS.splashes
  );
  return {
    audioVoices: audioEnabled
      ? clampInt(Math.min(options.maxAudioVoices ?? tier.audioVoices, tier.audioVoices), 0,
        EXPLORATION_WEATHER_HARD_CAPS.thunderVoices)
      : 0,
    boltSegments: lightningEnabled ? tier.boltSegments : 0,
    cloudDetail: tier.cloudDetail,
    drops,
    lightning: lightningEnabled,
    rainHeight: drops > 0 ? tier.rainHeight : 0,
    rainRadius: drops > 0 ? tier.rainRadius : 0,
    shelterProbesPerFrame: drops > 0 ? tier.shelterProbesPerFrame : 0,
    skyDetail: tier.skyDetail,
    splashSpawnsPerFrame: splashes > 0
      ? clampInt(Math.min(tier.splashSpawnsPerFrame, splashes), 0,
        EXPLORATION_WEATHER_HARD_CAPS.splashSpawnsPerFrame)
      : 0,
    splashes,
    worldLight: lightningEnabled && tier.worldLight
  };
};

/**
 * Branch selection is pure and explicit: absent/inactive exploration weather returns the ordinary
 * iso path with no FPS object enabled. 01G must not call the exploration factories in that state.
 * Passing the budget also reports which optional FPS effects the device tier actually enabled.
 */
export const explorationWeatherBranch = (
  active: boolean,
  budget?: ExplorationWeatherBudget
): ExplorationWeatherBranch => {
  if (!active) {
    return {
      explorationLightning: false,
      explorationRain: false,
      explorationSky: false,
      explorationSplashes: false,
      mode: "iso",
      ordinaryClouds: true,
      ordinaryRain: true
    };
  }
  return {
    explorationLightning: budget?.lightning ?? true,
    explorationRain: (budget?.drops ?? 1) > 0,
    explorationSky: true,
    explorationSplashes: (budget?.splashes ?? 1) > 0,
    mode: "fps",
    ordinaryClouds: false,
    ordinaryRain: false
  };
};
