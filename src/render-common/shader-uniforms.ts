import { sunPresence, writeSunDiscChroma } from "./atmosphere/sun-radiance";
import { type EnvironmentState, getSunVector } from "./environment";
import { WORLD_TIME_SCALE } from "./environment-clock";
import { NEUTRAL_HIGHLIGHTS } from "./highlights";
import { VIEW_DIRECTION } from "./iso-projection";
import { getSkyLight, SKY_SH_FLOATS, writeHemisphereSkyLight } from "./lighting/sky-irradiance";
import type { FrameState } from "./renderer-contract";

/**
 * Values of COMMON_UNIFORMS_GLSL. Every material binds these very arrays (mutated in place each
 * frame), so all shaders always receive identical inputs.
 */
export interface SharedUniformValues {
  uLiveFog: number;
  /** Linear-light fog colour (ungraded): the shared colour output grades the fogged result. */
  uAtmosphereAirlightLinear: Float32Array;
  /** Light direction xyz and the airlight share in-scattered as a sun lobe (R06a; 0 = off). */
  uAtmosphereSun: Float32Array;
  /** Linear lobe colour (luminance of the airlight) and the Henyey-Greenstein g. */
  uAtmosphereSunTint: Float32Array;
  /** Two world-anchored mist banks: centre xyz + horizontal radius, params [density, vertical, softness, count]. */
  uAtmosphereBankA: Float32Array;
  uAtmosphereBankB: Float32Array;
  uAtmosphereBankParams: Float32Array;
  uAtmosphereBoundsMin: Float32Array;
  uAtmosphereBoundsMax: Float32Array;
  uAtmosphereEye: Float32Array;
  /** Perspective render boundary only; never an extinction parameter. */
  uAtmosphereFar: number;
  /** Current orthographic view depth in world units; 0 keeps the legacy full-volume path. */
  uAtmosphereOrthoDepth: number;
  uAtmosphereForward: Float32Array;
  uAtmospherePass: number;
  /** Rainbow strength (atmosphere/rainbow.ts): 0 off; only the possessed view on Medium/High. */
  uAtmosphereRainbow: number;
  /** Extinction, height falloff, reference height, orthographic flag. */
  uAtmosphereProfile: Float32Array;
  uAmbientGround: Float32Array;
  uAmbientSky: Float32Array;
  uBakedShadowWeight: number;
  uCloudCover: number;
  /** Wind displacement accumulated over the cloud clock; sky clouds and shadows share it. */
  uCloudDrift: Float32Array;
  /** Slow cloud clock; other shader animation keeps the real frame time. */
  uCloudTime: number;
  /** Rain amount the shared art grade desaturates by (color-output-glsl.ts). */
  uColorGradeRain: number;
  /**
   * COLOR_OUTPUT_MODE: 0 writes final display pixels, 1 linear radiance inside the refraction
   * capture, 2 encoded radiance into the HDR scene target (R10).
   */
  uColorOutputMode: number;
  /** Development A/B tonemapper (COLOR_TONE_MAPPER_INDEX): 0 Neutral, 1 AgX. */
  uColorToneMapper: number;
  /** Extra Vivid grade saturation (0.1 = +10 %), per quality preset; fades out towards Filmic. */
  uColorVividBoost: number;
  /** Environment daylight 0..1 (night .. day): the shared sky model's day/night blend. */
  uDaylight: number;
  /** Enables only the separate presentation concealment veil while walking. */
  uExplorationFog: number;
  /** Highlights / glare setting 0..1 (highlights.ts): glints, specular, foam glare; 1 = unchanged. */
  uHighlight: number;
  uFogColor: Float32Array;
  /** 1: the lit fog-of-war cover (QualityPreset.fogOfWarStyle "lit"); 0: the flat cover. */
  uFogOfWarLit: number;
  uRain: number;
  /** SH9 sky irradiance / π (lighting/sky-irradiance.ts): the ambient of every raw surface. */
  uSkyIrradiance: Float32Array;
  /** SH9 sky radiance mirrored below the horizon: what water reflects. */
  uSkyReflection: Float32Array;
  uSunColor: Float32Array;
  uSunDirection: Float32Array;
  /** Water glint colour: the sun disc's hue by day (sun-radiance.ts), the tinted light at night. */
  uSunGlint: Float32Array;
  uTime: number;
  uViewDirection: Float32Array;
  uWind: Float32Array;
  /** Unit-direction wind phase, shared by vegetation and crop gusts. */
  uWindPhase: Float32Array;
  /** Map size in cells (cellsX, cellsZ); (0, 0) for scenes without a map edge (showcases). */
  uWorldSize: Float32Array;
}

