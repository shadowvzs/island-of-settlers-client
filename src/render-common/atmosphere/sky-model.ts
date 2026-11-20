import type { Color3, EnvironmentState } from "../environment";

/**
 * The one sky radiance of the game (R06b): the gradient the possessed and perspective skies show,
 * which the sky-view LUT tabulates and the SH9 sky light, the water reflection and the sky
 * environment map read. Daylight blue is slightly desaturated near the horizon; a low sun mixes
 * warm haze into the horizon and a broad forward-scattering lobe around the light; night falls to
 * a dark blue zenith. Display-authored, like the keyframe palette. The GLSL below is generated
 * from the same constants, so the CPU twin and the shaders cannot drift apart. Worker-safe.
 */
export const SKY_MODEL = {
  dayHorizon: [0.46, 0.61, 0.75],
  /** Share of the keyframe fog colour in the day horizon. */
  dayHorizonFog: 0.32,
  /**
   * Deep saturated blue (owner 2026-11-17, TOOL-8: clear-sky clips measured a far deeper zenith than
   * the game's pale blue), so white cumulus reads clearly without brighter clouds; the horizon stays pale.
   */
  dayZenith: [0.035, 0.215, 0.66],
  /** Share and gain of the keyframe ambient sky in the day zenith (less of the paler keyframe sky). */
  dayZenithAmbient: 0.12,
  dayZenithAmbientGain: 1.15,
  forwardScatterBase: 0.08,
  forwardScatterLowSun: 0.15,
  lowSunBand: [1, 0.52, 0.26],
  lowSunBandBase: 0.22,
  lowSunBandFacing: 0.18,
  /** Sun height range over which the low-sun band and lobe boost fade out. */
  lowSunEnd: 0.48,
  lowSunStart: 0.06,
  nightHorizon: [0.025, 0.04, 0.075],
  nightZenith: [0.005, 0.012, 0.035],
  zenithPower: 0.62
} as const;

/** Light inputs of the sky model, refilled in place (no allocation per frame). */
export interface SkyModelInputs {
  cloudCover: number;
  daylight: number;
  fog: Float64Array;
  sky: Float64Array;
  /** Unit vector toward the sun (or moon). */
  sun: Float64Array;
  sunColor: Float64Array;
}

export const createSkyModelInputs = (): SkyModelInputs => ({
  cloudCover: 0,
  daylight: 1,
  fog: new Float64Array(3),
  sky: new Float64Array(3),
  sun: new Float64Array(3),
  sunColor: new Float64Array(3)
});

/** The canonical light vector (environment.ts getSunVector), written in place. */
export const fillSkyModelInputs = (environment: EnvironmentState, inputs: SkyModelInputs) => {
  const { azimuthX, azimuthZ, elevation } = environment.sun;
  const horizontal = Math.cos(elevation);
  inputs.cloudCover = environment.cloudCover;
  inputs.daylight = Math.min(1, Math.max(0, environment.daylight));
  inputs.fog.set(environment.fogColor);
  inputs.sky.set(environment.ambientSky);
  inputs.sun[0] = azimuthX * horizontal;
  inputs.sun[1] = Math.sin(elevation);
  inputs.sun[2] = azimuthZ * horizontal;
  inputs.sunColor.set(environment.sunColor);
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

/**
 * The sky radiance toward (x, y, z) into `target` (RGB): the gradient above the horizon, and for
 * slightly downward rays the same horizon colour (the caller blends the ground or background).
 */
export const writeSkyModelRadiance = (
  inputs: SkyModelInputs, x: number, y: number, z: number, target: Float64Array | Float32Array,
  offset = 0
) => {
  const model = SKY_MODEL, daylight = inputs.daylight;
  const zenithBlend = smoothstep(0, 1, y) ** model.zenithPower;
  const facing = Math.max(0, x * inputs.sun[0]! + y * inputs.sun[1]! + z * inputs.sun[2]!);
  const lowSun = daylight * (1 - smoothstep(model.lowSunStart, model.lowSunEnd, inputs.sun[1]!));
  const band = lowSun * (model.lowSunBandBase + facing ** 3 * model.lowSunBandFacing);
  const lobe = facing ** 8 * daylight * (model.forwardScatterBase + lowSun * model.forwardScatterLowSun);
  for (let channel = 0; channel < 3; channel++) {
    const dayZenith = mix(model.dayZenith[channel]!,
      inputs.sky[channel]! * model.dayZenithAmbientGain, model.dayZenithAmbient);
    const dayHorizon = mix(model.dayHorizon[channel]!, inputs.fog[channel]!, model.dayHorizonFog);
    const zenith = mix(model.nightZenith[channel]!, dayZenith, daylight);
    const horizon = mix(mix(model.nightHorizon[channel]!, dayHorizon, daylight),
      model.lowSunBand[channel]!, band);
    target[offset + channel] = mix(horizon, zenith, zenithBlend) + inputs.sunColor[channel]! * lobe;
  }
};

const glslNumber = (value: number) => value.toFixed(4);
const glslVec3 = (value: Color3) => `vec3(${value.map(glslNumber).join(", ")})`;

/**
 * GLSL twin of writeSkyModelRadiance (needs uAmbientSky, uFogColor and uSunColor).
 * `daylight` is the environment daylight clamped to 0..1.
 */
export const SKY_MODEL_GLSL = `
vec3 skyModelRadiance(vec3 direction, vec3 lightDirection, float daylight) {
  float zenithBlend = pow(smoothstep(0.0, 1.0, direction.y), ${glslNumber(SKY_MODEL.zenithPower)});
  float facing = max(dot(direction, lightDirection), 0.0);
  float lowSun = daylight * (1.0 - smoothstep(${glslNumber(SKY_MODEL.lowSunStart)},
    ${glslNumber(SKY_MODEL.lowSunEnd)}, lightDirection.y));
  float band = lowSun * (${glslNumber(SKY_MODEL.lowSunBandBase)}
    + facing * facing * facing * ${glslNumber(SKY_MODEL.lowSunBandFacing)});
  float facing2 = facing * facing, facing4 = facing2 * facing2;
  float lobe = facing4 * facing4 * daylight * (${glslNumber(SKY_MODEL.forwardScatterBase)}
    + lowSun * ${glslNumber(SKY_MODEL.forwardScatterLowSun)});
  vec3 dayZenith = mix(${glslVec3(SKY_MODEL.dayZenith)},
    uAmbientSky * ${glslNumber(SKY_MODEL.dayZenithAmbientGain)}, ${glslNumber(SKY_MODEL.dayZenithAmbient)});
  vec3 dayHorizon = mix(${glslVec3(SKY_MODEL.dayHorizon)}, uFogColor, ${glslNumber(SKY_MODEL.dayHorizonFog)});
  vec3 zenith = mix(${glslVec3(SKY_MODEL.nightZenith)}, dayZenith, daylight);
  vec3 horizon = mix(mix(${glslVec3(SKY_MODEL.nightHorizon)}, dayHorizon, daylight),
    ${glslVec3(SKY_MODEL.lowSunBand)}, band);
  return mix(horizon, zenith, zenithBlend) + uSunColor * lobe;
}
`;
