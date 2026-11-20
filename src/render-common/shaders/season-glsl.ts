import {
  AUTUMN_LEAF_LUMA,
  AUTUMN_LUMA_RANGE,
  AUTUMN_PALETTES,
  DORMANT_KEEP,
  BARE_CROWN_TONE,
  DORMANT_SPRITE_HAZE,
  DORMANT_SPRITE_KEEP,
  DORMANT_TONES,
  MONSOON_DEEPEN,
  MONSOON_SATURATION,
  SEASON_CLASS,
  SEASON_CLASS_COUNT,
  type SeasonClass,
  SPRING_PALETTES
} from "../seasonal-appearance/season-palettes";
import { SEASONAL_LEAF_U_RANGE } from "../props/mesh-builder";
import { SEASON_SPECIES_REGIONS } from "../trees/foliage-atlas";
import { SEASON_UNIFORM_GLSL } from "./season-uniform-glsl";
import { FOLIAGE_KIND_GLSL } from "./winter-glsl";

type Rgb = readonly [number, number, number];

const { birch, cherry } = SEASON_SPECIES_REGIONS;
const glslFloat = (value: number) => value.toFixed(4);
const glslVec3 = (tone: Rgb) => `vec3(${tone.map(glslFloat).join(", ")})`;
const classIndices = Array.from({ length: SEASON_CLASS_COUNT }, (_, index) => index as SeasonClass);
const toneTable = (tones: (seasonClass: SeasonClass) => readonly Rgb[]) =>
  classIndices.map(seasonClass => tones(seasonClass).map(glslVec3).join(", ")).join(",\n  ");

/**
 * Per-tree and per-cluster picks for the season tint (vertex stage, SEASONAL programs only): x the
 * tree (instance phase), y the leaf cluster (noise of the prop-space position, so it never swims with
 * the wind), zw a leaf-scale prop-space spot for the spring bud noise. Needs NOISE_GLSL.
 */
export const SEASON_PICK_VERTEX_GLSL = `
vec4 getSeasonPick(vec3 position, float phase) {
  float tree = fract(phase * 0.6180339 + 0.37);
  float cluster = valueNoise(position.xz * 2.3 + position.y * 1.7 + tree * 41.0);
  return vec4(tree, cluster, position.xz * 9.0 + position.y * 6.3 + tree * 17.0);
}
`;

/**
 * The season tones (declares uSeason: x autumn, y dormant, z spring, w monsoon). Each recolour keeps the
 * leaf texture's luminance (veins, folds); clusters change at their own point of a blend and trees lean
 * to their own tone. Dormant drops clusters (a kept share per class, dry brown), spring regrows them as
 * light green buds over the whole crown (bare -> small young leaves -> full).
 */
