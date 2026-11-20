import { glslFloat } from "../../../render-common/shaders/common-glsl";
import { CONIFER_SCALES, glslConiferScales } from "../../../render-common/trees/bark-shading";
import { BARK_FAMILY } from "../../../render-common/trees/bark-uv";


/**
 * Procedural conifer bark (GLSL ES 3, fragment) of the island prop shader
 * (three-conifer-shading.ts): bark = (around 0..1, along in circumferences), family = BARK_FAMILY. Hash
 * noise only, so it needs no uniforms or textures.
 * - spruce (and the tall forest pine): small, thin, rounded grey-brown scales;
 * - mountain pine: dark, rugged, irregular blocks.
 * coniferBark returns the albedo and the relief height (0 furrow .. 1 scale top);
 * coniferBarkDepth the family's relief depth in circumferences (for bump mapping).
 */
export const CONIFER_BARK_GLSL = `
const float MOUNTAIN_FAMILY = ${glslFloat(BARK_FAMILY.mountainPine)};

float coniferHash(float value) {
  return fract(sin(value * 127.1 + 31.7) * 43758.5453);
}

float coniferNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = coniferHash(dot(cell, vec2(1.0, 57.0)));
  float b = coniferHash(dot(cell + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = coniferHash(dot(cell + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = coniferHash(dot(cell + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Noise that wraps seamlessly around the limb (around enters as a circle). */
float coniferWrapNoise(vec2 bark, float scale, float offset) {
  float angle = bark.x * 6.2831853;
  return coniferNoise(vec2(cos(angle), sin(angle)) * scale + vec2(bark.y * scale * 1.9, offset));
}

/**
 * Scale pattern of one family: columns around, rows per circumference, furrow width, relief,
 * column warp and roundness (0 long plates with straight edges .. 1 rounded scales).
 */
struct ConiferScales {
  float columns;
  float depth;
  float furrow;
  float round;
  float rows;
  float warp;
};

const ConiferScales SPRUCE_SCALES = ${glslConiferScales(CONIFER_SCALES.spruce)};
const ConiferScales MOUNTAIN_BLOCKS = ${glslConiferScales(CONIFER_SCALES.mountain)};

/**
 * Bark scales: warped columns around the limb, each broken into staggered rows; x is the height
 * (0 furrow .. 1 scale top, the lower edge of each scale lifts a little), y the detail (fades to
 * the mean before it aliases).
 */
vec2 coniferScales(vec2 bark, ConiferScales kind, float seed) {
  float x = bark.x * kind.columns + (coniferWrapNoise(bark, 0.9, seed) - 0.5) * kind.warp * 2.0;
  float column = floor(x);
  float shift = coniferHash(column + seed) * 1.7 + coniferWrapNoise(bark, 2.5, seed + 5.0) * 0.4;
  float y = bark.y * kind.rows + shift;
  float row = floor(y);
  float across = smoothstep(0.0, kind.furrow, abs(fract(x + 0.5) - 0.5));
  float crack = smoothstep(0.0, kind.furrow * 0.7, 0.5 - abs(fract(y) - 0.5));
  vec2 jitter = vec2(coniferHash(column * 7.7 + row), coniferHash(row * 3.3 + column)) - 0.5;
  vec2 local = vec2(fract(x) - 0.5, fract(y) - 0.5) - jitter * 0.4;
  float rounded = 1.0 - smoothstep(0.5 - kind.furrow, 0.62, length(local * vec2(1.0, 1.15)));
  float lift = mix(0.85, 1.0, fract(y));
  float shape = mix(across * crack, rounded, kind.round);
  float height = shape * lift * (0.78 + 0.22 * coniferHash(column * 3.1 + row));
  float detail = 1.0 - smoothstep(0.22, 0.55, fwidth(x) + fwidth(y) * 0.5);
  return vec2(mix(0.7, height, detail), detail);
}

/** Scale tops lighter and greyer, furrows a darker tone of the bark (never black). */
vec3 coniferAlbedo(vec3 base, vec2 scales, vec3 topTint, vec3 furrowTint, float weathering) {
  vec3 top = base * topTint * (0.86 + weathering * 0.28);
  vec3 bottom = base * furrowTint;
  vec3 albedo = mix(bottom, top, smoothstep(0.12, 0.55, scales.x));
  return mix(mix(bottom, top, 0.62), albedo, scales.y);
}

vec4 coniferBark(vec3 base, vec2 bark, float family) {
  float weathering = coniferWrapNoise(bark, 5.0, 29.0);
  if (family == MOUNTAIN_FAMILY) {
    vec2 blocks = coniferScales(bark, MOUNTAIN_BLOCKS, 13.0);
    vec3 albedo = coniferAlbedo(base, blocks, vec3(1.18, 1.15, 1.12), vec3(0.45, 0.38, 0.34), weathering);
    return vec4(albedo, blocks.x);
  }
  vec2 scales = coniferScales(bark, SPRUCE_SCALES, 21.0);
  vec3 albedo = coniferAlbedo(base, scales, vec3(1.08, 1.06, 1.04), vec3(0.58, 0.42, 0.35), weathering);
  return vec4(albedo, scales.x);
}

float coniferBarkDepth(vec3 base, float family) {
  if (family == MOUNTAIN_FAMILY) return MOUNTAIN_BLOCKS.depth;
  return SPRUCE_SCALES.depth;
}
`;
