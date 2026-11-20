import {
  MICRO_DETAIL_COLUMNS,
  MICRO_DETAIL_INNER,
  MICRO_DETAIL_PAD,
  MICRO_DETAIL_ROWS,
  MICRO_DETAIL_UNITS
} from "../materials/micro-detail";
import { glslLiteral } from "./glsl-literal";
import { GROUND_CONTEXT_TUNING, MEADOW_DRY_GLSL } from "./ground-palette-glsl";
import { SEASON_MEADOW_GLSL } from "./season-ground-glsl";

/** World units covered by one texture repeat, per material (grass ... gravel, mine). */
export const MATERIAL_TILE_UNITS = [8, 8, 6, 7, 8, 9, 12, 7, 6];

/**
 * The ground texture arrays (albedo + height, normal + AO + roughness; one layer per material,
 * hardware repeat and per-layer mips) and the layer lookup; the full and the lite ground share it.
 */
export const GROUND_LAYERS_GLSL = `
precision mediump sampler2DArray;
uniform sampler2DArray uGroundAlbedo;
uniform sampler2DArray uGroundNormal;

const mat2 DETAIL_ROTATION = mat2(0.8, 0.6, -0.6, 0.8);

/** Array coordinate of a repeating tile uv in a layer (fract keeps far tiles' uv precise). */
vec3 groundLayerUv(float layer, vec2 uv) {
  return vec3(fract(uv), layer);
}

/** Two-offset anti-tiling (after Quilez, "texture repetition", technique 3); 0.0 = off. */
const float UNTILE_ENABLED = 1.0;
const float UNTILE_INDEX_SCALE = 8.0;
const float UNTILE_BLEND_START = 0.65;
const float UNTILE_BLEND_END = 0.85;

/** Two neighbouring tile transforms (offset in tiles, quarter turns 0..3) and their blend. */
struct UntileFrame {
  vec2 offsetA;
  vec2 offsetB;
  float turnA;
  float turnB;
  float blend;
};

vec2 getUntileOffset(float index) {
  return fract(sin(vec2(3.0, 7.0) * index) * 43758.5453) * UNTILE_ENABLED;
}

float getUntileTurn(float index) {
  return floor(fract(sin(index * 12.9898 + 4.1) * 43758.5453) * 4.0) * UNTILE_ENABLED;
}

UntileFrame getUntileFrame(float noise) {
  float index = noise * UNTILE_INDEX_SCALE;
  float first = floor(index);
  float blend = smoothstep(UNTILE_BLEND_START, UNTILE_BLEND_END, index - first) * UNTILE_ENABLED;
  return UntileFrame(getUntileOffset(first), getUntileOffset(first + 1.0),
    getUntileTurn(first), getUntileTurn(first + 1.0), blend);
}

/** A 2D vector turned by whole quarter turns (0..3). */
vec2 turnQuarter(vec2 value, float turns) {
  if (turns < 0.5) return value;
  if (turns < 1.5) return vec2(-value.y, value.x);
  if (turns < 2.5) return -value;
  return vec2(value.y, -value.x);
}

vec4 sampleLayerTransformed(
  sampler2DArray layers, float layer, vec2 uv, vec2 dx, vec2 dy, vec2 offset, float turns
) {
  return textureGrad(layers, groundLayerUv(layer, turnQuarter(uv, turns) + offset),
    turnQuarter(dx, turns), turnQuarter(dy, turns));
}

/** Albedo + height without visible repetition; allowTurn 0.0 keeps the tile orientation. */
vec4 sampleAlbedoUntiled(float layer, vec2 uv, vec2 dx, vec2 dy, UntileFrame frame, float allowTurn) {
  if (frame.blend >= 1.0)
    return sampleLayerTransformed(uGroundAlbedo, layer, uv, dx, dy, frame.offsetB,
      frame.turnB * allowTurn);
  vec4 first = sampleLayerTransformed(uGroundAlbedo, layer, uv, dx, dy, frame.offsetA,
    frame.turnA * allowTurn);
  if (frame.blend <= 0.0) return first;
  vec4 second = sampleLayerTransformed(uGroundAlbedo, layer, uv, dx, dy, frame.offsetB,
    frame.turnB * allowTurn);
  return mix(first, second, frame.blend);
}

/** Decoded normal x/z (turned back to world XZ), AO and roughness of one transform. */
vec4 sampleNormalTransformed(float layer, vec2 uv, vec2 dx, vec2 dy, vec2 offset, float turns) {
  vec4 raw = sampleLayerTransformed(uGroundNormal, layer, uv, dx, dy, offset, turns);
  return vec4(turnQuarter(raw.rg * 2.0 - 1.0, mod(4.0 - turns, 4.0)), raw.ba);
}

vec4 sampleNormalUntiled(float layer, vec2 uv, vec2 dx, vec2 dy, UntileFrame frame, float allowTurn) {
  if (frame.blend >= 1.0)
    return sampleNormalTransformed(layer, uv, dx, dy, frame.offsetB, frame.turnB * allowTurn);
  vec4 first = sampleNormalTransformed(layer, uv, dx, dy, frame.offsetA,
    frame.turnA * allowTurn);
  if (frame.blend <= 0.0) return first;
  vec4 second = sampleNormalTransformed(layer, uv, dx, dy, frame.offsetB,
    frame.turnB * allowTurn);
  return mix(first, second, frame.blend);
}
`;