const SEASON_TONES_GLSL = `
#ifndef SEASON_TONES
#define SEASON_TONES
${SEASON_UNIFORM_GLSL}
const vec3 AUTUMN_TONES[${SEASON_CLASS_COUNT * 3}] = vec3[](${toneTable(seasonClass => AUTUMN_PALETTES[seasonClass])});
const vec3 SPRING_TONES[${SEASON_CLASS_COUNT * 2}] = vec3[](${toneTable(seasonClass => SPRING_PALETTES[seasonClass])});
const float DORMANT_KEEP[${SEASON_CLASS_COUNT}] = float[](${classIndices.map(index => glslFloat(DORMANT_KEEP[index]))
    .join(", ")});
const vec3 DORMANT_TONES[2] = vec3[](${DORMANT_TONES.map(glslVec3).join(", ")});

/** The leaf texture's luminance relative to an ordinary summer leaf (kept by every recolour). */
float getLeafLight(vec3 albedo) {
  float luma = dot(albedo, vec3(0.3, 0.59, 0.11));
  return clamp(luma / ${glslFloat(AUTUMN_LEAF_LUMA)}, ${glslFloat(AUTUMN_LUMA_RANGE[0])},
    ${glslFloat(AUTUMN_LUMA_RANGE[1])});
}

/** The autumn tone of a cluster: mostly base, some hot, a few pale; each tree shifts the mix. */
vec3 getAutumnTone(int seasonClass, vec2 pick) {
  int first = seasonClass * 3;
  float lean = (pick.x - 0.5) * 0.35;
  vec3 tone = AUTUMN_TONES[first];
  tone = mix(tone, AUTUMN_TONES[first + 1], step(0.62 + lean, pick.y));
  return mix(tone, AUTUMN_TONES[first + 2], step(0.88 + lean * 0.5, pick.y));
}

vec3 turnAutumn(vec3 albedo, int seasonClass, vec2 pick) {
  if (uSeason.x <= 0.0) return albedo;
  float start = pick.y * 0.55 + pick.x * 0.15;
  float turned = smoothstep(start, start + 0.3, uSeason.x);
  return mix(albedo, getAutumnTone(seasonClass, pick) * getLeafLight(albedo), turned);
}

/** 0 while the leaves fall (autumn -> winter), 1 once the spring weight starts the bud-out. */
float getBudMode() {
  return smoothstep(0.0, 0.3, uSeason.z);
}

/** Dormant: the clinging leaves dry to russet or tan; the buds of the bud-out are never dry. */
vec3 turnDormant(vec3 albedo, vec2 pick) {
  float dry = uSeason.y * (1.0 - getBudMode());
  if (dry <= 0.0) return albedo;
  vec3 tone = mix(DORMANT_TONES[0], DORMANT_TONES[1], step(0.6, fract(pick.y * 7.0 + pick.x * 3.0)));
  return mix(albedo, tone * getLeafLight(albedo), dry);
}

/** Spring: young light green leaves (a second, yellower flush); cherry sprays keep their painted blossom. */
vec3 turnSpring(vec3 albedo, int seasonClass, vec2 pick) {
  if (uSeason.z <= 0.0 || seasonClass == ${SEASON_CLASS.cherry}) return albedo;
  int first = seasonClass * 2;
  float flush = step(0.7 + (pick.x - 0.5) * 0.3, pick.y);
  vec3 young = mix(SPRING_TONES[first], SPRING_TONES[first + 1], flush) * min(getLeafLight(albedo), 1.0);
  return mix(albedo, young, uSeason.z);
}

/** Monsoon: deep, saturated wet green (more saturation, darker); cherry sprays keep their painted blossom. */
vec3 turnMonsoon(vec3 albedo, int seasonClass) {
  if (uSeason.w <= 0.0 || seasonClass == ${SEASON_CLASS.cherry}) return albedo;
  vec3 grey = vec3(dot(albedo, vec3(0.3, 0.59, 0.11)));
  vec3 lush = max(mix(grey, albedo, ${glslFloat(1 + MONSOON_SATURATION)}), 0.0) * ${glslVec3(MONSOON_DEEPEN)};
  return mix(albedo, lush, uSeason.w);
}

vec3 turnSeason(vec3 albedo, int seasonClass, vec2 pick) {
  vec3 seasonal = turnSpring(turnDormant(turnAutumn(albedo, seasonClass, pick), pick), seasonClass, pick);
  return turnMonsoon(seasonal, seasonClass);
}

/** True while no season changes the leaves (summer, the dry season). */
bool isSummerLook() {
  return uSeason.x + uSeason.y + uSeason.z + uSeason.w <= 0.0;
}

/**
 * 1 keeps a leaf fragment. Leaf fall drops whole clusters (low cluster picks first, the turn order of
 * autumn) down to \`kept\`; the bud-out regrows the crown leaf by leaf from \`bud\` noise, so it first
 * shows small scattered young leaves and fills in as the dormant weight falls.
 */
float getDormantKeep(float kept, float cluster, float bud) {
  float dormant = uSeason.y;
  if (dormant <= 0.0) return 1.0;
  float drop = dormant * (1.0 - kept);
  float fall = smoothstep(drop - 0.03, drop + 0.03, cluster);
  float grow = smoothstep(dormant - 0.08, dormant + 0.02, bud * 0.7 + cluster * 0.3);
  return mix(fall, grow, getBudMode());
}
#endif
`;

/**
 * The season on the 3D props (seasons plan 11-12): broadleaf leaves of a seasonal material class turn
 * (autumn, dormant, spring) and drop (dormant). Wood, needles, palms and class 0 never change. Needs the
 * material's uSeasonClass and the vertex stage's getSeasonPick.
 */
