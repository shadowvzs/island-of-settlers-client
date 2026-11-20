import {
  GRASS_RING_COVER_RAMP,
  GRASS_RING_EDGE_NOISE,
  GRASS_RING_EDGE_NOISE_SCALE,
  GRASS_RING_FADE_START,
  GRASS_RING_FALLOFF,
  GRASS_RING_PATCH_BLADES,
  GRASS_RING_SAMPLE_SPACING,
  GRASS_RING_TILE,
  GRASS_RING_TINT_RANGE
} from "../grass/grass-ring-layout";
import { VERGE_COVER_HEIGHT, VERGE_COVER_KEPT } from "../props/field-cover-exclusions";
import { FIELD_GREENS } from "../props/plants/plant-colors";

const coverStart = GRASS_RING_COVER_RAMP.start.toFixed(2);
const coverEnd = GRASS_RING_COVER_RAMP.end.toFixed(1);
const vec3 = (rgb: readonly number[]) => `vec3(${rgb.map(value => value.toFixed(3)).join(", ")})`;

/**
 * T07 grass ring: ring ground access. RGBA32F toroidal window, one texel per terrain vertex
 * (r height, g packed grass tint, b roadside weight: negative on the road corridor, 0..1 across a verge);
 * texel index = sample index modulo the window.
 */
export const GRASS_RING_GROUND_GLSL = `
uniform sampler2D uRingGround;
const float RING_TILE = ${GRASS_RING_TILE.toFixed(1)};
const float RING_SPACING = ${GRASS_RING_SAMPLE_SPACING.toFixed(2)};

struct RingGround {
  float height;
  float roadside;
  vec3 tint;
  /** Cover kept by the ground zone (the tufts' alpine and lichen thinning, field-cover.ts). */
  float zoneKeep;
};

vec4 fetchRingGround(vec2 sampleIndex) {
  vec2 size = vec2(textureSize(uRingGround, 0));
  return texelFetch(uRingGround, ivec2(mod(sampleIndex, size)), 0);
}

vec3 unpackRingTint(float packed) {
  float value = floor(packed + 0.5);
  vec3 steps = vec3(floor(value / 65536.0), mod(floor(value / 256.0), 256.0), mod(value, 256.0));
  return steps * (${GRASS_RING_TINT_RANGE.toFixed(1)} / 255.0);
}

/** Bilinear between the four terrain vertices around a point (the terrain triangles' plane). */
RingGround sampleRingGround(vec2 xz) {
  vec2 grid = xz / RING_SPACING;
  vec2 base = floor(grid);
  vec2 blend = grid - base;
  vec4 a = fetchRingGround(base), b = fetchRingGround(base + vec2(1.0, 0.0));
  vec4 c = fetchRingGround(base + vec2(0.0, 1.0)), d = fetchRingGround(base + vec2(1.0, 1.0));
  vec4 scalars = mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  vec3 tint = mix(mix(unpackRingTint(a.g), unpackRingTint(b.g), blend.x),
    mix(unpackRingTint(c.g), unpackRingTint(d.g), blend.x), blend.y);
  return RingGround(scalars.r, scalars.b, tint, scalars.a);
}
`;

/**
 * grass-band 2026-11-14: the ring's kept share and the short-grass tufts' complement, shared by the
 * ring blades and the tuft vertex shader so both layers cross-fade at equal cover. Needs NOISE.
 * shape: level density, full-density distance, ring radius, tuft cover (GrassRingSettings).
 */
export const GRASS_RING_SHARE_GLSL = `
const float RING_FALLOFF = ${GRASS_RING_FALLOFF.toFixed(2)};
const float RING_FADE_START = ${GRASS_RING_FADE_START.toFixed(2)};
const float RING_EDGE_NOISE = ${GRASS_RING_EDGE_NOISE.toFixed(2)};
const float RING_EDGE_NOISE_SCALE = ${GRASS_RING_EDGE_NOISE_SCALE.toFixed(2)};

/** Share of the patch drawn at this eye distance: full near the eye, thinning, then a noise-broken fade. */
float getRingShare(vec4 shape, float distanceToEye, vec2 root) {
  float falloff = min(1.0, pow(shape.y / max(distanceToEye, 1e-3), RING_FALLOFF));
  float shifted = distanceToEye + valueNoise(root * RING_EDGE_NOISE_SCALE) * RING_EDGE_NOISE * shape.z;
  float edge = 1.0 - smoothstep(shape.z * RING_FADE_START, shape.z, shifted);
  return shape.x * falloff * edge;
}

/** Kept share of the short-grass tufts: the cover the ring no longer gives (0 near the eye). */
float getRingTuftKeep(vec4 shape, float distanceToEye, vec2 root) {
  return 1.0 - min(1.0, getRingShare(shape, distanceToEye, root) / shape.w);
}
`;

/**
 * Blade placement, keep and shape (vertex stage). Needs COMMON_UNIFORMS, NOISE, WIND, PROP_FOG,
 * COVER_FIELD, TRAFFIC_WEAR_FIELD, TRAFFIC_GRASS, GRASS_RING_GROUND and GRASS_RING_SHARE.
 * uRingEye: eye x/z, view blend (0 iso .. 1 possessed), world size of one pixel at distance 1.
 * uRingShape: see GRASS_RING_SHARE_GLSL.
 */
