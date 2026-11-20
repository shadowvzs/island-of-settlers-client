import { dot, float, Fn, mat3, mix, step, vec2, vec3 } from "three/tsl";

import { COLOR_AGX_EV, COLOR_GRADE, COLOR_NEUTRAL, COLOR_NEUTRAL_TOE_F0 } from "../../../render-common/color-output";
import { LUMA_REC709 } from "../../../render-common/luma";
import {
  COLOR_AGX_MATRICES,
  type Columns3,
  invertColumns3
} from "../../../render-common/shaders/color-output-glsl";

/**
 * TSL twin of `render-common/shaders/color-output-glsl.ts` (R04). The formula/constants are
 * shared with the GLSL and the CPU reference; the material port passes the uniforms explicitly.
 */
type TslNode = any; // TSL's generated types do not model the proxied node methods.

const matrix = (columns: Columns3) => mat3(
  vec3(...columns[0]),
  vec3(...columns[1]),
  vec3(...columns[2])
);

const AGX_SRGB_TO_REC2020 = matrix(COLOR_AGX_MATRICES.srgbToRec2020);
const AGX_REC2020_TO_SRGB = matrix(COLOR_AGX_MATRICES.rec2020ToSrgb);
const AGX_INSET = matrix(COLOR_AGX_MATRICES.inset);
const AGX_OUTSET = matrix(COLOR_AGX_MATRICES.outset);
const AGX_SRGB_TO_REC2020_INVERSE = matrix(invertColumns3(COLOR_AGX_MATRICES.srgbToRec2020));
const AGX_REC2020_TO_SRGB_INVERSE = matrix(invertColumns3(COLOR_AGX_MATRICES.rec2020ToSrgb));
const AGX_INSET_INVERSE = matrix(invertColumns3(COLOR_AGX_MATRICES.inset));
const AGX_OUTSET_INVERSE = matrix(invertColumns3(COLOR_AGX_MATRICES.outset));
const LUMA = vec3(...LUMA_REC709);
const AGX_MIN_EV = float(COLOR_AGX_EV.min);
const AGX_MAX_EV = float(COLOR_AGX_EV.max);
const NEUTRAL_START_COMPRESSION = COLOR_NEUTRAL.startCompression;
const NEUTRAL_DESATURATION = COLOR_NEUTRAL.desaturation;

const agxContrast = Fn(([value]: [TslNode]) => {
  const x2 = value.mul(value);
  const x4 = x2.mul(x2);
  return x4.mul(x2).mul(15.5)
    .sub(x4.mul(value).mul(40.14))
    .add(x4.mul(31.96))
    .sub(x2.mul(value).mul(6.868))
    .add(x2.mul(0.4298))
    .add(value.mul(0.1191))
    .sub(0.00232);
});

export const colorAgxToneMap = Fn(([color]: [TslNode]) => {
  const rec2020 = AGX_SRGB_TO_REC2020.mul(color) as TslNode;
  const result = (AGX_INSET.mul(rec2020) as TslNode).toVar();
  result.assign(result.max(vec3(1e-10)).log2());
  result.assign(result.sub(AGX_MIN_EV).div(AGX_MAX_EV.sub(AGX_MIN_EV)).clamp(0, 1));
  result.assign(AGX_OUTSET.mul(agxContrast(result)) as TslNode);
  result.assign(result.max(vec3(0)).pow(vec3(2.2)));
  return (AGX_REC2020_TO_SRGB.mul(result) as TslNode).clamp(0, 1);
});

