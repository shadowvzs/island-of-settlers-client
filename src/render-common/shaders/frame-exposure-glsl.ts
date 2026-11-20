import { LUMA_REC709 } from "../luma";
import { COLOR_TONE_MAP_INVERSE_GLSL, COLOR_TRANSFORM_GLSL } from "./color-output-glsl";

/**
 * GLSL of the R11c possessed auto-exposure (renderers/three/frame-exposure.ts), GLSL ES 3.00, one
 * fullscreen triangle per pass. The luminance pass measures the resolved scene on a small grid, two
 * block passes reduce it to one texel (exact averages, no mipmap generation), and the adaptation
 * pass eases the stored exposure towards the clamped target (eye-adaptation.ts holds its TS twin).
 * The scene is measured before any exposure is applied, so the loop is open: no feedback pumping.
 */

/** Luminance grid of the first pass (16:9, about 30 × 30 pixels per texel at 1080p). */
export const EXPOSURE_GRID = { height: 36, width: 64 } as const;

/** Stratified taps per grid texel and axis (4 × 4 = 16 fetches per texel). */
export const EXPOSURE_TAPS_PER_AXIS = 4;

/** Block of the first reduction: 64 × 36 → 8 × 6; the second reduces 8 × 6 → 1 × 1. */
export const EXPOSURE_REDUCE_BLOCK = { height: 6, width: 8 } as const;

/** Darkest linear luminance the log average counts (black pixels would pull it to -infinity). */
export const EXPOSURE_MIN_LUMINANCE = 1e-4;

/** Mean log2 linear luminance of the scene under each grid texel, from 4 × 4 stratified taps. */
export const EXPOSURE_LUMINANCE_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
uniform float uColorGradeRain;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
uniform float toneMappingExposure;
out vec4 fragColor;
${COLOR_TRANSFORM_GLSL}
${COLOR_TONE_MAP_INVERSE_GLSL}
const vec2 EXPOSURE_GRID = vec2(${EXPOSURE_GRID.width}.0, ${EXPOSURE_GRID.height}.0);
const int EXPOSURE_TAPS = ${EXPOSURE_TAPS_PER_AXIS};
const float EXPOSURE_MIN_LUMINANCE = ${EXPOSURE_MIN_LUMINANCE.toExponential()};
const vec3 EXPOSURE_LUMA = vec3(${LUMA_REC709.map(value => value.toFixed(4)).join(", ")});

void main() {
  vec2 sceneSize = vec2(textureSize(uScene, 0));
  vec2 cell = sceneSize / EXPOSURE_GRID;
  vec2 origin = floor(gl_FragCoord.xy) * cell;
  vec2 tapStep = cell / float(EXPOSURE_TAPS);
  float sum = 0.0;
  for (int y = 0; y < EXPOSURE_TAPS; y++) {
    for (int x = 0; x < EXPOSURE_TAPS; x++) {
      vec2 at = min(origin + (vec2(x, y) + 0.5) * tapStep, sceneSize - 1.0);
      vec3 linear = colorSceneToLinear(texelFetch(uScene, ivec2(at), 0).rgb);
      sum += log2(max(dot(linear, EXPOSURE_LUMA), EXPOSURE_MIN_LUMINANCE));
    }
  }
  fragColor = vec4(sum / float(EXPOSURE_TAPS * EXPOSURE_TAPS), 0.0, 0.0, 1.0);
}`;

/** The plain average of the `uBlock` texels of the source under this texel (red channel). */
export const EXPOSURE_REDUCE_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uSource;
uniform ivec2 uBlock;
out vec4 fragColor;

void main() {
  ivec2 size = textureSize(uSource, 0);
  ivec2 origin = ivec2(gl_FragCoord.xy) * uBlock;
  float sum = 0.0;
  float count = 0.0;
  for (int y = 0; y < uBlock.y; y++) {
    for (int x = 0; x < uBlock.x; x++) {
      ivec2 pixel = origin + ivec2(x, y);
      if (pixel.x >= size.x || pixel.y >= size.y) continue;
      sum += texelFetch(uSource, pixel, 0).r;
      count += 1.0;
    }
  }
  fragColor = vec4(sum / max(count, 1.0), 0.0, 0.0, 1.0);
}`;

/**
 * One adaptation step into a 1 × 1 target (eye-adaptation.ts `exposureTarget` + `adaptExposure`).
 * uExposureTarget: x min EV, y max EV, z key log2. uExposureCompensation: x the brightening and y the
 * darkening share. uExposureRates: x the rising and y the falling share of this frame,
 * 1 − exp(−dt / seconds), both 1 on the first possessed frame.
 */
export const EXPOSURE_ADAPT_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uMean;
uniform sampler2D uPrevious;
uniform vec3 uExposureTarget;
uniform vec2 uExposureCompensation;
uniform vec2 uExposureRates;
out vec4 fragColor;

void main() {
  float meanLog2 = texelFetch(uMean, ivec2(0), 0).r;
  if (isnan(meanLog2) || isinf(meanLog2)) meanLog2 = uExposureTarget.z;
  float difference = uExposureTarget.z - meanLog2;
  float compensation = difference > 0.0 ? uExposureCompensation.x : uExposureCompensation.y;
  float target = clamp(difference * compensation, uExposureTarget.x, uExposureTarget.y);
  float previous = texelFetch(uPrevious, ivec2(0), 0).r;
  if (isnan(previous) || isinf(previous)) previous = target;
  float rate = target > previous ? uExposureRates.x : uExposureRates.y;
  fragColor = vec4(mix(previous, target, rate), 0.0, 0.0, 1.0);
}`;
