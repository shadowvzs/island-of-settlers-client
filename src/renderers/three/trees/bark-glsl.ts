import { DERIVATIVE_BUMP_GLSL } from "../../../render-common/shaders/derivative-bump-glsl";
import { glslLiteral } from "../../../render-common/shaders/glsl-literal";
import { BIRCH_BARK, glslVec3 } from "../../../render-common/trees/bark-shading";

/**
 * Bark bump mapping from screen derivatives (no tangents needed) for the island prop shader
 * (three-tree-shading.ts).
 */
export const BARK_BUMP_GLSL = `
${DERIVATIVE_BUMP_GLSL}
vec3 perturbBarkNormal(vec3 normal, vec3 world, float height) {
  return perturbDerivativeNormal(world, normal, height);
}

/** World size of one bark unit (the circumference): the mapping is about isotropic. */
float barkScale(vec2 bark, vec3 world) {
  float worldStep = length(dFdx(world)) + length(dFdy(world));
  float barkStep = length(dFdx(bark)) + length(dFdy(bark));
  return worldStep / max(barkStep, 1e-5);
}
`;

/**
 * Procedural silver birch bark (GLSL ES 3, fragment) of the island prop shader
 * (three-birch-shading.ts). bark = (around 0..1, along in circumferences); along < ~2.5 on a
 * trunk is its rough base (branches start their along far above it). Hash noise only, so it
 * needs no uniforms or textures.
 *
 * - dark marks wrap partially around: mostly 15-30 % of the circumference, some 30-60 %, rarely
 *   60-85 %; rows are warped and some stay empty (no zebra stripes, no even spacing, no rings);
 * - fine horizontal lenticels, faint peeling strips and grey patches on the pale bark;
 * - the base turns darker and greyer with vertical fissures and a little moss.
 * Returns the albedo and a relief height (bump mapping).
 */
