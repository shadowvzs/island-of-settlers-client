import { SNOW_MAP_GLSL } from "../snow-map";
import { SNOW_PALETTE_GLSL } from "../snow-palette";
import { EVERGREEN_REGIONS } from "../trees/foliage-atlas";
import { LEAF_ATLAS_UV_GLSL } from "./leaf-glsl";

const { needles, palms } = EVERGREEN_REGIONS;

/** Foliage kinds of getFoliageKind (shared with the TSL prop material). */
export const FOLIAGE_KIND = { broadleaf: 1, evergreen: 0.5, wood: 0 } as const;

/**
 * Winter tree shading constants (WINTER_TREE_GLSL and its TSL twin): dry leaf and needle tints,
 * the luma weights of the dry leaf, the kept broadleaf share and the clump-noise spot scales. seasonLeafSnow is the
 * share of the global season's snow load that settles on broadleaf leaves (seasons-5: evergreen broadleaf crowns such
 * as mahogany carry a light dusting, not the white specks that read as blossom); twigs and needles take the full load.
 */
export const WINTER_TREE = {
  dryLeaf: [0.36, 0.25, 0.14],
  dryLeafLuma: { base: 0.6, gain: 2.5, weights: [0.3, 0.59, 0.11] },
  keptBroadleaf: 0.12,
  keepSpot: { xz: 4.3, y: 3.7 },
  needles: [0.62, 0.72, 0.76],
  seasonLeafSnow: 0.35,
  snowSpot: { xz: 2.7, y: 1.9 }
} as const;

const glslVec3 = (rgb: readonly number[]) => `vec3(${rgb.join(", ")})`;
const { dryLeafLuma, keepSpot, snowSpot } = WINTER_TREE;

/**
 * Foliage kind of an atlas uv (the sprite bake and the 3D props): 0 wood or untextured,
 * 0.5 evergreen (needles, palm fronds), 1 broadleaf (bare in winter).
 */
export const FOLIAGE_KIND_GLSL = `
#ifndef FOLIAGE_KIND
#define FOLIAGE_KIND
const float FOLIAGE_WOOD = ${FOLIAGE_KIND.wood.toFixed(1)};
const float FOLIAGE_EVERGREEN = ${FOLIAGE_KIND.evergreen.toFixed(1)};
const float FOLIAGE_BROADLEAF = ${FOLIAGE_KIND.broadleaf.toFixed(1)};
${LEAF_ATLAS_UV_GLSL}

float getFoliageKind(vec2 uv) {
  if (uv.x > -1.4 && uv.x < -1.1) return FOLIAGE_BROADLEAF;
  if (!isLeafAtlasUv(uv)) return FOLIAGE_WOOD;
  bool needles = uv.x < ${needles.u1.toFixed(4)} && uv.y >= ${needles.v0.toFixed(4)}
    && uv.y < ${needles.v1.toFixed(4)};
  bool palms = uv.y >= ${palms.v0.toFixed(4)} && uv.y < ${palms.v1.toFixed(4)};
  return needles || palms ? FOLIAGE_EVERGREEN : FOLIAGE_BROADLEAF;
}
#endif
`;

/**
 * Winter trees, shared by the tree materials (needs COMMON_UNIFORMS and NOISE): `winter` is the
 * snow map at the tree (0 outside snowy areas), `spot` a coordinate for the clump noise (world or
 * sprite pixels). Snow settles on upward faces of crowns and branches in clumps, conifer needles
 * turn a darker, cooler green, and broadleaf crowns lose most leaves (the few left are dry
 * brown). The 3D crowns drop their leaves; the far impostors cannot show the branches behind
 * the leaves, so they thin and brown the crown.
 */
