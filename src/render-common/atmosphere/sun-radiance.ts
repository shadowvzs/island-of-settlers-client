import { LOWEST_LIGHT_ELEVATION } from "../environment";

/**
 * The sun seen through the air (possessed sky): the colour and HDR intensity of the disc centre
 * from the relative air mass of a hazy maritime atmosphere, and how much stronger its aerosol
 * aureole grows along the slant path. Linear light, white balanced to the zenith sun (a daylight
 * camera), so a high sun reads white, a mid sun yellow, the setting sun orange and the lowest sun
 * red. Values well above 1 are intended: the sky shader soft-clips them over the tonemapped sky
 * (photographic highlight roll-off) and the analytic glare spreads them. Pure and worker-safe; no
 * allocation per call.
 */

/**
 * Zenith optical depth per channel (~680 / 550 / 440 nm) of a humid coast: Rayleigh
 * (0.041 / 0.097 / 0.244), aerosol with Angstrom beta 0.16 and exponent 1.3 (0.264 / 0.348 /
 * 0.465) and ozone (0.018 / 0.030 / 0.003).
 */
export const SUN_ZENITH_OPTICAL_DEPTH = [0.323, 0.475, 0.712] as const;
/** Aerosol share of the green zenith depth: it alone feeds the forward-scatter aureole. */
const AEROSOL_ZENITH_DEPTH = 0.348;
/** Exoatmospheric solar colour in linear sRGB (about 5,800 K against a D65 white). */
const SUN_SPACE_COLOR = [1, 0.97, 0.93] as const;
/** HDR radiance of the disc centre for an overhead sun: about 24 times display white. */
export const SUN_DISC_PEAK = 24;
/** Overcast share of the disc that the weather removes (the cloud layers occlude the rest). */
const OVERCAST_DIMMING = 0.8;
/**
 * Apparent elevation (radians, about 1.7 degrees) of the game's lowest light. The light vector
 * never goes below LOWEST_LIGHT_ELEVATION: the sun fades out there, so that point is the game's
 * sunset and its colour is that of a sun just above the sea horizon (air mass about 21).
 */
export const SUN_SETTING_APPARENT_ELEVATION = 0.03;
/**
 * Brightness adaptation of the eye (or an auto-exposed camera) to the dimming low sun: the disc
 * keeps (red transmittance)^(1 - 0.65) of its extinction, so the setting sun stays a vivid red
 * light (about 2.6x display white) instead of fading to a dark brown circle. Hue is unaffected.
 */
const SUN_ADAPTATION = 0.65;
/**
 * Share of the slant path whose colour the aureole's scattered light keeps: it is scattered all
 * along the path, so it is less red than the disc (an orange glow around a red setting sun).
 */
const AUREOLE_PATH_SHARE = 0.5;
const DEGREES = 180 / Math.PI;
const HALF_PI = Math.PI / 2;

/** Kasten-Young (1989) relative optical air mass; the elevation is clamped at the horizon. */
export const relativeAirMass = (elevation: number) => {
  const height = Math.max(0, Number.isFinite(elevation) ? elevation : 0);
  return 1 / (Math.sin(height) + 0.50572 * (height * DEGREES + 6.07995) ** -1.6364);
};

/**
 * Light-vector elevation -> apparent sun elevation: a linear stretch that maps the game's lowest
 * light onto SUN_SETTING_APPARENT_ELEVATION and keeps the zenith (noon changes by under 4 %).
 */
export const apparentSunElevation = (elevation: number) => {
  const height = Number.isFinite(elevation) ? elevation : 0;
  const scale = (HALF_PI - SUN_SETTING_APPARENT_ELEVATION) / (HALF_PI - LOWEST_LIGHT_ELEVATION);
  return Math.max(0, SUN_SETTING_APPARENT_ELEVATION + (height - LOWEST_LIGHT_ELEVATION) * scale);
};