export const colorNeutralToneMap = Fn(([color]: [TslNode]) => {
  const result = color.toVar();
  if (COLOR_NEUTRAL_TOE_F0 > 0) {
    const x = result.r.min(result.g).min(result.b);
    const offset = x.lessThan(2 * COLOR_NEUTRAL_TOE_F0)
      .select(x.sub(x.mul(x).div(4 * COLOR_NEUTRAL_TOE_F0)), float(COLOR_NEUTRAL_TOE_F0));
    result.assign(result.sub(offset));
  }
  const peak = result.r.max(result.g).max(result.b);
  const shoulder = float(1 - NEUTRAL_START_COMPRESSION);
  const newPeak = float(1).sub(shoulder.mul(shoulder).div(
    peak.add(shoulder).sub(NEUTRAL_START_COMPRESSION)));
  const scaled = result.mul(newPeak).div(peak);
  const blend = float(1).sub(float(1).div(
    float(NEUTRAL_DESATURATION).mul(peak.sub(newPeak)).add(1)));
  // GLSL `if (peak < startCompression) return color;`: only the shoulder is compressed.
  return peak.lessThan(NEUTRAL_START_COMPRESSION).select(result, mix(scaled, vec3(newPeak), blend));
});

/** `weight` is `uColorToneMapper`: 0 Vivid/Neutral, 1 Filmic/AgX. */
export const colorToneMap = Fn(([radiance, exposure, weight]: [TslNode, TslNode, TslNode]) => {
  const exposed = radiance.max(vec3(0)).mul(exposure);
  return mix(colorNeutralToneMap(exposed), colorAgxToneMap(exposed), weight.clamp(0, 1));
});

/** `colorNeutralToneMap` undone (toe off); the twin of the GLSL inverse (R11a). */
export const colorNeutralToneMapInverse = Fn(([mapped]: [TslNode]) => {
  const startCompression = float(COLOR_NEUTRAL.startCompression);
  const desaturation = float(COLOR_NEUTRAL.desaturation);
  const newPeak = mapped.r.max(mapped.g).max(mapped.b).min(0.9999);
  const shoulder = float(1).sub(startCompression);
  const peak = shoulder.mul(shoulder).div(float(1).sub(newPeak)).sub(shoulder).add(startCompression);
  const blend = float(1).sub(float(1).div(desaturation.mul(peak.sub(newPeak)).add(1)));
  const scaled = mapped.min(vec3(newPeak)).sub(blend.mul(newPeak))
    .div(float(1).sub(blend).max(1e-4));
  const compressed = scaled.mul(peak).div(newPeak);
  return newPeak.lessThan(startCompression).select(mapped, compressed);
});

/** `colorAgxContrast` undone on [0, 1] by 16 bisection steps (the GLSL twin). */
export const colorAgxContrastInverse = Fn(([value]: [TslNode]) => {
  const lower = vec3(0).toVar();
  const upper = vec3(1).toVar();
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const middle = lower.add(upper).mul(0.5).toVar();
    const below = float(1).sub(step(value, agxContrast(middle))).toVar();
    lower.assign(mix(lower, middle, below));
    upper.assign(mix(middle, upper, below));
  }
  return lower.add(upper).mul(0.5);
});

/** `colorAgxToneMap` undone: the matrices, the transfer power and the contrast curve inverted. */
export const colorAgxToneMapInverse = Fn(([mapped]: [TslNode]) => {
  const first = AGX_REC2020_TO_SRGB_INVERSE.mul(mapped) as TslNode;
  const transferred = first.max(vec3(0)).pow(vec3(1 / 2.2)) as TslNode;
  const outset = AGX_OUTSET_INVERSE.mul(transferred) as TslNode;
  const contrast = colorAgxContrastInverse(outset) as TslNode;
  const ev = contrast.mul(COLOR_AGX_EV.max - COLOR_AGX_EV.min).add(COLOR_AGX_EV.min).exp2() as TslNode;
  const inset = AGX_INSET_INVERSE.mul(ev) as TslNode;
  return AGX_SRGB_TO_REC2020_INVERSE.mul(inset) as TslNode;
});

