import { lerp3 } from "../shared/world/noise";
import { PREVAILING_WIND } from "../shared/world/prevailing-wind";
import type { SunDirection } from "../shared/world/world-data";
import type { SeasonWeights } from "./seasonal-appearance/season-weights";

export type Color3 = readonly [number, number, number];

/** Light and weather of a frame (one source for every material). */
export interface EnvironmentState {
  /** Drops left after rain, 0..1 (atmosphere/rainbow.ts); presentation only, never saved. */
  afterRain?: number;
  ambientGround: Color3;
  ambientSky: Color3;
  /** How much the baked (default sun) terrain shadows still apply, 0..1. */
  bakedShadowWeight: number;
  cloudCover: number;
  /** 0 night .. 1 day (dawn and dusk in between): ambient life such as birds follows it. */
  daylight: number;
  fogColor: Color3;
  /** 0 dry .. 1 heavy rain. */
  rain: number;
  /** Strength of object shadows (baked sprite shadows, moonlight is weaker). */
  shadowStrength: number;
  /** Cosmetic global season of this island (season-weights.ts); absent: summer. Never saved. */
  season?: SeasonWeights;
  /** 0 none .. 1 heavy snowfall (rain and snow never fall together). */
  snow: number;
  /** Direction of the main light: the sun by day, the moon by night. */
  sun: SunDirection;
  sunColor: Color3;
  /** Lunar phase for the sky disc: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  moonPhase?: number;
  /** Direction of the sun below the horizon that lights the moon (moonSunDirection). */
  moonSun?: SunDirection;
  /** Fixed celestial pole the night stars turn about (celestialPole). */
  starPole?: SunDirection;
  /** Sidereal rotation of the stars about that pole (radians, starRotation). */
  starRotation?: number;
  /** 0 .. 1 darkness of the sky for stars: astronomical twilight after dusk and before dawn. */
  starlight?: number;
  /** Horizontal wind direction (normalised) times strength. */
  windX: number;
  windZ: number;
}

interface LightKeyframe {
  ambientGround: Color3;
  ambientSky: Color3;
  fogColor: Color3;
  hour: number;
  lightColor: Color3;
  shadowStrength: number;
}

const NIGHT: Omit<LightKeyframe, "hour"> = {
  ambientGround: [0.05, 0.05, 0.08],
  ambientSky: [0.14, 0.19, 0.33],
  fogColor: [0.24, 0.27, 0.36],
  lightColor: [0.3, 0.36, 0.55],
  shadowStrength: 0.3
};
const DAWN: Omit<LightKeyframe, "hour"> = {
  ambientGround: [0.3, 0.22, 0.2],
  ambientSky: [0.48, 0.45, 0.58],
  fogColor: [0.78, 0.66, 0.66],
  lightColor: [1.2, 0.74, 0.5],
  shadowStrength: 0.7
};
const DAY: Omit<LightKeyframe, "hour"> = {
  ambientGround: [0.36, 0.3, 0.22],
  ambientSky: [0.52, 0.6, 0.72],
  fogColor: [0.74, 0.78, 0.84],
  lightColor: [1.08, 0.98, 0.84],
  shadowStrength: 1
};
const DUSK: Omit<LightKeyframe, "hour"> = {
  ambientGround: [0.3, 0.2, 0.18],
  ambientSky: [0.45, 0.38, 0.52],
  fogColor: [0.7, 0.56, 0.55],
  lightColor: [1.25, 0.66, 0.4],
  shadowStrength: 0.7
};

const KEYFRAMES: LightKeyframe[] = [
  { ...NIGHT, hour: 0 },
  { ...NIGHT, hour: 4.8 },
  { ...DAWN, hour: 6.5 },
  { ...DAY, hour: 9 },
  { ...DAY, hour: 15.5 },
  { ...DUSK, hour: 17.8 },
  { ...NIGHT, hour: 19.5 },
  { ...NIGHT, hour: 24 }
];

export const TIME_PRESETS = { dawn: 6.6, day: 12, dusk: 17.8, night: 23 } as const;


const sampleKeyframes = (hour: number) => {
  const index = KEYFRAMES.findIndex((frame) => frame.hour > hour);
  const next = KEYFRAMES[Math.max(1, index)]!;
  const previous = KEYFRAMES[Math.max(0, index - 1)]!;
  const raw = (hour - previous.hour) / Math.max(0.001, next.hour - previous.hour);
  const t = raw * raw * (3 - 2 * raw);
  return {
    ambientGround: lerp3(previous.ambientGround, next.ambientGround, t),
    ambientSky: lerp3(previous.ambientSky, next.ambientSky, t),
    fogColor: lerp3(previous.fogColor, next.fogColor, t),
    lightColor: lerp3(previous.lightColor, next.lightColor, t),
    shadowStrength: previous.shadowStrength + (next.shadowStrength - previous.shadowStrength) * t
  };
};

const SUN_SWING = (75 * Math.PI) / 180;
/**
 * Lowest elevation of the light vector (radians, about 6.9 degrees): the sun fades out here at
 * dusk instead of crossing the horizon, so this is the game's sunset (sun-radiance.ts).
 */