/** Scalar uniforms: copied by value, so renderers re-assign them after every update. */
export const SCALAR_UNIFORMS = [
  "uAtmosphereFar",
  "uAtmosphereOrthoDepth",
  "uAtmospherePass",
  "uAtmosphereRainbow",
  "uBakedShadowWeight",
  "uCloudCover",
  "uCloudTime",
  "uColorGradeRain",
  "uColorOutputMode",
  "uColorToneMapper",
  "uColorVividBoost",
  "uDaylight",
  "uExplorationFog",
  "uFogOfWarLit",
  "uHighlight",
  "uRain",
  "uTime",
  "uLiveFog"
] as const;

/** The day keyframe's hemisphere until the first environment arrives. */
const DEFAULT_SKY: readonly [number, number, number] = [0.52, 0.6, 0.72];
const DEFAULT_GROUND: readonly [number, number, number] = [0.36, 0.3, 0.22];

const createDefaultSkyLight = () => {
  const irradiance = new Float32Array(SKY_SH_FLOATS);
  const reflection = new Float32Array(SKY_SH_FLOATS);
  writeHemisphereSkyLight(DEFAULT_SKY, DEFAULT_GROUND, irradiance, reflection);
  return { irradiance, reflection };
};

/** Shared uniform values; a map's size turns on its black edge beyond the playable area. */
export const createSharedUniformValues = (
  map: { cellsX: number; cellsZ: number } | null = null
): SharedUniformValues => createUniformValues(map, createDefaultSkyLight());

const createUniformValues = (
  map: { cellsX: number; cellsZ: number } | null,
  sky: { irradiance: Float32Array; reflection: Float32Array }
): SharedUniformValues => ({
  uLiveFog: 0,
  uAtmosphereAirlightLinear: new Float32Array(3),
  uAtmosphereSun: new Float32Array(4),
  uAtmosphereSunTint: new Float32Array(4),
  uAtmosphereBankA: new Float32Array(4),
  uAtmosphereBankB: new Float32Array(4),
  uAtmosphereBankParams: new Float32Array(4),
  uAtmosphereBoundsMin: Float32Array.from([-1024, -64, -1024]),
  uAtmosphereBoundsMax: Float32Array.from([1024, 96, 1024]),
  uAtmosphereEye: new Float32Array(3),
  uAtmosphereFar: 0,
  uAtmosphereOrthoDepth: 0,
  uAtmosphereForward: Float32Array.from([0, 0, -1]),
  uAtmospherePass: 1,
  uAtmosphereRainbow: 0,
  uAtmosphereProfile: Float32Array.from([0, 0.065, 2, 0]),
  uAmbientGround: new Float32Array(3),
  uAmbientSky: new Float32Array(3),
  uBakedShadowWeight: 1,
  uCloudCover: 0,
  uCloudDrift: new Float32Array(2),
  uCloudTime: 0,
  uColorGradeRain: 0,
  uColorOutputMode: 0,
  uColorToneMapper: 0,
  uColorVividBoost: 0,
  uDaylight: 1,
  uExplorationFog: 0,
  uFogColor: new Float32Array(3),
  uFogOfWarLit: 0,
  uHighlight: NEUTRAL_HIGHLIGHTS,
  uRain: 0,
  uSkyIrradiance: sky.irradiance,
  uSkyReflection: sky.reflection,
  uSunColor: new Float32Array(3),
  uSunDirection: new Float32Array(3),
  uSunGlint: new Float32Array(3),
  uTime: 0,
  uViewDirection: Float32Array.from([VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z]),
  uWind: new Float32Array(2),
  uWindPhase: new Float32Array(2),
  uWorldSize: Float32Array.from(map ? [map.cellsX, map.cellsZ] : [0, 0])
});

interface WindPhaseClock {
  dirX: number;
  dirZ: number;
  time: number;
}

const windPhaseClocks = new WeakMap<SharedUniformValues, WindPhaseClock>();

const getWindDirection = (windX: number, windZ: number): [number, number] => {
  const length = Math.hypot(windX, windZ);
  if (!Number.isFinite(length) || length < 1e-6) return [0, 0];
  return [windX / length, windZ / length];
};

/**
 * Advances the travelling-gust phase by unit wind direction, not raw strength: a rain ramp must
 * not speed up the noise field. Repeated timestamps pause it and a rewound clock restarts at zero.
 */