/**
 * Cover-density field (T04): one R8 texel per cell, texel centres on the cell centres. A dense
 * meadow reads deeper and less sky-lit; the uniform stays zero until the worker field arrives.
 * The OD-T4 lawn depth setting arrives as uLawnDepth (rgb shade, w occlusion); w = 1 is off and
 * skips the texture fetch entirely.
 */
export const COVER_FIELD_GLSL = `
uniform sampler2D uCoverField;
uniform vec4 uLawnDepth;

float sampleCoverField(vec2 xz) {
  if (uWorldSize.x <= 0.0) return 0.0;
  return texture(uCoverField, xz / uWorldSize).r;
}

/** World bounds (min x, min z, max x, max z) of the crop plots; empty (min > max) when there is none. */
uniform vec4 uFieldSoilBox;

/**
 * Cultivated soil 0..1 of crop plots (cover field G, soft across one cell): tilled soil under the crops. Pixels
 * outside the plots' bounds skip the fetch (most of an island; all of it without farms).
 */
float sampleFieldSoil(vec2 xz) {
  if (any(lessThan(xz, uFieldSoilBox.xy)) || any(greaterThan(xz, uFieldSoilBox.zw))) return 0.0;
  return texture(uCoverField, xz / uWorldSize).g;
}

/** Depth of this pixel in dense meadow (0..1); 0 when the lawn depth setting is off. */
float sampleLawnDepth(vec2 xz, float cover) {
  if (uLawnDepth.w >= 1.0) return 0.0;
  return sampleCoverField(xz) * cover;
}
`;

/**
 * Tangent basis of the geometric normal. Flat ground maps the perturbation to world X/Z exactly
 * as before; near vertical faces the reference axis switches to world Z and stays stable.
 */

export const GROUND_TANGENT_GLSL = `
mat3 groundTangentBasis(vec3 normal) {
  vec3 tangent = abs(normal.x) < 0.999
    ? normalize(vec3(1.0, 0.0, 0.0) - normal * normal.x)
    : normalize(vec3(0.0, 0.0, 1.0) - normal * normal.z);
  return mat3(tangent, cross(tangent, normal), normal);
}
`;

/**
 * T06a micro-detail atlas sampling and application, shared by the full and lite ground. The near
 * band uses world-space derivatives, so the spyglass sharpens it without another threshold.
 */
export const MICRO_DETAIL_GLSL = `
uniform sampler2D uMicroAtlas;

const vec2 MICRO_GRID = vec2(${MICRO_DETAIL_COLUMNS.toFixed(1)}, ${MICRO_DETAIL_ROWS.toFixed(1)});
const float MICRO_INNER = ${MICRO_DETAIL_INNER.toFixed(6)};
const float MICRO_PAD = ${MICRO_DETAIL_PAD.toFixed(6)};
const float MICRO_UNITS = ${MICRO_DETAIL_UNITS.toFixed(6)};
const float MICRO_NORMAL_STRENGTH = 0.6;
const float MICRO_ALBEDO_STRENGTH = 0.5;
const float MICRO_CAVITY_STRENGTH = 0.18;

/** Normal x/z, albedo multiplier and height of a micro class cell at a world position. */
vec4 sampleMicroDetail(vec2 cell, vec2 xz, vec2 worldDx, vec2 worldDy) {
  vec2 scale = vec2(MICRO_INNER / MICRO_UNITS) / MICRO_GRID;
  vec2 uv = (cell + MICRO_PAD + fract(xz / MICRO_UNITS) * MICRO_INNER) / MICRO_GRID;
  vec4 raw = textureGrad(uMicroAtlas, uv, worldDx * scale, worldDy * scale);
  return vec4(raw.rg * 2.0 - 1.0, raw.b * 2.0, raw.a);
}

/** Adds the micro detail to a near pixel; near 0..1 is the existing footprint weight. */
void applyMicroDetail(inout vec3 albedo, inout vec4 surface, vec4 micro, float near) {
  surface.xy += micro.xy * MICRO_NORMAL_STRENGTH * near;
  surface.z *= 1.0 + (micro.w - 0.5) * MICRO_CAVITY_STRENGTH * near;
  albedo *= mix(1.0, micro.z, MICRO_ALBEDO_STRENGTH * near);
}
`;

/** Rain-soaked meadow hue, shared with the runtime grass tint. */
const vec3Literal = (values: readonly number[]) => `vec3(${values.map(value => glslLiteral(value)).join(", ")})`;
export const RAIN_LUSH_TINT = [0.84, 0.97, 0.94] as const;
export const RAIN_LUSH_TINT_GLSL = vec3Literal(RAIN_LUSH_TINT);