export const LOWEST_LIGHT_ELEVATION = 0.12;
/** The moon's light follows the sunset-to-sunrise arc instead of jumping to one fixed angle. */
const NIGHT_HOURS = 12;

/**
 * The sun rises at 6, peaks at noon in the default direction (the one the terrain light was
 * baked for) and sets at 18. At night the moon crosses the opposite arc smoothly, so shadows
 * keep drifting at roughly the daytime angular speed instead of swinging around at sunset.
 */
/** 0 night .. 1 day: the sun is up from 6 to 18, with short twilights. */
const getDaylight = (hour: number) =>
  Math.min(1, Math.max(0, (Math.sin(((hour - 6) / 12) * Math.PI) + 0.08) * 4));

/** Shortest signed angle from `from` to `to`, in radians. */
const angleDelta = (from: number, to: number) => {
  let delta = (to - from + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  return delta - Math.PI;
};

/** 0 at sunset (18:00), 1 at sunrise (06:00); daytime keeps the nearer endpoint. */
const getNightProgress = (hour: number) => {
  if (hour < 6) return (hour + 6) / NIGHT_HOURS;
  if (hour >= 18) return (hour - 18) / NIGHT_HOURS;
  return hour < 12 ? 1 : 0;
};

const getLightDirection = (base: SunDirection, hour: number): SunDirection => {
  const baseAngle = Math.atan2(base.azimuthZ, base.azimuthX);
  const daylight = getDaylight(hour);
  const t = Math.min(1, Math.max(0, (hour - 6) / 12));
  const sunAngle = baseAngle + SUN_SWING * (1 - 2 * t);
  const sunriseAngle = baseAngle + SUN_SWING;
  const sunsetAngle = baseAngle - SUN_SWING;
  const nightProgress = getNightProgress(hour);
  const nightAngle = sunsetAngle + angleDelta(sunsetAngle, sunriseAngle) * nightProgress;
  // Daylight pulls the direction back to the sun near dawn and dusk; both are at the same
  // horizon angle there, so the blend cannot produce the old 150-degree sunset snap.
  const angle = nightAngle + angleDelta(nightAngle, sunAngle) * daylight;
  const sunElevation = LOWEST_LIGHT_ELEVATION + 0.85 * Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const nightElevation = LOWEST_LIGHT_ELEVATION + 0.48 * Math.sin(Math.PI * nightProgress);
  const elevation = nightElevation + (sunElevation - nightElevation) * daylight;
  return { azimuthX: Math.cos(angle), azimuthZ: Math.sin(angle), elevation };
};

const getBakedShadowWeight = (base: SunDirection, light: SunDirection) => {
  const alignment = base.azimuthX * light.azimuthX + base.azimuthZ * light.azimuthZ;
  return Math.min(1, Math.max(0.25, (alignment - 0.3) / 0.6));
};

const RAIN_SKY: Color3 = [0.42, 0.46, 0.52];
const RAIN_FOG: Color3 = [0.55, 0.58, 0.62];
const BASE_WIND: [number, number] = [PREVAILING_WIND.x, PREVAILING_WIND.z];

/** Snowfall darkens the sky less than rain: a bright overcast. */
const SNOW_OVERCAST = 0.55;

/** 0 clear .. 1 full overcast from rain and snowfall (snow is a lighter overcast). */
export const environmentOvercast = (rain: number, snow: number) => Math.max(rain, snow * SNOW_OVERCAST);

/**
 * Owner 2026-11-07: the real-time sun shadow map (trees, buildings, people, ships, roads) keeps
 * at least this share of its strength when the sun moves away from the island's baked direction;
 * only the old baked terrain shadow fades fully with `bakedShadowWeight`.
 */
export const SUN_SHADOW_WEIGHT_FLOOR = 0.7;

/**
 * Strength (0..1) of the real-time sun shadow map: the baked-direction alignment, floored at
 * SUN_SHADOW_WEIGHT_FLOOR, times the same overcast fade (rain, snow) the baked weight carries.
 */
export const getSunShadowWeight = (environment: Pick<EnvironmentState, "bakedShadowWeight" | "rain" | "snow">) => {
  const overcastFade = 1 - environmentOvercast(environment.rain, environment.snow) * 0.5;
  const alignment = environment.bakedShadowWeight / overcastFade;
  return Math.min(1, Math.max(alignment, SUN_SHADOW_WEIGHT_FLOOR)) * overcastFade;
};

/**
 * Environment for a time of day (0..24), rain and snowfall amounts (0..1): either one brings
 * clouds and a dull sky (snow a lighter overcast); only rain wets the surfaces (uRain).
 */
/** Mean synodic month in in-game days (29.530588 real days). */
export const LUNAR_CYCLE_DAYS = 29.530588;
/** Day 0 starts at full moon, preserving the existing bright-moon convention. */
export const LUNAR_PHASE_OFFSET_DAYS = LUNAR_CYCLE_DAYS / 2;
/** 0 new .. 0.25 first quarter .. 0.5 full .. 0.75 last quarter. */
export const moonPhaseForDay = (day: number, hour = 0) => {
  const cycle = ((day + hour / 24 + LUNAR_PHASE_OFFSET_DAYS) % LUNAR_CYCLE_DAYS + LUNAR_CYCLE_DAYS) %
    LUNAR_CYCLE_DAYS;
  return cycle / LUNAR_CYCLE_DAYS;
};

/** Depression of the sun that lights the moon below the horizon (radians, about 17 degrees). */
const MOON_SUN_DEPRESSION = 0.3;

/**
 * The sun that lights the moon's disc. The light vector carries only one body, so the night sun is
 * placed below the horizon where it set (waxing moon: it follows the sun, lit on the sunset side)
 * or where it will rise (waning moon: lit on the sunrise side), as an observer sees it.
 */
export const moonSunDirection = (base: SunDirection, phase: number): SunDirection => {
  const baseAngle = Math.atan2(base.azimuthZ, base.azimuthX);
  const waxing = ((phase % 1) + 1) % 1 < 0.5;
  const angle = baseAngle + (waxing ? -SUN_SWING : SUN_SWING);
  return { azimuthX: Math.cos(angle), azimuthZ: Math.sin(angle), elevation: -MOON_SUN_DEPRESSION };
};

/** Elevation of the celestial pole (radians, about 20 degrees): the latitude of a warm island. */
const STAR_POLE_ELEVATION = 0.35;
/** Sidereal days per solar day: the stars gain about one degree per day on the sun. */
const SIDEREAL_RATE = 366.2422 / 365.2422;

/** The celestial pole, opposite the noon sun's azimuth (the sun culminates on the far side). */
export const celestialPole = (base: SunDirection): SunDirection => ({
  azimuthX: -base.azimuthX, azimuthZ: -base.azimuthZ, elevation: STAR_POLE_ELEVATION
});

/** Sidereal angle of the star sphere at a game time (radians, 0 .. 2 pi). */
export const starRotation = (day: number, hour: number) => {
  const turns = ((day + hour / 24) * SIDEREAL_RATE) % 1;
  return (turns < 0 ? turns + 1 : turns) * Math.PI * 2;
};

/** Astronomical twilight in game hours: stars come out after dusk and fade before dawn. */
const STARS_OUT = [18.2, 19.2] as const;
const STARS_IN = [4.8, 5.8] as const;

/** 0 .. 1 how dark the sky is for stars at a time of day (0 by day, 1 in full night). */
export const starlightForHour = (hour: number) => {
  const time = ((hour % 24) + 24) % 24;
  const fade = (from: number, to: number) => Math.min(1, Math.max(0, (time - from) / (to - from)));
  const evening = fade(STARS_OUT[0], STARS_OUT[1]);
  const morning = 1 - fade(STARS_IN[0], STARS_IN[1]);
  const t = time >= 12 ? evening : morning;
  return t * t * (3 - 2 * t);
};

export const computeEnvironment = (
  baseSun: SunDirection,
  hour: number,
  rain: number,
  snow = 0,
  cloudCover?: number,
  day = 0
): EnvironmentState => {
  const light = sampleKeyframes(((hour % 24) + 24) % 24);
  const sun = getLightDirection(baseSun, hour);
  const overcast = environmentOvercast(rain, snow);
  const wind = 1 + rain * 1.4 + snow * 0.3;
  const moonPhase = moonPhaseForDay(day, hour);
  return {
    ambientGround: lerp3(
      light.ambientGround,
      lerp3(light.ambientGround, [0.2, 0.2, 0.22], 0.5),
      overcast
    ),
    ambientSky: lerp3(light.ambientSky, lerp3(light.ambientSky, RAIN_SKY, 0.6), overcast),
    bakedShadowWeight: getBakedShadowWeight(baseSun, sun) * (1 - overcast * 0.5),
    cloudCover: cloudCover ?? 0.45 + overcast * 0.5,
    daylight: getDaylight(hour),
    fogColor: lerp3(light.fogColor, lerp3(light.fogColor, RAIN_FOG, 0.6), overcast),
    rain,
    shadowStrength: light.shadowStrength * (1 - overcast * 0.65),
    snow,
    sun,
    sunColor: lerp3(light.lightColor, [0, 0, 0], overcast * 0.55),
    moonPhase,
    moonSun: moonSunDirection(baseSun, moonPhase),
    starPole: celestialPole(baseSun),
    starRotation: starRotation(day, hour),
    starlight: starlightForHour(hour),
    windX: BASE_WIND[0] * wind,
    windZ: BASE_WIND[1] * wind
  };
};

/** Unit vector pointing towards the sun, in world space. */
export const getSunVector = (sun: SunDirection): [number, number, number] => {
  const horizontal = Math.cos(sun.elevation);
  return [sun.azimuthX * horizontal, Math.sin(sun.elevation), sun.azimuthZ * horizontal];
};

/** Target-relative offset for a directional light that must match the canonical sun vector. */
export const getSunLightOffset = (sun: SunDirection, distance: number): [number, number, number] => {
  const [x, y, z] = getSunVector(sun);
  return [x * distance, y * distance, z * distance];
};