export const WINTER_TREE_GLSL = `
${FOLIAGE_KIND_GLSL}
${SNOW_MAP_GLSL}
const vec3 TREE_SNOW = ${SNOW_PALETTE_GLSL.treeSnow};
const vec3 DRY_LEAF = ${glslVec3(WINTER_TREE.dryLeaf)};
const vec3 WINTER_NEEDLES = ${glslVec3(WINTER_TREE.needles)};

/** Snow load 0..1: on faces turned up, in clumps; nothing outside winter areas. */
float getTreeSnow(float winter, vec3 normal, vec2 spot) {
  if (winter <= 0.0) return 0.0;
  float clumps = valueNoise(spot) - 0.5;
  return winter * smoothstep(0.2, 0.6, normal.y + clumps * 0.6);
}

/** 1 where a broadleaf leaf clump stays in winter (the kept share), 0 where it has fallen. */
float getWinterLeafKeep(float winter, vec2 spot, float kept) {
  if (winter <= 0.0) return 1.0;
  return step(winter * (1.0 - kept), valueNoise(spot));
}

/**
 * Winter colour of the foliage (kind from getFoliageKind) before the snow: needles cool with the snow load
 * (snow: theme or global season), broadleaf leaves dry with the area theme snow (winter) only.
 */
vec3 getWinterFoliageSnow(vec3 albedo, float kind, float winter, float snow) {
  if (kind <= FOLIAGE_WOOD) return albedo;
  if (kind < FOLIAGE_BROADLEAF) return snow <= 0.0 ? albedo : mix(albedo, albedo * WINTER_NEEDLES, snow);
  if (winter <= 0.0) return albedo;
  float luma = dot(albedo, ${glslVec3(dryLeafLuma.weights)});
  return mix(albedo, DRY_LEAF * (${dryLeafLuma.base} + luma * ${dryLeafLuma.gain.toFixed(1)}), winter);
}

vec3 getWinterFoliage(vec3 albedo, float kind, float winter) {
  return getWinterFoliageSnow(albedo, kind, winter, winter);
}

/** Snow load on this foliage kind: broadleaf leaves take the theme winter, or a share of the season's load. */
float getFoliageSnowLoad(float kind, float winter, float snow) {
  if (kind < FOLIAGE_BROADLEAF) return snow;
  return max(winter, snow * ${WINTER_TREE.seasonLeafSnow});
}

vec3 addTreeSnow(vec3 albedo, float snow) {
  return mix(albedo, TREE_SNOW, snow);
}

/** 3D crowns: 1 where the fragment's leaf clump stays, 0 where it has fallen. */
float keepWinterLeaf(float kind, float winter, vec3 world) {
  if (kind < FOLIAGE_BROADLEAF) return 1.0;
  return getWinterLeafKeep(winter, world.xz * ${keepSpot.xz} + world.y * ${keepSpot.y}, ${WINTER_TREE.keptBroadleaf});
}

/** 3D crowns and branches: winter foliage colour plus the snow load (theme winter, snow load). */
vec3 applyWinterTreeSnow(vec3 albedo, float kind, float winter, float snow, vec3 normal, vec3 world) {
  vec3 foliage = getWinterFoliageSnow(albedo, kind, winter, snow);
  float load = getFoliageSnowLoad(kind, winter, snow);
  return addTreeSnow(foliage, getTreeSnow(load, normal, world.xz * ${snowSpot.xz} + world.y * ${snowSpot.y}));
}

vec3 applyWinterTree(vec3 albedo, float kind, float winter, vec3 normal, vec3 world) {
  return applyWinterTreeSnow(albedo, kind, winter, winter, normal, world);
}

/** Kind from a baked (filtered) map value: wood, evergreen or broadleaf. */
float snapFoliageKind(float value) {
  return (step(0.25, value) + step(0.75, value)) * 0.5;
}

/**
 * A baked sprite pixel in winter (far impostors). bakedKind is the
 * blue channel of the bake's wind map, spot the pixel in atlas texels. rgb: the winter albedo,
 * a: 0 where a broadleaf clump has fallen (about half stay: a thinned, dry brown crown).
 */
vec4 getSpriteWinterSnow(vec3 albedo, vec3 normal, float bakedKind, float winter, float snow, vec2 spot) {
  float kind = snapFoliageKind(bakedKind);
  float keep = kind >= FOLIAGE_BROADLEAF ? getWinterLeafKeep(winter, spot * 0.3, 0.5) : 1.0;
  vec3 foliage = getWinterFoliageSnow(albedo, kind, winter, snow);
  float load = getFoliageSnowLoad(kind, winter, snow);
  return vec4(addTreeSnow(foliage, getTreeSnow(load, normal, spot * 0.2)), keep);
}

vec4 getSpriteWinter(vec3 albedo, vec3 normal, float bakedKind, float winter, vec2 spot) {
  return getSpriteWinterSnow(albedo, normal, bakedKind, winter, winter, spot);
}
`;