const advanceWindPhase = (
  values: SharedUniformValues,
  time: number,
  windX: number,
  windZ: number
) => {
  if (!Number.isFinite(time)) return;
  const [dirX, dirZ] = getWindDirection(
    Number.isFinite(windX) ? windX : 0,
    Number.isFinite(windZ) ? windZ : 0
  );
  const phase = values.uWindPhase;
  const clock = windPhaseClocks.get(values);
  if (!clock) {
    phase[0] = dirX * time || 0;
    phase[1] = dirZ * time || 0;
    windPhaseClocks.set(values, { dirX, dirZ, time });
    return;
  }
  if (time < clock.time) {
    phase[0] = 0;
    phase[1] = 0;
  } else {
    const delta = time - clock.time;
    phase[0]! += (clock.dirX + dirX) * 0.5 * delta;
    phase[1]! += (clock.dirZ + dirZ) * 0.5 * delta;
  }
  clock.dirX = dirX;
  clock.dirZ = dirZ;
  clock.time = time;
};

/** Previous cloud-clock sample: drift integrates wind velocity over time, not position. */
interface CloudDriftClock {
  time: number;
  windX: number;
  windZ: number;
}

const cloudDriftClocks = new WeakMap<SharedUniformValues, CloudDriftClock>();

/**
 * Advances the shared cloud displacement by this update's wind over the cloud-clock delta. A
 * rewound clock (replay scrub, tab-resume reset) restarts from zero instead of integrating
 * backwards, and a repeated timestamp leaves the drift untouched (paused frame).
 */
const advanceCloudDrift = (values: SharedUniformValues, time: number, windX: number, windZ: number) => {
  if (!Number.isFinite(time)) return;
  const x = Number.isFinite(windX) ? windX : 0;
  const z = Number.isFinite(windZ) ? windZ : 0;
  const drift = values.uCloudDrift;
  const clock = cloudDriftClocks.get(values);
  if (!clock) {
    // Keep the old absolute-clock placement on the first frame, then integrate velocity.
    drift[0] = x * time || 0;
    drift[1] = z * time || 0;
    cloudDriftClocks.set(values, { time, windX: x, windZ: z });
    return;
  }
  if (time < clock.time) {
    // Never integrate a negative delta: the field restarts at a known origin.
    drift[0] = 0;
    drift[1] = 0;
  } else {
    // Average the interval's wind so a rain fade changes speed without a positional jump.
    const delta = time - clock.time;
    drift[0]! += (clock.windX + x) * 0.5 * delta;
    drift[1]! += (clock.windZ + z) * 0.5 * delta;
  }
  clock.time = time;
  clock.windX = x;
  clock.windZ = z;
};

/** Warm tint of the former glint colour, kept for moonlit glints. */
const MOON_GLINT_TINT = [1, 0.9, 0.72] as const;
const sunGlintChroma = new Float32Array(3);

/**
 * Glints take the sun disc's hue at the sun's strength by day, so the glitter on the sea matches
 * the disc (white at noon, red at sunset); with the moon as the light they keep the tinted light.
 */
const writeSunGlint = (target: Float32Array, environment: EnvironmentState) => {
  const light = environment.sunColor;
  const presence = sunPresence(environment.daylight);
  const strength = Math.max(light[0], light[1], light[2]);
  writeSunDiscChroma(environment.sun.elevation, sunGlintChroma);
  for (let channel = 0; channel < 3; channel++) {
    const moonlit = light[channel]! * MOON_GLINT_TINT[channel]!;
    target[channel] = moonlit + (sunGlintChroma[channel]! * strength - moonlit) * presence;
  }
};

/** Copies the frame's environment into the uniform arrays. */
export const updateSharedUniformValues = (
  values: SharedUniformValues,
  frame: Pick<FrameState, "environment" | "time">
) => {
  const { environment } = frame;
  values.uTime = frame.time;
  values.uCloudCover = environment.cloudCover;
  values.uCloudTime = frame.time / WORLD_TIME_SCALE;
  advanceCloudDrift(values, values.uCloudTime, environment.windX, environment.windZ);
  advanceWindPhase(values, frame.time, environment.windX, environment.windZ);
  values.uRain = environment.rain;
  values.uDaylight = Math.min(1, Math.max(0, environment.daylight));
  values.uColorGradeRain = environment.rain;
  values.uBakedShadowWeight = environment.bakedShadowWeight;
  values.uAmbientGround.set(environment.ambientGround);
  values.uAmbientSky.set(environment.ambientSky);
  values.uFogColor.set(environment.fogColor);
  values.uSunColor.set(environment.sunColor);
  values.uSunDirection.set(getSunVector(environment.sun));
  writeSunGlint(values.uSunGlint, environment);
  const sky = getSkyLight(environment);
  values.uSkyIrradiance.set(sky.irradiance);
  values.uSkyReflection.set(sky.reflection);
  values.uWind[0] = environment.windX;
  values.uWind[1] = environment.windZ;
};