/** `colorToneMap` undone on a tonemapped, pre-exposure value; the weight picks the curve as forward. */
export const colorToneMapInverse = Fn(([mapped, exposure, weight]: [TslNode, TslNode, TslNode]) => {
  const toneWeight = weight.clamp(0, 1);
  // `select` rather than an `If` chain: the mixed branch's two inverse Fns are branch-local nodes
  // and the statement stack emitted them uninitialised (0.0001) in the mixed-weight parity case.
  const neutral = colorNeutralToneMapInverse(mapped).toVar();
  const agx = colorAgxToneMapInverse(mapped).toVar();
  // Explicit lerp: `mix` of two branch-built Fn nodes returned the neutral node's floor in the
  // mixed-weight parity case (the statement stack shares the Fn's local variable).
  const mixed = neutral.mul(float(1).sub(toneWeight)).add(agx.mul(toneWeight));
  const radiance = toneWeight.lessThan(0.001).select(neutral,
    toneWeight.greaterThan(0.999).select(agx, mixed));
  return radiance.div(exposure.max(1e-4));
});

export const colorSrgbDecode = Fn(([value]: [TslNode]) => {
  const encoded = value.max(vec3(0));
  const low = encoded.div(12.92);
  const high = encoded.add(0.055).div(1.055).pow(vec3(2.4));
  return mix(low, high, step(0.04045, encoded));
});

export const colorSrgbEncode = Fn(([value]: [TslNode]) => {
  const linear = value.max(vec3(0));
  const low = linear.mul(12.92);
  const high = linear.pow(vec3(1 / 2.4)).mul(1.055).sub(0.055);
  return mix(low, high, step(0.0031308, linear));
});

export const colorGradeSaturation = Fn(([rain, vividBoost, toneWeight]: [TslNode, TslNode, TslNode]) =>
  float(COLOR_GRADE.saturation)
    .sub(rain.mul(COLOR_GRADE.rainDesaturation))
    .mul(vividBoost.mul(float(1).sub(toneWeight.clamp(0, 1))).add(1)));

export const colorGrade = Fn(([display, rain, vividBoost, toneWeight]: [TslNode, TslNode, TslNode, TslNode]) => {
  const luma = dot(display, vec3(0.299, 0.587, 0.114));
  const saturation = colorGradeSaturation(rain, vividBoost, toneWeight);
  return mix(vec3(luma), display, saturation)
    .sub(0.5).mul(COLOR_GRADE.contrast).add(0.5).clamp(0, 1);
});

/** `colorGrade` undone: display pixels back to the ungraded display the tonemapper produced. */
export const colorGradeInverse = Fn(([display, rain, vivid, toneWeight]: [TslNode, TslNode, TslNode, TslNode]) => {
  const saturated = display.sub(0.5).div(COLOR_GRADE.contrast).add(0.5);
  const luma = dot(saturated, LUMA);
  const saturation = colorGradeSaturation(rain, vivid, toneWeight);
  return vec3(luma).add(saturated.sub(vec3(luma)).div(saturation.max(0.0001)));
});

/** The post chain's scene pixels are decoded display: encode, undo the grade, invert the tonemap. */
export const colorSceneToRadiance = Fn(
  ([scene, exposure, weight, rain, vivid]: [TslNode, TslNode, TslNode, TslNode, TslNode]) => {
    const display = colorSrgbEncode(scene);
    const ungraded = colorGradeInverse(display, rain, vivid, weight);
    return colorToneMapInverse(colorSrgbDecode(ungraded), exposure, weight);
  });

export const colorDitherNoise = Fn(([pixel]: [TslNode]) => {
  const dotValue = dot(pixel, vec2(0.06711056, 0.00583715));
  return dotValue.fract().mul(52.9829189).fract();
});

/** Display-space finish: grade then the 8-bit ordered dither. */
export const colorFinishDisplay = Fn(([display, pixel, rain, vividBoost, toneWeight]: [TslNode, TslNode, TslNode, TslNode, TslNode]) =>
  colorGrade(display, rain, vividBoost, toneWeight)
    .add(colorDitherNoise(pixel).sub(0.5).div(255)));

/** Linear radiance to the final encoded display pixel (tone map, grade and dither once). */
export const colorRadianceToDisplay = Fn(
  ([radiance, pixel, exposure, weight, rain, vivid]: [TslNode, TslNode, TslNode, TslNode, TslNode, TslNode]) =>
    colorFinishDisplay(colorSrgbEncode(colorToneMap(radiance, exposure, weight)), pixel,
      rain, vivid, weight));
