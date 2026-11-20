import { glslLiteral } from "../../render-common/shaders/glsl-literal";
import { LEAF_LIGHT_GLSL, LEAF_NORMAL_GLSL } from "../../render-common/shaders/leaf-glsl";
import { BARK_LICHEN, glslVec3, OAK_BARK } from "../../render-common/trees/bark-shading";
import { BARK_UV_LIMIT, BARK_UV_OFFSET } from "../../render-common/trees/bark-uv";
import { BARK_BUMP_GLSL } from "./trees/bark-glsl";

/**
 * Tree surfaces for the prop shader (needs COMMON_UNIFORMS, NOISE, LIGHTING and
 * PROP_SHADING): relief oak bark from the bark uv of the island tree wood, and leaf light
 * (per leaf relief from the atlas normal map, light through back-lit leaves, a soft waxy
 * sheen).
 */
export const TREE_SHADING_GLSL = `
const float BARK_UV_LIMIT = ${BARK_UV_LIMIT.toFixed(2)};
const float BARK_UV_OFFSET = ${BARK_UV_OFFSET.toFixed(2)};
/** Plates around a limb, cracks per circumference along it, relief depth (circumferences). */
const float BARK_PLATES = ${glslLiteral(OAK_BARK.plates)};
const float BARK_CRACKS = ${glslLiteral(OAK_BARK.cracks)};
const float BARK_DEPTH = ${glslLiteral(OAK_BARK.depth)};
/** Relief where the pattern fades out with distance (the averaged surface). */
const float BARK_MEAN_HEIGHT = ${glslLiteral(OAK_BARK.meanHeight)};
const vec3 LICHEN = ${glslVec3(BARK_LICHEN)};
${LEAF_NORMAL_GLSL}

bool isBark(vec2 uv) {
  return uv.x < BARK_UV_LIMIT;
}

/** around (0..1, plus twist) and along (circumferences) the limb. */
vec2 toBark(vec2 uv) {
  return vec2(-uv.x - BARK_UV_OFFSET, uv.y);
}

/** Noise lookup that wraps seamlessly around the limb. */
float barkNoise(vec2 bark, float scale, float offset) {
  float angle = bark.x * 6.2831853;
  return valueNoise(vec2(cos(angle), sin(angle)) * scale + vec2(bark.y * scale * 1.9, offset));
}

float barkHash(float value) {
  return fract(sin(value * 127.1 + 31.7) * 43758.5453);
}

/** Distance (in plate widths) to the nearest line of a warped set of furrow lines. */
float lineDistance(float x) {
  return abs(fract(x + 0.5) - 0.5);
}

/**
 * Oak bark plates: two wandering sets of mostly vertical furrows, the second only in places,
 * so the furrows braid, merge and split (a network, not a grid); each plate is broken into
 * stacked blocks by short cross cracks. x: height (0 furrow bottom .. 1 rounded plate top),
 * y: detail (1 close .. 0 faded to the averaged surface before it would alias).
 */
vec2 barkPlates(vec2 bark) {
  float warpA = barkNoise(bark, 0.8, 3.1) * 0.9 + barkNoise(bark, 2.0, 7.0) * 0.3;
  float warpB = barkNoise(bark, 1.1, 11.0) * 1.8;
  float xA = bark.x * BARK_PLATES + warpA;
  float xB = bark.x * BARK_PLATES + 0.5 + warpB;
  float present = smoothstep(0.45, 0.6, barkNoise(bark, 1.6, 17.0));
  float distance = min(lineDistance(xA), lineDistance(xB) + (1.0 - present) * 0.5);
  float plate = smoothstep(0.05, 0.17, distance);
  float rounded = mix(0.8, 1.0, sqrt(clamp(distance / 0.35, 0.0, 1.0)));
  float column = floor(xA);
  float along = bark.y * BARK_CRACKS + barkHash(column) + barkNoise(bark, 3.0, 23.0) * 0.35;
  float crackDistance = abs(fract(along + 0.5) - 0.5);
  float crackOn = step(0.25, barkHash(column + floor(along) * 7.3));
  float crack = (1.0 - smoothstep(0.03, 0.1, crackDistance)) * crackOn;
  float height = plate * rounded * (1.0 - crack * 0.6);
  float detail = 1.0 - smoothstep(0.22, 0.55, fwidth(xA));
  return vec2(mix(BARK_MEAN_HEIGHT, height, detail), detail);
}

/** Ash grey plate tops, rust brown plate sides, dark brown (never black) furrow bottoms. */
vec3 barkAlbedo(vec3 base, float height, float detail, float weathering) {
  vec3 grey = vec3(dot(base, vec3(0.333)));
  vec3 top = mix(base, grey * vec3(1.12, 1.1, 1.03), 0.4) * (0.82 + weathering * 0.3);
  vec3 side = base * vec3(0.9, 0.64, 0.46);
  vec3 bottom = base * vec3(0.34, 0.29, 0.26);
  vec3 plate = mix(side, top, smoothstep(0.72, 0.92, height));
  vec3 albedo = mix(plate, bottom, 1.0 - smoothstep(0.1, 0.4, height));
  vec3 mean = mix(side, top, 0.55) * 0.9;
  return mix(mean, albedo, detail);
}

${BARK_BUMP_GLSL}

/** Plate bark with a strong bump, cavity darkening only in the furrows; before fog of war. */
vec3 lightBark(vec3 base, vec3 normal, vec2 uv, vec3 world, float sunVisibility) {
  vec2 bark = toBark(uv);
  vec2 plates = barkPlates(bark);
  float height = plates.x;
  vec3 bumped = perturbBarkNormal(normal, world, height * BARK_DEPTH * barkScale(bark, world));
  vec3 albedo = barkAlbedo(base, height, plates.y, barkNoise(bark, 5.0, 29.0));
  float north = smoothstep(0.0, 0.7, -normal.z);
  float patches = smoothstep(0.5, 0.72, barkNoise(bark, 3.0, 20.0));
  float tops = smoothstep(0.7, 0.95, height);
  albedo = mix(albedo, LICHEN * dot(base, vec3(0.333)) * 2.0, north * patches * tops * 0.3);
  float cavity = mix(0.6, 1.0, smoothstep(0.0, 0.3, height));
  vec3 bounce = albedo * (uAmbientSky + uAmbientGround) * 0.12;
  return lightSurface(albedo, bumped, sunVisibility, cavity, world.xz) + bounce;
}

/**
 * Leaf cards seen edge-on show as thin streaks in close views: they drop out by the angle between
 * the card plane (from screen derivatives) and the eye ray of this fragment. The eye ray is per
 * fragment under a perspective camera: the camera's forward axis is up to half the field of view
 * off at the screen border, which faded upward-facing cards at a crown top seen from below into
 * translucent ghosts (FOLIAGE, 2026-11-13). The band is narrow, so a card is drawn or gone rather
 * than half transparent under alpha to coverage.
 */
uniform vec3 cameraPosition;
uniform mat4 projectionMatrix;
vec3 getEyeDirection(vec3 world) {
  if (projectionMatrix[3][3] > 0.5) return uViewDirection;
  return normalize(cameraPosition - world);
}

float getCardFacing(vec3 world) {
  vec3 plane = normalize(cross(dFdx(world), dFdy(world)));
  return smoothstep(0.07, 0.13, abs(dot(plane, getEyeDirection(world))));
}

${LEAF_LIGHT_GLSL}
`;
