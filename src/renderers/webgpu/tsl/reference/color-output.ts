import { COLOR_AGX_EV, COLOR_GRADE, COLOR_NEUTRAL, COLOR_NEUTRAL_TOE_F0 } from "../../../../render-common/color-output";
import { LUMA_REC709 } from "../../../../render-common/luma";
import {
  COLOR_AGX_MATRICES,
  type Columns3,
  invertColumns3
} from "../../../../render-common/shaders/color-output-glsl";

/**
 * CPU reference of the shared colour contract for WG-1a's TSL parity tables. This mirrors
 * `render-common/shaders/color-output-glsl.ts`; the TSL module composes the same operations.
 */
export type Rgb = readonly [number, number, number];

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const multiply = (columns: Columns3, value: Rgb): Rgb => [
  columns[0]![0]! * value[0] + columns[1]![0]! * value[1] + columns[2]![0]! * value[2],
  columns[0]![1]! * value[0] + columns[1]![1]! * value[1] + columns[2]![1]! * value[2],
  columns[0]![2]! * value[0] + columns[1]![2]! * value[1] + columns[2]![2]! * value[2]
];

const map = (value: Rgb, operation: (component: number) => number): Rgb => [
  operation(value[0]),
  operation(value[1]),
  operation(value[2])
];

const mapIndexed = (value: Rgb, operation: (component: number, index: number) => number): Rgb => [
  operation(value[0], 0),
  operation(value[1], 1),
  operation(value[2], 2)
];

const mix = (a: Rgb, b: Rgb, weight: number): Rgb => [
  a[0] + (b[0] - a[0]) * weight,
  a[1] + (b[1] - a[1]) * weight,
  a[2] + (b[2] - a[2]) * weight
];

export const srgbDecode = (value: Rgb): Rgb => map(value, component => {
  const encoded = Math.max(component, 0);
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
});

export const srgbEncode = (value: Rgb): Rgb => map(value, component => {
  const linear = Math.max(component, 0);
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
});

export const neutralToneMap = (color: Rgb): Rgb => {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  let result = color;
  if (COLOR_NEUTRAL_TOE_F0 > 0) {
    const x = Math.min(result[0], result[1], result[2]);
    const offset = x < 2 * COLOR_NEUTRAL_TOE_F0
      ? x - x * x / (4 * COLOR_NEUTRAL_TOE_F0)
      : COLOR_NEUTRAL_TOE_F0;
    result = map(result, component => component - offset);
  }
  const peak = Math.max(result[0], result[1], result[2]);
  if (peak < startCompression) return result;
  const shoulder = 1 - startCompression;
  const newPeak = 1 - shoulder * shoulder / (peak + shoulder - startCompression);
  const scaled = map(result, component => component * newPeak / peak);
  const blend = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return mix(scaled, [newPeak, newPeak, newPeak], blend);
};

export const agxContrast = (value: Rgb): Rgb => map(value, x => {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2
    + 0.1191 * x - 0.00232;
});

export const agxToneMap = (color: Rgb): Rgb => {
  let result = multiply(COLOR_AGX_MATRICES.inset,
    multiply(COLOR_AGX_MATRICES.srgbToRec2020, color));
  result = map(result, component => Math.log2(Math.max(component, 1e-10)));
  result = map(result, component => clamp01(
    (component - (-12.47393)) / (4.026069 - (-12.47393))));
  result = multiply(COLOR_AGX_MATRICES.outset, agxContrast(result));
  result = map(result, component => Math.max(component, 0) ** 2.2);
  return map(multiply(COLOR_AGX_MATRICES.rec2020ToSrgb, result), clamp01);
};

export const toneMap = (radiance: Rgb, exposure: number, weight: number): Rgb => {
  const exposed = map(radiance, component => Math.max(component, 0) * exposure);
  const clampedWeight = clamp01(weight);
  if (clampedWeight < 0.001) return neutralToneMap(exposed);
  if (clampedWeight > 0.999) return agxToneMap(exposed);
  return mix(neutralToneMap(exposed), agxToneMap(exposed), clampedWeight);
};

export const gradeSaturation = (rain: number, vividBoost: number, toneWeight: number) =>
  (COLOR_GRADE.saturation - rain * COLOR_GRADE.rainDesaturation) *
  (1 + vividBoost * (1 - clamp01(toneWeight)));

export const grade = (display: Rgb, rain: number, vividBoost: number, toneWeight: number): Rgb => {
  const luma = 0.299 * display[0] + 0.587 * display[1] + 0.114 * display[2];
  const saturation = gradeSaturation(rain, vividBoost, toneWeight);
  return map(mix([luma, luma, luma], display, saturation),
    component => clamp01((component - 0.5) * COLOR_GRADE.contrast + 0.5));
};

export const ditherNoise = (x: number, y: number) => {
  const value = 52.9829189 * ((x * 0.06711056 + y * 0.00583715) % 1);
  return value - Math.floor(value);
};