export const SEASON_FOLIAGE_GLSL = `
${FOLIAGE_KIND_GLSL}
${SEASON_TONES_GLSL}
uniform float uSeasonClass;

bool isSeasonalPlainLeaf(vec2 uv) {
  return uv.x > ${glslFloat(SEASONAL_LEAF_U_RANGE[0])} && uv.x < ${glslFloat(SEASONAL_LEAF_U_RANGE[1])};
}

/**
 * The species class at an atlas uv: the birch strip and cherry sprays name their own species; the plain
 * seasonal leaves (SEASONAL_LEAF_UV, vertex-coloured shrub leaves) take the material's class.
 */
int getSeasonClass(vec2 uv) {
  if (isSeasonalPlainLeaf(uv)) return int(uSeasonClass + 0.5);
  if (getFoliageKind(uv) < FOLIAGE_BROADLEAF) return ${SEASON_CLASS.none};
  if (uv.x >= 0.0 && uv.y >= ${glslFloat(birch.v0)}) return ${SEASON_CLASS.birch};
  bool inCherry = uv.x >= ${glslFloat(cherry.u0)} && uv.x < ${glslFloat(cherry.u1)}
    && uv.y >= ${glslFloat(cherry.v0)} && uv.y < ${glslFloat(cherry.v1)};
  if (inCherry) return ${SEASON_CLASS.cherry};
  return int(uSeasonClass + 0.5);
}

float getFoliageKeep(int seasonClass, vec4 pick) {
  return getDormantKeep(DORMANT_KEEP[seasonClass], pick.y, valueNoise(pick.zw));
}

/** The sun-depth pass: 1 where the leaf fragment stays (dormant crowns cast thin shadows). */
float getSeasonFoliageKeep(vec2 uv, vec4 pick) {
  if (uSeason.y <= 0.0) return 1.0;
  int seasonClass = getSeasonClass(uv);
  if (seasonClass == ${SEASON_CLASS.none}) return 1.0;
  return getFoliageKeep(seasonClass, pick);
}

/** rgb: the season albedo; a: the leaf keep (multiplies the coverage). */
vec4 applySeasonFoliage(vec3 albedo, vec2 uv, vec4 pick) {
  if (isSummerLook()) return vec4(albedo, 1.0);
  int seasonClass = getSeasonClass(uv);
  if (seasonClass == ${SEASON_CLASS.none}) return vec4(albedo, 1.0);
  return vec4(turnSeason(albedo, seasonClass, pick.xy), getFoliageKeep(seasonClass, pick));
}
`;

/**
 * The far sprites (impostors, tree views): the class comes from the instance; leaves are the bake's
 * leaf texels (normal-map alpha 1) or green-dominant texels (the vertex-coloured hardwood leaves bake as
 * wood). The cluster pick is sprite-texel noise. The bake has no branches behind its leaves, so a dormant
 * sprite keeps a few dry clusters and shows the rest of its crown as a thinned grey-brown twig haze.
 * Needs NOISE_GLSL. rgb: the season albedo, a: 0 where the haze is open.
 */
export const SEASON_SPRITE_GLSL = `
${SEASON_TONES_GLSL}
const vec3 BARE_CROWN_TONE = ${glslVec3(BARE_CROWN_TONE)};
vec4 applySeasonSprite(vec3 albedo, float seasonClass, float leafClass, float phase, vec2 texel) {
  if (isSummerLook() || seasonClass < 0.5) return vec4(albedo, 1.0);
  float leaf = max(step(0.75, leafClass), smoothstep(0.01, 0.06, albedo.g - max(albedo.r, albedo.b)));
  if (leaf <= 0.0) return vec4(albedo, 1.0);
  vec2 pick = vec2(fract(phase * 0.6180339 + 0.37), valueNoise(texel * 0.09));
  vec3 turned = turnSeason(albedo, int(seasonClass + 0.5), pick);
  float clinging = getDormantKeep(${glslFloat(DORMANT_SPRITE_KEEP)}, pick.y, valueNoise(texel * 0.6));
  vec3 haze = BARE_CROWN_TONE * clamp(getLeafLight(albedo), 0.6, 1.0);
  float open = step(valueNoise(texel * 0.35), uSeason.y * ${glslFloat(DORMANT_SPRITE_HAZE)}) * (1.0 - clinging);
  vec3 crown = mix(haze, turned, clinging);
  return vec4(mix(albedo, crown, leaf), 1.0 - open * step(0.5, leaf));
}
`;
