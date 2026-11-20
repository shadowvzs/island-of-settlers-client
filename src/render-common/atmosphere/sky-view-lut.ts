import { SKY_MODEL_GLSL, type SkyModelInputs, writeSkyModelRadiance } from "./sky-model";

/**
 * Sky-view LUT (R06b): the sky model tabulated over (azimuth relative to the sun, elevation), the
 * single source of the sky's radiance. The CPU fills it when the light changes; the SH9 sky light,
 * the water reflection and the sky environment map sample it on the CPU, and on Medium+ the
 * possessed and perspective skies sample the same data as a small texture (Minimal evaluates the
 * analytic model instead: no texture, no upload). The model is symmetric about the sun's
 * azimuth, so columns cover 0..π. Rows are dense at the horizon: below it a short linear band,
 * above it a square-root mapping of the elevation. Worker-safe, allocation-free per fill.
 */
export const SKY_VIEW_LUT_WIDTH = 32;
export const SKY_VIEW_LUT_HEIGHT = 64;
/** Share of the rows below the horizon, and the depth (radians) they cover. */
export const SKY_VIEW_LUT = {
  belowHorizon: 0.08,
  halfPi: Math.PI / 2,
  horizonV: 0.125
} as const;
const { belowHorizon: BELOW_HORIZON, halfPi: HALF_PI, horizonV: HORIZON_V } = SKY_VIEW_LUT;

/** Row coordinate (0..1) of an elevation in radians. */
export const skyViewV = (elevation: number) => {
  if (elevation >= 0) return HORIZON_V + (1 - HORIZON_V) * Math.sqrt(Math.min(elevation, HALF_PI) / HALF_PI);
  return HORIZON_V * (1 - Math.min(-elevation, BELOW_HORIZON) / BELOW_HORIZON);
};

/** Elevation in radians of a row coordinate (inverse of skyViewV). */
export const skyViewElevation = (v: number) => {
  if (v >= HORIZON_V) return HALF_PI * ((v - HORIZON_V) / (1 - HORIZON_V)) ** 2;
  return -BELOW_HORIZON * (1 - v / HORIZON_V);
};

export const createSkyViewLut = () => new Float32Array(SKY_VIEW_LUT_WIDTH * SKY_VIEW_LUT_HEIGHT * 4);

/** Unit horizontal sun direction (x, z), +x when the light stands at the zenith. */
const sunAzimuthScratch = new Float64Array(2);
const sunAzimuth = (inputs: SkyModelInputs) => {
  const length = Math.hypot(inputs.sun[0]!, inputs.sun[2]!);
  sunAzimuthScratch[0] = length < 1e-4 ? 1 : inputs.sun[0]! / length;
  sunAzimuthScratch[1] = length < 1e-4 ? 0 : inputs.sun[2]! / length;
  return sunAzimuthScratch;
};

/** Fills `lut` (RGBA, rows bottom-up) from the sky model. */
export const fillSkyViewLut = (lut: Float32Array, inputs: SkyModelInputs) => {
  const sun = sunAzimuth(inputs), sunX = sun[0]!, sunZ = sun[1]!;
  for (let row = 0; row < SKY_VIEW_LUT_HEIGHT; row++) {
    const elevation = skyViewElevation((row + 0.5) / SKY_VIEW_LUT_HEIGHT);
    const y = Math.sin(elevation), ring = Math.cos(elevation);
    for (let column = 0; column < SKY_VIEW_LUT_WIDTH; column++) {
      const azimuth = ((column + 0.5) / SKY_VIEW_LUT_WIDTH) * Math.PI;
      const along = Math.cos(azimuth) * ring, across = Math.sin(azimuth) * ring;
      const offset = (row * SKY_VIEW_LUT_WIDTH + column) * 4;
      writeSkyModelRadiance(inputs, sunX * along - sunZ * across, y, sunZ * along + sunX * across, lut, offset);
      lut[offset + 3] = 1;
    }
  }
};

const texel = (coordinate: number, size: number) => Math.min(size - 1, Math.max(0, coordinate * size - 0.5));