export const finishDisplay = (display: Rgb, x: number, y: number,
  rain: number, vividBoost: number, toneWeight: number): Rgb =>
  map(grade(display, rain, vividBoost, toneWeight), component =>
    component + (ditherNoise(x, y) - 0.5) / 255);

/** `grade` undone (the R11a post inverse); display pixels, not linear. */
export const gradeInverse = (display: Rgb, rain: number, vividBoost: number, toneWeight: number): Rgb => {
  const saturated = map(display, component => (component - 0.5) / COLOR_GRADE.contrast + 0.5);
  const luma = LUMA_REC709[0] * saturated[0] + LUMA_REC709[1] * saturated[1]
    + LUMA_REC709[2] * saturated[2];
  const saturation = Math.max(gradeSaturation(rain, vividBoost, toneWeight), 0.0001);
  return map(saturated, component => luma + (component - luma) / saturation);
};

/** `neutralToneMap` undone (toe off); the twin of the GLSL inverse. */
export const neutralToneMapInverse = (mapped: Rgb): Rgb => {
  const startCompression = COLOR_NEUTRAL.startCompression;
  const desaturation = COLOR_NEUTRAL.desaturation;
  const newPeak = Math.min(Math.max(mapped[0], mapped[1], mapped[2]), 0.9999);
  if (newPeak < startCompression) return mapped;
  const shoulder = 1 - startCompression;
  const peak = shoulder * shoulder / (1 - newPeak) - shoulder + startCompression;
  const blend = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return map(mapped, component =>
    (Math.min(component, newPeak) - blend * newPeak) / Math.max(1 - blend, 1e-4) * peak / newPeak);
};

/** `agxContrast` undone on [0, 1] by 16 bisection steps. */
export const agxContrastInverse = (value: Rgb): Rgb => {
  let lower: Rgb = [0, 0, 0];
  let upper: Rgb = [1, 1, 1];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const middle = mapIndexed(lower, (component, index) => (component + upper[index]!) * 0.5);
    const below = mapIndexed(agxContrast(middle), (component, index) => (component < value[index]! ? 1 : 0));
    lower = mapIndexed(lower, (component, index) => component + (middle[index]! - component) * below[index]!);
    upper = mapIndexed(middle, (component, index) => component + (upper[index]! - component) * below[index]!);
  }
  return mapIndexed(lower, (component, index) => (component + upper[index]!) * 0.5);
};

const AGX_REC2020_TO_SRGB_INVERSE = invertColumns3(COLOR_AGX_MATRICES.rec2020ToSrgb);
const AGX_INSET_INVERSE = invertColumns3(COLOR_AGX_MATRICES.inset);
const AGX_OUTSET_INVERSE = invertColumns3(COLOR_AGX_MATRICES.outset);
const AGX_SRGB_TO_REC2020_INVERSE = invertColumns3(COLOR_AGX_MATRICES.srgbToRec2020);

/** `agxToneMap` undone: the matrices, the transfer power and the contrast curve inverted. */
export const agxToneMapInverse = (mapped: Rgb): Rgb => {
  let result = multiply(AGX_REC2020_TO_SRGB_INVERSE, mapped);
  result = map(result, component => Math.max(component, 0) ** (1 / 2.2));
  result = multiply(AGX_OUTSET_INVERSE, result);
  result = agxContrastInverse(result);
  result = map(result, component =>
    Math.pow(2, component * (COLOR_AGX_EV.max - COLOR_AGX_EV.min) + COLOR_AGX_EV.min));
  result = multiply(AGX_INSET_INVERSE, result);
  return multiply(AGX_SRGB_TO_REC2020_INVERSE, result);
};

/** `toneMap` undone on a tonemapped, pre-exposure value; the weight picks the curve as forward. */
export const toneMapInverse = (mapped: Rgb, exposure: number, weight: number): Rgb => {
  const clampedWeight = clamp01(weight);
  let radiance: Rgb;
  if (clampedWeight < 0.001) radiance = neutralToneMapInverse(mapped);
  else if (clampedWeight > 0.999) radiance = agxToneMapInverse(mapped);
  else radiance = mix(neutralToneMapInverse(mapped), agxToneMapInverse(mapped), clampedWeight);
  return map(radiance, component => component / Math.max(exposure, 1e-4));
};

/** A scene-target pixel (decoded graded display) as the linear radiance before exposure. */
export const sceneToRadiance = (scene: Rgb, exposure: number, weight: number,
  rain: number, vividBoost: number): Rgb =>
  toneMapInverse(srgbDecode(gradeInverse(srgbEncode(scene), rain, vividBoost, weight)), exposure, weight);

/** Linear radiance to the final encoded display pixel (tone map, grade and dither once). */
export const radianceToDisplay = (radiance: Rgb, x: number, y: number, exposure: number,
  weight: number, rain: number, vividBoost: number): Rgb =>
  finishDisplay(srgbEncode(toneMap(radiance, exposure, weight)), x, y, rain, vividBoost, weight);