/** Meadow region, dry-patch and canopy tints shared with the TSL ground twin. */
export const MEADOW_TINT = {
  blueGreen: [0.9, 1.0, 0.97] as const,
  canopy: [0.6, 0.7, 0.66] as const,
  dry: [1.25, 1.08, 0.66] as const,
  yellowGreen: [1.07, 1.04, 0.84] as const
} as const;

/**
 * World space variation of the ground in 4 noise fetches (needs NOISE_GLSL): macro regions and
 * patches tint the meadows (dry patches, darker grass under the canopy, lush in the rain).
 */
export const GROUND_MACRO_GLSL = `
/** World space variation in 4 fetches (4 independent channels each). */
struct GroundMacro {
  vec4 region;
  vec4 patches;
  vec4 breakup;
  vec4 grain;
  float far;
};

GroundMacro sampleGroundMacro(vec2 xz, float footprint) {
  return GroundMacro(
    texture(uNoiseTexture, xz * (0.021 / NOISE_LATTICE)),
    texture(uNoiseTexture, (xz * 0.085 + 11.3) / NOISE_LATTICE),
    texture(uNoiseTexture, (xz * 0.5 + 5.1) / NOISE_LATTICE),
    texture(uNoiseTexture, (DETAIL_ROTATION * xz * 1.9 + 3.7) / NOISE_LATTICE),
    smoothstep(0.018, 0.09, footprint)
  );
}

${MEADOW_DRY_GLSL}
${SEASON_MEADOW_GLSL}

/** Rain soaks the meadow: deeper, bluer, lush green (the generated islands have no swamps). */
const vec3 RAIN_LUSH_TINT = ${RAIN_LUSH_TINT_GLSL};

/**
 * Meadow colour by region and patch: blue-green to yellow-green regions, lusher and paler
 * patches, dry straw patches; sunny, exposed slopes and ridges (dry: the surface mask's dryness
 * scaled by the theme) turn olive and then straw in noise-broken patches; light starved darker grass
 * under the canopy; lush in the rain; the cosmetic season (C1) leans the dry-grass mask and tints the grass.
 */
vec3 meadowTint(GroundMacro macro, float canopy, float dry) {
  float yellowGreen = smoothstep(0.36, 0.7, macro.region.x);
  float patchDry = smoothstep(0.58, 0.78, macro.patches.z) * smoothstep(0.42, 0.62, macro.region.z);
  float sunny = getSunnyDryness(macro, dry);
  vec3 tint = mix(${vec3Literal(MEADOW_TINT.blueGreen)}, ${vec3Literal(MEADOW_TINT.yellowGreen)}, yellowGreen);
  tint *= mix(0.9, 1.08, macro.region.y) * mix(0.93, 1.07, macro.patches.w);
  tint = mix(tint, MEADOW_DRY_OLIVE, smoothstep(0.0, 0.6, sunny) * ${glslLiteral(GROUND_CONTEXT_TUNING.dryOliveShare)});
  float straw = max(patchDry * 0.6, smoothstep(0.45, 1.0, sunny) * ${glslLiteral(GROUND_CONTEXT_TUNING.dryStrawShare)});
  tint = mix(tint, ${vec3Literal(MEADOW_TINT.dry)}, getSeasonStraw(straw, sunny, patchDry));
  tint = mix(vec3(1.0), tint, 1.0 + macro.far * 0.5);
  tint *= mix(vec3(1.0), RAIN_LUSH_TINT, uRain);
  return applySeasonMeadow(mix(tint, ${vec3Literal(MEADOW_TINT.canopy)}, canopy * 0.8));
}
`;

/**
 * Lit ground (needs a GroundSample with albedo, normal, occlusion, roughness and the variant's
 * getGroundSparkle and rollOffGroundHighlights): material AO darkens sky light fully and sun light
 * partly; roughness drives a soft sun highlight (wet ground gets glossier in the rain).
 */
export const GROUND_LIGHT_GLSL = `
vec3 lightGround(GroundSample ground, float sunVisibility, float occlusion, vec2 xz) {
  float cavity = mix(1.0, ground.occlusion, 0.5);
  vec3 color = lightSurface(ground.albedo * cavity, ground.normal, sunVisibility, occlusion * ground.occlusion, xz);
  float gloss = 1.0 - ground.roughness * (1.0 - uRain * 0.45);
  float power = 4.0 + gloss * gloss * 80.0;
  vec3 halfway = normalize(uSunDirection + uViewDirection);
  float highlight = pow(max(dot(ground.normal, halfway), 0.0), power) * (power + 2.0) * 0.005;
  float visibility = sunVisibility;
  vec3 sparkle = getGroundSparkle(ground, xz, visibility);
  return rollOffGroundHighlights(ground,
    color + uSunColor * highlight * gloss * visibility * ground.occlusion + sparkle);
}
`;