export interface SunRadianceInputs {
  /** 0 night .. 1 day; below civil twilight the light vector is the moon, so the sun fades out. */
  daylight: number;
  /** Elevation of the light vector above the horizon (radians). */
  elevation: number;
  /** 0 clear .. 1 full overcast (rain, or snow at its lighter share). */
  overcast: number;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 0..1 sun presence by daylight (the same gate as the sky shader's former disc). */
export const sunPresence = (daylight: number) => smoothstep(0.02, 0.32, daylight);

/** Air mass of the apparent sun. */
const sunAirMass = (inputs: SunRadianceInputs) => relativeAirMass(apparentSunElevation(inputs.elevation));

/** HDR scale of the sun: presence, overcast dimming and the adaptation to its extinction. */
const sunStrength = (inputs: SunRadianceInputs, airMass: number) => {
  const overcast = Math.min(1, Math.max(0, inputs.overcast));
  const adaptation = Math.exp(SUN_ZENITH_OPTICAL_DEPTH[0] * (airMass - 1) * SUN_ADAPTATION);
  return SUN_DISC_PEAK * sunPresence(inputs.daylight) * (1 - overcast * OVERCAST_DIMMING) * adaptation;
};

/** Writes SUN_SPACE_COLOR x scale x exp(-tau x extraAirMass) per channel into `target`. */
const writeAttenuated = (
  scale: number, extraAirMass: number, target: Float32Array | Float64Array, offset: number
) => {
  for (let channel = 0; channel < 3; channel++) {
    const transmittance = Math.exp(-SUN_ZENITH_OPTICAL_DEPTH[channel]! * extraAirMass);
    target[offset + channel] = SUN_SPACE_COLOR[channel]! * transmittance * scale;
  }
  return target;
};

/**
 * Writes the linear HDR disc-centre radiance into `target` (RGB at `offset`): extinction relative
 * to the zenith, so the overhead sun keeps its space colour and the setting sun turns red.
 */
export const writeSunDiscRadiance = (
  inputs: SunRadianceInputs, target: Float32Array | Float64Array, offset = 0
) => {
  const airMass = sunAirMass(inputs);
  return writeAttenuated(sunStrength(inputs, airMass), airMass - 1, target, offset);
};

/**
 * Writes the aerosol aureole's source radiance (before its phase function) into `target`. Single
 * scattering along the slant path: the scattered share 1 - exp(-tau m) of the beam grows with air
 * mass. Its red follows the disc (the glow never outshines a setting sun); green and blue keep
 * the hue of AUREOLE_PATH_SHARE of the path, so the glow is warmer than a high sun's and less red
 * than the disc. Equal to the disc radiance overhead.
 */
export const writeSunAureoleRadiance = (
  inputs: SunRadianceInputs, target: Float32Array | Float64Array, offset = 0
) => {
  const airMass = sunAirMass(inputs);
  const scattered = (1 - Math.exp(-AEROSOL_ZENITH_DEPTH * airMass)) / (1 - Math.exp(-AEROSOL_ZENITH_DEPTH));
  const redLoss = Math.exp(-SUN_ZENITH_OPTICAL_DEPTH[0] * (airMass - 1) * (1 - AUREOLE_PATH_SHARE));
  return writeAttenuated(
    sunStrength(inputs, airMass) * scattered * redLoss, (airMass - 1) * AUREOLE_PATH_SHARE, target, offset
  );
};

/**
 * Writes the disc's hue (its radiance over the brightest channel, 0..1) into `target`: white at
 * noon, orange at sunset, red for the setting sun. Water glints reuse it so the sun glitter on the
 * sea matches the disc above it.
 */
export const writeSunDiscChroma = (
  elevation: number, target: Float32Array | Float64Array, offset = 0
) => {
  writeAttenuated(1, relativeAirMass(apparentSunElevation(elevation)) - 1, target, offset);
  const peak = Math.max(target[offset]!, target[offset + 1]!, target[offset + 2]!);
  for (let channel = 0; channel < 3; channel++) {
    target[offset + channel] = target[offset + channel]! / peak;
  }
  return target;
};

/** The high full moon's colour: neutral grey-white under the night sky's cool light. */
const MOON_BASE_TINT = [0.8, 0.84, 0.93] as const;
/** Share of the extinction hue the moon shows: night vision mutes colour at moonlight levels. */
const MOON_EXTINCTION_SHARE = 0.5;

/**
 * Writes the moon's display tint for the light-vector elevation into `target`: grey-white high in
 * the sky, yellow to orange near the horizon (true elevation, not the sun's sunset stretch).
 */
export const writeMoonTint = (elevation: number, target: Float32Array | Float64Array, offset = 0) => {
  const extraAirMass = (relativeAirMass(elevation) - 1) * MOON_EXTINCTION_SHARE;
  for (let channel = 0; channel < 3; channel++) {
    const relative = SUN_ZENITH_OPTICAL_DEPTH[channel]! - SUN_ZENITH_OPTICAL_DEPTH[0];
    target[offset + channel] = MOON_BASE_TINT[channel]! * Math.exp(-relative * extraAirMass);
  }
  return target;
};