export const GRASS_RING_BLADE_GLSL = `
uniform vec4 uRingEye;
uniform vec4 uRingShape;
const float RING_PATCH_BLADES = ${GRASS_RING_PATCH_BLADES.toFixed(1)};
/** Tile bounding sphere radius: half the tile diagonal plus a lean blade. */
const float RING_TILE_RADIUS = ${(GRASS_RING_TILE * Math.SQRT1_2 + 0.35).toFixed(3)};

uint hashRing(uvec3 value) {
  value = value * 1664525u + 1013904223u;
  value.x += value.y * value.z;
  value.y += value.z * value.x;
  value.z += value.x * value.y;
  value ^= value >> 16u;
  value.x += value.y * value.z;
  return value.x ^ (value.x >> 11u);
}

vec4 hashBlade(vec2 tile, float index) {
  uvec3 seed = uvec3(ivec3(int(tile.x) + 32768, int(tile.y) + 32768, int(index)));
  uint first = hashRing(seed);
  uint second = hashRing(seed + uvec3(0u, 0u, 4099u));
  return vec4(uvec4(first & 0xffffu, first >> 16u, second & 0xffffu, second >> 16u)) / 65535.0;
}

/** True when the tile's bounding sphere lies outside the view frustum's sides or behind the eye. */
bool isRingTileHidden(vec2 tile) {
  vec2 centre = (tile + 0.5) * RING_TILE;
  float groundY = fetchRingGround(floor(centre / RING_SPACING)).r;
  vec4 view = viewMatrix * vec4(centre.x, groundY, centre.y, 1.0);
  float depth = -view.z;
  if (depth < -RING_TILE_RADIUS) return true;
  vec2 tangents = vec2(1.0 / projectionMatrix[0][0], 1.0 / projectionMatrix[1][1]);
  vec2 reach = depth * tangents + RING_TILE_RADIUS * sqrt(1.0 + tangents * tangents);
  return abs(view.x) > reach.x || abs(view.y) > reach.y;
}

/** Tile-local root, turned by quarter turns and mirrored per tile so the patch does not repeat. */
vec2 getRingRoot(vec2 tile, vec2 local) {
  uint variant = hashRing(uvec3(ivec3(int(tile.x) + 32768, int(tile.y) + 32768, 7)));
  vec2 offset = local - RING_TILE * 0.5;
  if ((variant & 4u) != 0u) offset.x = -offset.x;
  uint turn = variant & 3u;
  if (turn == 1u) offset = vec2(-offset.y, offset.x);
  if (turn == 2u) offset = -offset;
  if (turn == 3u) offset = vec2(offset.y, -offset.x);
  return tile * RING_TILE + RING_TILE * 0.5 + offset;
}


/**
 * Meadow density at the root: the cover field (roads, plots, fields, sand are 0), trampling and packed yards, and the
 * ruin scorch (needs TRAFFIC_GRASS_GLSL and SCORCH_GRASS_GLSL).
 */
float getRingGroundDensity(vec2 root) {
  float cover = smoothstep(${coverStart}, ${coverEnd}, sampleCoverField(root));
  if (cover <= 0.0) return 0.0;
  return cover * trafficGrassKeep(root) * scorchGrassKeep(root);
}

/**
 * Road corridor and verge as the tufts have them: nothing on the corridor, and across a verge only
 * VERGE_COVER_KEPT of the blades at VERGE_COVER_HEIGHT where the thinning is strongest.
 * Returns (density factor, height factor).
 */
vec2 getRingRoadside(float roadside) {
  float verge = clamp(roadside, 0.0, 1.0);
  float corridor = smoothstep(-0.08, 0.0, roadside);
  float kept = mix(${VERGE_COVER_KEPT.toFixed(2)}, 1.0, verge);
  return vec2(corridor * kept, mix(${VERGE_COVER_HEIGHT.toFixed(2)}, 1.0, verge));
}

/** 1 keeps the blade whole, 0 drops it; blades just past the threshold shrink instead of popping. */
float getRingBladeKeep(float rank, float threshold) {
  if (threshold <= 0.0) return 0.0;
  return clamp((threshold - rank) / max(threshold * 0.35, 1.0 / RING_PATCH_BLADES), 0.0, 1.0);
}
`;

/** Blade colours: the field-cover tuft palette, so the ring and the tufts share one meadow. */
export const GRASS_RING_COLOR_GLSL = `
const vec3 RING_GREEN_BASE = ${vec3(FIELD_GREENS.base)};
const vec3 RING_GREEN_DARK = ${vec3(FIELD_GREENS.dark)};
const vec3 RING_GREEN_DRY = ${vec3(FIELD_GREENS.dry)};
const vec3 RING_GREEN_LIGHT = ${vec3(FIELD_GREENS.light)};

/** Same odds as the tufts' pickTone: 8 % dry, then 20 % dark, 60 % base, 20 % light. */
vec3 pickRingTone(float roll, float jitter) {
  vec3 tone = RING_GREEN_LIGHT;
  if (roll < 0.08) tone = RING_GREEN_DRY;
  else if (roll < 0.264) tone = RING_GREEN_DARK;
  else if (roll < 0.816) tone = RING_GREEN_BASE;
  return tone * (0.94 + jitter * 0.12);
}
`;
