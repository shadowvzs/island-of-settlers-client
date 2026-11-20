import { COLOR_AGX_EV, COLOR_GRADE, COLOR_NEUTRAL, COLOR_NEUTRAL_TOE_F0, COLOR_OUTPUT_MODE } from "../color-output";
import { glslLiteral } from "./glsl-literal";

/**
 * GLSL of the unified colour contract (R04, see ../color-output.ts). Raw shaders and the
 * built-in material tail share these exact functions; every name carries a `color` prefix so it
 * never collides with Three's own tonemapping chunk, which built-in programs also contain.
 * GLSL ES 1.00 compatible (Three ShaderMaterial effects include it as well).
 */

const glslPrecise = (value: number) => value.toFixed(4);

/** A 3×3 matrix as its columns, the order `mat3(column0, column1, column2)` reads them. */
export type Columns3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number]
];

/**
 * The four AgX matrices of COLOR_AGX_GLSL as columns: the one source both the forward GLSL and
 * the inverse (R11a) GLSL are generated from, so the two halves of the round trip cannot drift.
 */
export const COLOR_AGX_MATRICES = {
  inset: [
    [0.856627153315983, 0.137318972929847, 0.11189821299995],
    [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
    [0.0482516061458583, 0.101439036467562, 0.811302368396859]
  ],
  outset: [
    [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
    [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
    [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]
  ],
  rec2020ToSrgb: [
    [1.6605, -0.1246, -0.0182],
    [-0.5876, 1.1329, -0.1006],
    [-0.0728, -0.0083, 1.1187]
  ],
  srgbToRec2020: [
    [0.6274, 0.0691, 0.0164],
    [0.3293, 0.9195, 0.0880],
    [0.0433, 0.0113, 0.8956]
  ]
} as const satisfies Readonly<Record<string, Columns3>>;

/**
 * The inverse of a 3×3 matrix given as columns (cofactor expansion). The AgX matrices are well
 * conditioned, so a zero determinant has no fallback.
 */
export const invertColumns3 = (columns: Columns3): Columns3 => {
  const [[a, d, g], [b, e, h], [c, f, i]] = columns;
  const cofactor0 = e * i - f * h;
  const cofactor1 = f * g - d * i;
  const cofactor2 = d * h - e * g;
  const determinant = a * cofactor0 + b * cofactor1 + c * cofactor2;
  return [
    [cofactor0 / determinant, cofactor1 / determinant, cofactor2 / determinant],
    [(c * h - b * i) / determinant, (a * i - c * g) / determinant, (b * g - a * h) / determinant],
    [(b * f - c * e) / determinant, (c * d - a * f) / determinant, (a * e - b * d) / determinant]
  ];
};

/** A Number as a GLSL float literal: always with a decimal point or an exponent. */
const glslFloat = (value: number) => {
  const text = String(value);
  return text.includes(".") || text.includes("e") || text.includes("E") ? text : `${text}.0`;
};

/** The `mat3(...)` constructor of column-major numbers, one column per line. */
export const columns3ToGlsl = (columns: Columns3) =>
  `mat3(\n${columns.map(column => `  vec3(${column.map(glslFloat).join(", ")})`).join(",\n")}\n)`;

/**
 * Raw-shader uniforms. Their unbound value (0) is the safe default: display output, Vivid
 * (Neutral), no Vivid boost and no rain desaturation. `uColorToneMapper` is the Tone weight,
 * 0 Vivid .. 1 Filmic; `uColorVividBoost` is the extra Vivid saturation (QualityPreset);
 * `uColorOutputMode` is COLOR_OUTPUT_MODE. `toneMappingExposure` is uploaded by Three for every
 * program declaring it, so raw and built-in materials share the renderer's exposure.
 */
const COLOR_OUTPUT_UNIFORMS_GLSL = `
uniform float uColorGradeRain;
uniform float uColorOutputMode;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
uniform float toneMappingExposure;
`;

/** Built-in material tail: Three declares `toneMappingExposure` itself in tonemapped programs. */
export const STANDARD_COLOR_UNIFORMS_GLSL = `
uniform float uColorGradeRain;
uniform float uColorOutputMode;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
#ifndef TONE_MAPPING
uniform float toneMappingExposure;
#endif
`;

/** Exact sRGB transfer functions (the same curve as an SRGB8_ALPHA8 target's hardware). */
const COLOR_TRANSFER_GLSL = `
vec3 colorSrgbDecode(vec3 value) {
  vec3 encoded = max(value, vec3(0.0));
  vec3 low = encoded / 12.92;
  vec3 high = pow((encoded + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), encoded));
}

vec3 colorSrgbEncode(vec3 value) {
  vec3 linear = max(value, vec3(0.0));
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linear));
}
`;

/**
 * Khronos PBR Neutral (https://github.com/KhronosGroup/ToneMapping): reference shoulder and
 * desaturation; the toe offset is the reference formula with its F0 parameter (see
 * COLOR_NEUTRAL_TOE_F0 for why it is currently off).
 */
const COLOR_NEUTRAL_GLSL = `
const float COLOR_NEUTRAL_TOE_F0 = ${glslPrecise(COLOR_NEUTRAL_TOE_F0)};

vec3 colorNeutralToneMap(vec3 color) {
  const float startCompression = ${glslLiteral(COLOR_NEUTRAL.startBase)} - ${glslLiteral(COLOR_NEUTRAL.startToe)};
  const float desaturation = ${glslLiteral(COLOR_NEUTRAL.desaturation)};
  if (COLOR_NEUTRAL_TOE_F0 > 0.0) {
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 2.0 * COLOR_NEUTRAL_TOE_F0
      ? x - x * x / (4.0 * COLOR_NEUTRAL_TOE_F0)
      : COLOR_NEUTRAL_TOE_F0;
    color -= offset;
  }
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float shoulder = 1.0 - startCompression;
  float newPeak = 1.0 - shoulder * shoulder / (peak + shoulder - startCompression);
  color *= newPeak / peak;
  float blend = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), blend);
}
`;

/**
 * AgX (Blender/Filament, minimal fit by iolite-engine; the same constants as three r186's
 * AgXToneMapping, MIT) in linear Rec.709 in and out. The matrices come from COLOR_AGX_MATRICES.
 */
const COLOR_AGX_GLSL = `
const mat3 COLOR_AGX_SRGB_TO_REC2020 = ${columns3ToGlsl(COLOR_AGX_MATRICES.srgbToRec2020)};
const mat3 COLOR_AGX_REC2020_TO_SRGB = ${columns3ToGlsl(COLOR_AGX_MATRICES.rec2020ToSrgb)};
const mat3 COLOR_AGX_INSET = ${columns3ToGlsl(COLOR_AGX_MATRICES.inset)};
const mat3 COLOR_AGX_OUTSET = ${columns3ToGlsl(COLOR_AGX_MATRICES.outset)};
const float COLOR_AGX_MIN_EV = ${glslLiteral(COLOR_AGX_EV.min)};
const float COLOR_AGX_MAX_EV = ${glslLiteral(COLOR_AGX_EV.max)};

vec3 colorAgxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2
    + 0.1191 * x - 0.00232;
}

vec3 colorAgxToneMap(vec3 color) {
  color = COLOR_AGX_INSET * (COLOR_AGX_SRGB_TO_REC2020 * color);
  color = log2(max(color, vec3(1e-10)));
  color = clamp((color - COLOR_AGX_MIN_EV) / (COLOR_AGX_MAX_EV - COLOR_AGX_MIN_EV), 0.0, 1.0);
  color = COLOR_AGX_OUTSET * colorAgxContrast(color);
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(COLOR_AGX_REC2020_TO_SRGB * color, 0.0, 1.0);
}
`;

/**
 * Exposure and the Tone weight (uniform branches: no recompile). Only a transition between Vivid
 * and Filmic evaluates both curves; a settled weight keeps the single-curve cost.
 */
const COLOR_TONE_MAP_GLSL = `
${COLOR_NEUTRAL_GLSL}
${COLOR_AGX_GLSL}
vec3 colorToneMap(vec3 radiance) {
  vec3 exposed = max(radiance, vec3(0.0)) * toneMappingExposure;
  float weight = clamp(uColorToneMapper, 0.0, 1.0);
  if (weight < 0.001) return colorNeutralToneMap(exposed);
  if (weight > 0.999) return colorAgxToneMap(exposed);
  return mix(colorNeutralToneMap(exposed), colorAgxToneMap(exposed), weight);
}
`;

/**
 * The art grade (saturation, contrast) in display space, then an 8-bit ordered dither. Vivid's
 * saturation boost fades out with the Tone weight towards Filmic.
 */
const COLOR_GRADE_GLSL = `
float colorGradeSaturation() {
  float vividBoost = 1.0 + uColorVividBoost * (1.0 - clamp(uColorToneMapper, 0.0, 1.0));
  return (${glslPrecise(COLOR_GRADE.saturation)}
    - uColorGradeRain * ${glslPrecise(COLOR_GRADE.rainDesaturation)}) * vividBoost;
}

vec3 colorGrade(vec3 display) {
  float luma = dot(display, vec3(0.299, 0.587, 0.114));
  vec3 saturated = mix(vec3(luma), display, colorGradeSaturation());
  return clamp((saturated - 0.5) * ${glslPrecise(COLOR_GRADE.contrast)} + 0.5, 0.0, 1.0);
}

/** The grade without its clamp, undone (the saturation mix keeps luma). */
vec3 colorGradeInverse(vec3 graded) {
  vec3 saturated = (graded - 0.5) / ${glslPrecise(COLOR_GRADE.contrast)} + 0.5;
  float luma = dot(saturated, vec3(0.299, 0.587, 0.114));
  return luma + (saturated - luma) / max(colorGradeSaturation(), 0.0001);
}

/** Interleaved gradient noise: stable per pixel, hides 8-bit banding in skies, fog and water. */
float colorDitherNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

vec3 colorFinishDisplay(vec3 display) {
  return colorGrade(display) + (colorDitherNoise(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

/** Tonemapper, sRGB transfer and grade: the shared core of both material families. */
export const COLOR_TRANSFORM_GLSL = `
${COLOR_TRANSFER_GLSL}
${COLOR_TONE_MAP_GLSL}
${COLOR_GRADE_GLSL}
`;

/**
 * The inverse tonemapper and the linear scene read (R11a): post passes (R11b bloom, R11c exposure,
 * R12b GTAO) need radiance, not the display pixels the scene target holds. Only the linear output
 * pass includes this text; it needs COLOR_TRANSFORM_GLSL (the AgX matrices, the contrast
 * polynomial, the grade inverse and the transfer functions) and the colour uniforms. The Neutral
 * inverse is exact only while COLOR_NEUTRAL_TOE_F0 is 0: the toe is not a one-to-one map.
 */
export const COLOR_TONE_MAP_INVERSE_GLSL = `
const mat3 COLOR_AGX_SRGB_TO_REC2020_INVERSE =
  ${columns3ToGlsl(invertColumns3(COLOR_AGX_MATRICES.srgbToRec2020))};
const mat3 COLOR_AGX_REC2020_TO_SRGB_INVERSE =
  ${columns3ToGlsl(invertColumns3(COLOR_AGX_MATRICES.rec2020ToSrgb))};
const mat3 COLOR_AGX_INSET_INVERSE = ${columns3ToGlsl(invertColumns3(COLOR_AGX_MATRICES.inset))};
const mat3 COLOR_AGX_OUTSET_INVERSE = ${columns3ToGlsl(invertColumns3(COLOR_AGX_MATRICES.outset))};

/** colorNeutralToneMap undone (toe off): the shoulder's peak and desaturation solved backwards. */
vec3 colorNeutralToneMapInverse(vec3 mapped) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float newPeak = min(max(mapped.r, max(mapped.g, mapped.b)), 0.9999);
  if (newPeak < startCompression) return mapped;
  float shoulder = 1.0 - startCompression;
  float peak = shoulder * shoulder / (1.0 - newPeak) - shoulder + startCompression;
  float blend = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  vec3 scaled = (min(mapped, vec3(newPeak)) - blend * newPeak) / max(1.0 - blend, 1e-4);
  return scaled * peak / newPeak;
}

/**
 * colorAgxContrast undone on [0, 1] by 16 bisection steps: the polynomial is monotonic (minimum
 * slope 0.107) and Newton oscillates on its flat ends. The interval resolves to 1.5e-5. All three
 * channels bisect together (one vec3 polynomial per step instead of three).
 */
vec3 colorAgxContrastInverse(vec3 value) {
  vec3 lower = vec3(0.0);
  vec3 upper = vec3(1.0);
  for (int iteration = 0; iteration < 16; iteration++) {
    vec3 middle = 0.5 * (lower + upper);
    vec3 below = vec3(1.0) - step(value, colorAgxContrast(middle));
    lower = mix(lower, middle, below);
    upper = mix(middle, upper, below);
  }
  return 0.5 * (lower + upper);
}

/** colorAgxToneMap undone: the matrices, the transfer power and the contrast curve inverted. */
vec3 colorAgxToneMapInverse(vec3 mapped) {
  vec3 color = COLOR_AGX_REC2020_TO_SRGB_INVERSE * mapped;
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  color = COLOR_AGX_OUTSET_INVERSE * color;
  color = colorAgxContrastInverse(color);
  color = exp2(color * (COLOR_AGX_MAX_EV - COLOR_AGX_MIN_EV) + COLOR_AGX_MIN_EV);
  color = COLOR_AGX_INSET_INVERSE * color;
  return COLOR_AGX_SRGB_TO_REC2020_INVERSE * color;
}

/** colorToneMap undone on a tonemapped, pre-exposure value; the weight picks the curve as forward. */
vec3 colorToneMapInverse(vec3 mapped) {
  float weight = clamp(uColorToneMapper, 0.0, 1.0);
  vec3 radiance;
  if (weight < 0.001) radiance = colorNeutralToneMapInverse(mapped);
  else if (weight > 0.999) radiance = colorAgxToneMapInverse(mapped);
  else radiance = mix(colorNeutralToneMapInverse(mapped), colorAgxToneMapInverse(mapped), weight);
  return radiance / max(toneMappingExposure, 1e-4);
}

/**
 * Linear radiance (before exposure) of a scene-target pixel: rgba16f holds the tonemapped,
 * sRGB-encoded colour; rgba8 (COLOR_SCENE_GRADED) holds the graded display pixel as well.
 */
vec3 colorSceneToLinear(vec3 scene) {
#ifdef COLOR_SCENE_GRADED
  scene = colorGradeInverse(scene);
#endif
  return colorToneMapInverse(colorSrgbDecode(scene));
}
`;

/**
 * The output modes (needs COLOR_TRANSFORM_GLSL and `uColorOutputMode`). The HDR scene target (R10)
 * holds each fragment's tonemapped, sRGB-encoded colour before the grade: blending and the MSAA
 * resolve then act on the values they acted on in the canvas, and the frame's output pass grades
 * and dithers once. Post passes recover linear radiance with the inverse tonemapper.
 */
export const COLOR_MODE_GLSL = `
bool colorIsSceneTarget() {
  return uColorOutputMode > ${glslPrecise(COLOR_OUTPUT_MODE.scene - 0.5)};
}

bool colorIsLinearCapture() {
  return uColorOutputMode > ${glslPrecise(COLOR_OUTPUT_MODE.linearCapture - 0.5)} && !colorIsSceneTarget();
}

/** A tonemapped display colour: graded and dithered here, or once by the scene target's output pass. */
vec3 colorFinishOutput(vec3 display) {
  return colorIsSceneTarget() ? display : colorFinishDisplay(display);
}

/**
 * A final display colour that bypasses the tonemapper and grade (gameplay feedback colours,
 * baked impostor atlases): as is on the screen, ungraded in the scene target so the output pass
 * restores it.
 */
vec3 colorDisplayOutput(vec3 display) {
  return colorIsSceneTarget() ? colorGradeInverse(display) : display;
}
`;

/**
 * Display-space feedback colours only (health and upgrade bars, hover hulls, silhouettes): the
 * grade and output modes without the tonemapper, for `colorDisplayOutput`. Needs the uniforms of
 * COLOR_DISPLAY_UNIFORM_NAMES; unbound they read 0 (display output).
 */
export const DISPLAY_COLOR_OUTPUT_GLSL = `
uniform float uColorGradeRain;
uniform float uColorOutputMode;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
${COLOR_GRADE_GLSL}
${COLOR_MODE_GLSL}
`;

export const COLOR_DISPLAY_UNIFORM_NAMES = [
  "uColorGradeRain",
  "uColorOutputMode",
  "uColorToneMapper",
  "uColorVividBoost"
] as const;

/**
 * Raw shaders: `colorOutput` turns linear radiance into the final pixel. In linear capture mode
 * (the refraction target, an sRGB texture) it keeps linear radiance, so captured surfaces are
 * graded only once, by the shader that samples them; in the HDR scene target it stops before the
 * grade (COLOR_MODE_GLSL).
 */
export const COLOR_OUTPUT_GLSL = `
${COLOR_OUTPUT_UNIFORMS_GLSL}
${COLOR_TRANSFORM_GLSL}
${COLOR_MODE_GLSL}
vec3 colorOutput(vec3 radiance) {
  if (colorIsLinearCapture()) return max(radiance, vec3(0.0));
  return colorFinishOutput(colorSrgbEncode(colorToneMap(radiance)));
}

/** A display-authored colour (art lighting, effect palettes) through the shared output. */
vec3 colorOutputDisplayAuthored(vec3 color) {
  return colorOutput(colorSrgbDecode(color));
}

/**
 * A premultiplied layer blended in display space: the transform runs on the straight colour,
 * whose coverage is floored by the colour's own brightness so additive light (glints, caustics)
 * is never amplified into the tonemapper's shoulder.
 */
vec3 colorOutputPremultiplied(vec3 color, float alpha) {
  float coverage = max(max(alpha, max(color.r, max(color.g, color.b))), 1.0 / 255.0);
  return colorOutputDisplayAuthored(color / coverage) * coverage;
}
`;

/** Raw shaders with camera air (needs ATMOSPHERE_GLSL and its uniforms before it). */
export const AIR_COLOR_OUTPUT_GLSL = `
${COLOR_OUTPUT_GLSL}
/** Display-authored colour -> linear -> camera air over optical depth tau -> output. */
vec3 finishColor(vec3 color, float tau) {
  return colorOutput(composeAtmosphereLinear(colorSrgbDecode(color), tau));
}

/** finishColor along a known view ray (skies, surfaces): the airlight follows the sun lobe. */
vec3 finishColorToward(vec3 color, float tau, vec3 direction) {
  return colorOutput(composeAtmosphereLinearToward(colorSrgbDecode(color), tau, direction));
}

/** The airlight towards a surface as a final display pixel (layers blended after the output). */
vec3 colorOutputAirlight(vec3 worldPosition, float tau) {
  return colorOutput(atmosphereAirlight(atmosphereViewDirection(worldPosition), tau));
}
`;

/** World surfaces (needs FOG_OF_WAR_GLSL before it): the default raw shader ending. */
export const SURFACE_COLOR_OUTPUT_GLSL = `
${AIR_COLOR_OUTPUT_GLSL}
vec3 finishSurface(vec3 color, vec3 worldPosition) {
  return finishColorToward(color, atmosphereSurfaceTau(worldPosition),
    atmosphereViewDirection(worldPosition));
}
`;