/** Bilinear LUT radiance toward (x, y, z) into `target` (RGB), as the GPU's linear filter reads it. */
export const sampleSkyViewLut = (
  lut: Float32Array, inputs: SkyModelInputs, x: number, y: number, z: number, target: Float64Array
) => {
  const sun = sunAzimuth(inputs), sunX = sun[0]!, sunZ = sun[1]!;
  const horizontal = Math.hypot(x, z);
  const cosAzimuth = horizontal > 1e-4 ? (x * sunX + z * sunZ) / horizontal : 1;
  const u = Math.acos(Math.min(1, Math.max(-1, cosAzimuth))) / Math.PI;
  const v = skyViewV(Math.asin(Math.min(1, Math.max(-1, y))));
  const fu = texel(u, SKY_VIEW_LUT_WIDTH), fv = texel(v, SKY_VIEW_LUT_HEIGHT);
  const u0 = Math.floor(fu), v0 = Math.floor(fv);
  const u1 = Math.min(u0 + 1, SKY_VIEW_LUT_WIDTH - 1), v1 = Math.min(v0 + 1, SKY_VIEW_LUT_HEIGHT - 1);
  const du = fu - u0, dv = fv - v0;
  const lowLeft = (v0 * SKY_VIEW_LUT_WIDTH + u0) * 4, lowRight = (v0 * SKY_VIEW_LUT_WIDTH + u1) * 4;
  const highLeft = (v1 * SKY_VIEW_LUT_WIDTH + u0) * 4, highRight = (v1 * SKY_VIEW_LUT_WIDTH + u1) * 4;
  for (let channel = 0; channel < 3; channel++) {
    const low = lut[lowLeft + channel]!, high = lut[highLeft + channel]!;
    const bottom = low + (lut[lowRight + channel]! - low) * du;
    const top = high + (lut[highRight + channel]! - high) * du;
    target[channel] = bottom + (top - bottom) * dv;
  }
};

/** GLSL twin of sampleSkyViewLut (Medium+ skies, SKY_VIEW_LUT defined). */
export const SKY_VIEW_LUT_GLSL = `
uniform sampler2D uSkyViewLut;

vec3 skyViewLutRadiance(vec3 direction, vec3 lightDirection) {
  float elevation = asin(clamp(direction.y, -1.0, 1.0));
  float v = elevation >= 0.0
    ? ${HORIZON_V.toFixed(4)} + ${(1 - HORIZON_V).toFixed(4)} * sqrt(min(elevation, ${HALF_PI.toFixed(6)})
      / ${HALF_PI.toFixed(6)})
    : ${HORIZON_V.toFixed(4)} * (1.0 - min(-elevation, ${BELOW_HORIZON.toFixed(4)}) / ${BELOW_HORIZON.toFixed(4)});
  float sunLength = length(lightDirection.xz);
  vec2 sunAzimuth = sunLength > 1e-4 ? lightDirection.xz / sunLength : vec2(1.0, 0.0);
  float horizontal = length(direction.xz);
  float cosAzimuth = horizontal > 1e-4 ? dot(direction.xz, sunAzimuth) / horizontal : 1.0;
  float u = acos(clamp(cosAzimuth, -1.0, 1.0)) * ${(1 / Math.PI).toFixed(6)};
  return texture(uSkyViewLut, vec2(u, v)).rgb;
}
`;

/**
 * `skyRadiance(direction, light, daylight)`: the sky-view LUT where SKY_VIEW_LUT is defined
 * (Medium+), otherwise the analytic model (Minimal's cheap path: no texture fetch or upload).
 * Needs uAmbientSky, uFogColor and uSunColor.
 */
export const SKY_RADIANCE_GLSL = `
${SKY_MODEL_GLSL}
#ifdef SKY_VIEW_LUT
${SKY_VIEW_LUT_GLSL}
vec3 skyRadiance(vec3 direction, vec3 lightDirection, float daylight) {
  return skyViewLutRadiance(direction, lightDirection);
}
#else
vec3 skyRadiance(vec3 direction, vec3 lightDirection, float daylight) {
  return skyModelRadiance(direction, lightDirection, daylight);
}
#endif

/** The sky behind the world: the shared radiance, fading below the horizon into the backdrop. */
vec3 skyBackdrop(vec3 direction, vec3 lightDirection, float daylight, vec3 background) {
  float upward = smoothstep(-0.08, 0.025, direction.y);
  vec3 belowHorizon = mix(background, uFogColor * 0.28, 0.3);
  return mix(belowHorizon, skyRadiance(direction, lightDirection, daylight), upward);
}
`;

/** Material defines of a sky shader: the LUT path when the shared uniforms carry the texture. */
export const skyRadianceDefines = (uniforms: Record<string, { value: unknown }>) =>
  uniforms.uSkyViewLut?.value ? { SKY_VIEW_LUT: "" } : {};