export const BIRCH_BARK_GLSL = `
const float BIRCH_MARK_ROWS = ${glslLiteral(BIRCH_BARK.markRows)};
const float BIRCH_LENTICEL_ROWS = ${glslLiteral(BIRCH_BARK.lenticelRows)};
const vec3 BIRCH_MARK = ${glslVec3(BIRCH_BARK.mark)};
const vec3 BIRCH_MARK_BROWN = ${glslVec3(BIRCH_BARK.markBrown)};
const vec3 BIRCH_MOSS = ${glslVec3(BIRCH_BARK.moss)};

float birchHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float birchNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float bottom = mix(birchHash(cell), birchHash(cell + vec2(1.0, 0.0)), f.x);
  float top = mix(birchHash(cell + vec2(0.0, 1.0)), birchHash(cell + vec2(1.0, 1.0)), f.x);
  return mix(bottom, top, f.y);
}

/** Noise that wraps seamlessly around the limb (around enters as a circle). */
float birchWrapNoise(vec2 bark, vec2 scale, float offset) {
  float angle = bark.x * 6.2831853;
  vec2 ring = vec2(cos(angle), sin(angle)) * scale.x;
  return birchNoise(ring + vec2(bark.y * scale.y + offset, offset * 1.7));
}

/** Distance around the limb (0..0.5 of the circumference). */
float birchAround(float a, float b) {
  return abs(fract(a - b + 0.5) - 0.5);
}

/**
 * One family of horizontal marks: rows along the limb (warped, some empty), each a lens that
 * wraps part of the way around and thins towards its ends. widths: (smallest, extra range).
 */
float birchMarks(vec2 bark, float rows, float seed, vec2 widths, float thickness) {
  float along = bark.y * rows + birchWrapNoise(bark, vec2(1.2, 0.7), seed) * 0.35;
  float row = floor(along);
  float inRow = fract(along) - 0.5;
  float present = step(birchHash(vec2(row, seed + 3.7)), 0.62);
  float width = widths.x + widths.y * pow(birchHash(vec2(row, seed)), 3.0);
  float centre = birchHash(vec2(row, seed + 9.1));
  float reach = birchAround(bark.x, centre) / (width * 0.5);
  float edge = birchWrapNoise(bark, vec2(7.0, 9.0), row * 3.1 + seed);
  float lens = max(0.0, 1.0 - reach * reach);
  float halfThickness = thickness * (0.6 + birchHash(vec2(row, seed + 1.3)) * 0.8) * lens * (0.7 + edge * 0.6);
  return (1.0 - smoothstep(halfThickness * 0.6, halfThickness, abs(inRow))) * smoothstep(1.0, 0.75, reach) * present;
}

/** Rough base of a trunk: 1 at the foot, gone about two and a half circumferences up. */
float birchLower(vec2 bark) {
  return 1.0 - smoothstep(0.4, 2.6, bark.y + (birchWrapNoise(bark, vec2(1.5, 1.0), 61.0) - 0.5) * 0.8);
}

/** Vertical fissures of old lower bark (wavy, merging). */
float birchFissures(vec2 bark) {
  float x = bark.x * 14.0 + birchWrapNoise(bark, vec2(1.6, 4.0), 71.0) * 1.2;
  float line = abs(fract(x) - 0.5);
  float broken = smoothstep(0.45, 0.7, birchWrapNoise(bark, vec2(3.0, 9.0), 83.0));
  return (1.0 - smoothstep(0.02, 0.07, line)) * broken;
}

vec4 birchBark(vec3 base, vec2 bark, float lower) {
  float markDetail = 1.0 - smoothstep(0.3, 0.8, fwidth(bark.y * BIRCH_MARK_ROWS));
  float fineDetail = 1.0 - smoothstep(0.25, 0.6, fwidth(bark.y * BIRCH_LENTICEL_ROWS));
  float marks = max(
    birchMarks(bark, BIRCH_MARK_ROWS, 1.0, vec2(0.15, 0.7), 0.12),
    birchMarks(bark, BIRCH_MARK_ROWS * 1.43, 5.0, vec2(0.15, 0.45), 0.09) * 0.85
  );
  float lenticels = birchMarks(bark, BIRCH_LENTICEL_ROWS, 11.0, vec2(0.03, 0.08), 0.08);
  marks = mix(0.12, marks, markDetail);
  lenticels = mix(0.05, lenticels, fineDetail);
  float peel = smoothstep(0.64, 0.72, birchWrapNoise(bark, vec2(2.5, 11.0), 23.0));
  float grey = smoothstep(0.55, 0.85, birchWrapNoise(bark, vec2(2.0, 1.6), 41.0));
  float patches = birchWrapNoise(bark, vec2(5.0, 6.0), 53.0);
  float fissures = birchFissures(bark) * lower * lower * fineDetail;
  vec3 pale = base * mix(vec3(1.0), vec3(1.04, 1.0, 0.92), peel * 0.6);
  pale = mix(pale, vec3(dot(pale, vec3(0.333))) * 0.84, grey * 0.35);
  vec3 rough = base * vec3(0.6, 0.57, 0.53) * (0.8 + patches * 0.3);
  vec3 albedo = mix(pale, rough, lower * (0.3 + patches * 0.3));
  albedo = mix(albedo, BIRCH_MOSS * (0.8 + patches * 0.4), pow(lower, 3.0) * smoothstep(0.55, 0.8, patches) * 0.4);
  vec3 mark = mix(BIRCH_MARK, BIRCH_MARK_BROWN, birchWrapNoise(bark, vec2(4.0, 6.0), 31.0));
  albedo = mix(albedo, mark, marks * 0.9);
  albedo = mix(albedo, BIRCH_MARK_BROWN * 1.3, lenticels * 0.55);
  albedo = mix(albedo, BIRCH_MARK, fissures * 0.6);
  float height = 1.0 - marks * 0.35 - lenticels * 0.25 - fissures * 0.8 + peel * 0.1 - lower * patches * 0.2;
  return vec4(albedo, height);
}
`;
