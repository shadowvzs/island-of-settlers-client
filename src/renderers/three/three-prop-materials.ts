import { DoubleSide, GLSL3, type IUniform,RawShaderMaterial, Vector4 } from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import type { SeasonClass } from "../../render-common/seasonal-appearance/season-palettes";
import { SPRING_BLOOM_GLSL } from "../../render-common/seasonal-appearance/spring-bloom";
import { RAIN_LUSH_TINT_GLSL } from "../../render-common/shaders/ground-common-glsl";
import { SCORCH_GRASS_GLSL } from "../../render-common/shaders/ground-scorch-glsl";
import { GRASS_RING_SHARE_GLSL } from "../../render-common/shaders/grass-ring-glsl";
import {
  LEAF_GLSL,
  PROP_CHOP_GLSL,
  PROP_FOG_GLSL,
  PROP_SHADING_GLSL,
  WIND_GLSL
} from "../../render-common/shaders/prop-glsl";
import { SEASON_FOLIAGE_GLSL, SEASON_PICK_VERTEX_GLSL } from "../../render-common/shaders/season-glsl";
import {
  PROP_SNOW_GLSL,
  SEASON_GROUND_UNIFORMS_GLSL,
  SEASON_SNOW_TUFT_GLSL
} from "../../render-common/shaders/season-ground-glsl";
import { SEASON_UNIFORM_GLSL } from "../../render-common/shaders/season-uniform-glsl";
import { TRAFFIC_GRASS_GLSL, TRAFFIC_WEAR_FIELD_GLSL } from "../../render-common/shaders/traffic-wear-glsl";
import { WINTER_TREE_GLSL } from "../../render-common/shaders/winter-glsl";
import { GRASS_RANGE_OFF,GRASS_RANK_BAND } from "./grass-range";
import { BIRCH_SHADING_GLSL } from "./three-birch-shading";
import { CONIFER_SHADING_GLSL } from "./three-conifer-shading";
import { PALM_SHADING_GLSL } from "./three-palm-shading";
import { SUN_SHADOW_GLSL } from "./three-shadows";
import { SHELL_SHADING_GLSL } from "./three-shell-shading";
import { TREE_SHADING_GLSL } from "./three-tree-shading";

/**
 * Instanced prop vertex: flutter in prop space, wind sway in world space, scaled per instance.
 * instanceData.w > 0.5 hides the instance (a felled tree, drawn by the felling layer instead);
 * PROP_CHOP adds the felling deformation (instanceChop).
 */
const PROP_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
in vec2 wind;
in vec2 uv;
in mat4 instanceMatrix;
in vec4 instanceData;
in vec3 instanceTint;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uGrassFade;
uniform float uIsGrass;
uniform vec4 uGrassRange;
/** OD-T6 ring hole (short-grass tufts only): eye x/z, ring radius, possession blend (0 = off). */
uniform vec4 uGrassHole;
/** The ring's shape (GRASS_RING_SHARE_GLSL: density, full-density distance, radius, tuft cover). */
uniform vec4 uGrassHoleShape;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${WIND_GLSL}
${PROP_FOG_GLSL}
${GRASS_RING_SHARE_GLSL}
${SEASON_GROUND_UNIFORMS_GLSL}
const float GRASS_RANK_BAND = ${GRASS_RANK_BAND.toFixed(2)};
/**
 * grass-band 2026-11-14: inside the possessed grass ring the tufts keep only the cover the ring's
 * blades no longer give, so they thin out and shrink towards the eye over a wide, noise-broken band.
 */
float getGrassHoleKeep(vec2 root) {
  if (uGrassHole.w <= 0.0) return 1.0;
  return mix(1.0, getRingTuftKeep(uGrassHoleShape, distance(root, uGrassHole.xy), root), uGrassHole.w);
}
/** 1 keeps a tuft whole, 0 removes it: nested by its rank (phase), thinning with eye distance. */
float getGrassKeep(vec2 root, float phase) {
  float keep = 1.0 - smoothstep(uGrassRange.z, uGrassRange.w, distance(root, uGrassRange.xy));
  keep *= getGrassHoleKeep(root);
  float rank = fract(phase * 0.15915494);
  return clamp((keep * (1.0 + GRASS_RANK_BAND) - rank) / GRASS_RANK_BAND, 0.0, 1.0);
}
#ifdef GRASS_COVER
${TRAFFIC_WEAR_FIELD_GLSL}
${TRAFFIC_GRASS_GLSL}
${SCORCH_GRASS_GLSL}
#ifdef SEASON_SNOW
${SEASON_SNOW_TUFT_GLSL}
#endif
#endif
#ifdef PROP_CHOP
in vec4 instanceChop;
${PROP_CHOP_GLSL}
#endif
#ifdef SEASONAL
${SEASON_PICK_VERTEX_GLSL}
out vec4 vSeasonPick;
#endif
#ifdef SPRING_BLOOM
${SEASON_UNIFORM_GLSL}
${SPRING_BLOOM_GLSL}
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec3 vInstance;
out vec2 vUv;

void main() {
  if (instanceData.w > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float grassKeep = uIsGrass > 0.5 ? getGrassKeep(instanceMatrix[3].xz, instanceData.x) : 1.0;
#ifdef GRASS_COVER
  if (isHiddenByFog(instanceData.z, instanceMatrix[3].xz)) grassKeep = 0.0;
  else grassKeep *= trafficGrassKeep(instanceMatrix[3].xz) * scorchGrassKeep(instanceMatrix[3].xz);
#ifdef SEASON_SNOW
  float tuftSnow = getSeasonTuftSnow(instanceMatrix[3].xz);
  grassKeep *= getSeasonTuftKeep(tuftSnow, instanceData.x);
#endif
#endif
#ifdef SPRING_BLOOM
  float bloom = getSpringBloom(instanceData.x);
  grassKeep *= bloom;
#endif
  if (grassKeep <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vUv = uv;
  float phase = instanceData.x;
  float fade = mix(1.0, uGrassFade, uIsGrass);
  vec3 sway = flutterOffset(position, phase, uTime) * wind.y + branchSway(position, phase, uTime) * wind.x;
  vec3 local = (position + sway) * vec3(1.0, fade, 1.0) * grassKeep;
  vec3 localNormal = normal;
  float standing = 1.0;
#ifdef PROP_CHOP
  vec3 fall = vec3(cos(instanceChop.z), 0.0, sin(instanceChop.z));
  vec3 fallDirection = normalize(transpose(mat3(instanceMatrix)) * fall);
  local = chopPropPosition(local, wind, instanceChop, fallDirection, uTime);
  localNormal = chopPropNormal(normal, instanceChop, fallDirection);
  standing = 1.0 - instanceChop.y;
#endif
  vec4 world = instanceMatrix * vec4(local, 1.0);
  float scale = length(instanceMatrix[0].xyz);
  world.xz += windDisplacement(instanceMatrix[3].xz, phase, uTime) * wind.x * scale * standing;
  vWorld = world.xyz;
  vNormal = normalize(mat3(instanceMatrix) * localNormal);
  vColor = color * instanceTint;
  // Keep the grass instance tint in step with the terrain's rain-lush macro tint.
  if (uIsGrass > 0.5) vColor *= mix(vec3(1.0), ${RAIN_LUSH_TINT_GLSL}, uRain);
#ifndef SPRING_BLOOM
  // The cosmetic season tints the tufts with the ground's meadow (C1); the tips turn first.
  if (uIsGrass > 0.5) vColor *= 1.0 + uSeasonMeadow.rgb * mix(0.6, 1.0, smoothstep(0.02, 0.3, position.y));
#endif
#if defined(GRASS_COVER) && defined(SEASON_SNOW)
  vColor = coverTuftWithSnow(vColor, tuftSnow);
#endif
#ifdef SPRING_BLOOM
  // A spring flower opens from a small green bud to its petal colour.
  vColor = mix(SPRING_BUD * instanceTint, vColor, smoothstep(0.35, 1.0, bloom));
#endif
  vInstance = instanceData.yzw;
#ifdef SEASONAL
  vSeasonPick = getSeasonPick(position, phase);
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PROP_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec3 vInstance;
in vec2 vUv;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_SHADING_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${LEAF_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${TREE_SHADING_GLSL}
${BIRCH_SHADING_GLSL}
${CONIFER_SHADING_GLSL}
${PALM_SHADING_GLSL}
${SHELL_SHADING_GLSL}
#ifdef WINTER
${WINTER_TREE_GLSL}
${PROP_SNOW_GLSL}
#endif
#ifdef SEASONAL
in vec4 vSeasonPick;
${SEASON_FOLIAGE_GLSL}
#endif

/** Bark relief on tree wood, leaf light on atlas cards, the plain prop light elsewhere. */
vec3 lightPropSurface(vec3 albedo, vec3 normal, float sunVisibility) {
  if (vUv.x > -1.4 && vUv.x < -1.1) return lightLeaf(albedo, normal, sunVisibility, vWorld.xz);
  if (isShellSurface(vUv)) return lightShell(albedo, normal, vUv, vWorld, sunVisibility);
  if (isBirchBark(vUv)) return lightBirchBark(albedo, normal, vUv, vWorld, sunVisibility);
  if (isConiferBark(vUv)) return lightConiferBark(albedo, normal, vUv, vWorld, sunVisibility);
  if (isPalmBark(vUv)) return lightPalmBark(albedo, normal, vUv, vWorld, sunVisibility);
  if (isBark(vUv)) return lightBark(albedo, normal, vUv, vWorld, sunVisibility);
  if (isLeafAtlasUv(vUv)) return lightLeaf(albedo, normal, sunVisibility, vWorld.xz);
  return lightProp(albedo, normal, sunVisibility, vWorld.xz);
}

void main() {
#ifndef GRASS_COVER
  if (isHiddenByFog(vInstance.y, vWorld.xz)) discard;
#endif
  vec4 leaf = sampleLeaf(vUv);
  float coverage = sharpenCoverage(leaf.a);
  vec3 albedo = vColor * leaf.rgb;
#ifdef SEASONAL
  vec4 season = applySeasonFoliage(albedo, vUv, vSeasonPick);
  albedo = season.rgb;
  coverage *= season.a;
#endif
  vec3 normal = normalize(vNormal);
  if (isLeafAtlasUv(vUv)) {
    coverage *= getCardFacing(vWorld);
    normal = perturbLeafNormal(normal, vWorld, vUv);
  }
#ifdef WINTER
  float winter = getSnowMap(vWorld.xz);
  float kind = getFoliageKind(vUv);
  coverage *= keepWinterLeaf(kind, winter, vWorld);
  albedo = applyWinterTreeSnow(albedo, kind, winter, getPropSnow(vWorld, winter), normal, vWorld);
#endif
#ifndef GRASS_COVER
  if (coverage < 0.02) discard;
#endif
  float sunVisibility = bakedSunVisibility(vInstance.x) * sampleSunShadow(vWorld);
  vec3 lit = lightPropSurface(albedo, normal, sunVisibility);
  fragColor = vec4(finishSurface(applyFogOfWar(lit, vInstance.y, vWorld.xz), vWorld), coverage);
}
`;

/**
 * Depth only pass from the sun: same vertex code, so shadows sway with the trees; a seasonal class
 * drops the fallen dormant leaves from the shadow too.
 */
const DEPTH_FRAGMENT_GLSL = `
precision highp float;
in vec2 vUv;
in vec3 vInstance;
in vec3 vWorld;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LEAF_GLSL}
${PROP_FOG_GLSL}
#ifdef WINTER
${WINTER_TREE_GLSL}
#endif
#ifdef SEASONAL
in vec4 vSeasonPick;
${SEASON_FOLIAGE_GLSL}
#endif
void main() {
  if (isHiddenByFog(vInstance.y, vWorld.xz) || sampleLeaf(vUv).a < 0.5) discard;
#ifdef WINTER
  if (keepWinterLeaf(getFoliageKind(vUv), getSnowMap(vWorld.xz), vWorld) < 0.5) discard;
#endif
#ifdef SEASONAL
  if (getSeasonFoliageKeep(vUv, vSeasonPick) < 0.5) discard;
#endif
  fragColor = vec4(1.0);
}
`;

type SnowFlags = { hasSnow?: boolean; seasonSnow?: boolean } | undefined;
const getSnowFlags = (uniforms: Record<string, IUniform>): SnowFlags =>
  (uniforms.uSnowMap?.value as { userData?: SnowFlags } | null)?.userData;

/** True while the global season can show snow (T1): the GPU snow cover ramp is compiled (SEASON_SNOW). */
export const hasSeasonSnow = (uniforms: Record<string, IUniform>) => getSnowFlags(uniforms)?.seasonSnow === true;

/**
 * Winter code only where the world has snow or the global season can snow: the snow map texture carries those
 * flags (userData.hasSnow, userData.seasonSnow, set by the renderer), so snow free islands keep the plain shaders.
 */
export const hasWinter = (uniforms: Record<string, IUniform>) =>
  getSnowFlags(uniforms)?.hasSnow === true || hasSeasonSnow(uniforms);

/**
 * WINTER and SEASON_SNOW of a sprite or prop material. The grass cover keeps WINTER off (it only grows in sheltered
 * spots of a snowy area) but thins under the global season's snow.
 */
export const getWinterDefines = (uniforms: Record<string, IUniform>, grass = false) => ({
  ...(hasSeasonSnow(uniforms) ? { SEASON_SNOW: "" } : {}),
  ...(!grass && hasWinter(uniforms) ? { WINTER: "" } : {})
});

const getDefines = (choppable: boolean, winter: Record<string, string>, grass = false, seasonal = false,
  bloom = false) => ({
  ...(bloom ? { SPRING_BLOOM: "" } : {}),
  ...(choppable ? { PROP_CHOP: "" } : {}),
  ...(grass ? { GRASS_COVER: "" } : {}),
  ...(seasonal ? { SEASONAL: "" } : {}),
  ...winter
});

/**
 * Leaves use alpha to coverage (MSAA): soft, sorted-free leaf edges. A season class other than 0
 * (season-palettes.ts) compiles the GPU season tint (SEASONAL); the shared uSeason uniform drives it.
 * `springBloom` (spring meadow flowers) opens each instance with the spring weight (SPRING_BLOOM).
 */
export const createPropMaterial = (
  uniforms: Record<string, IUniform>,
  isGrass: boolean,
  choppable = false,
  seasonClass: SeasonClass = 0,
  springBloom = false
) =>
  new RawShaderMaterial({
    alphaToCoverage: !isGrass,
    defines: getDefines(choppable, getWinterDefines(uniforms, isGrass), isGrass, seasonClass > 0, springBloom),
    fragmentShader: PROP_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms: {
      ...uniforms,
      uGrassHole: { value: new Vector4(0, 0, 0, 0) },
      uGrassHoleShape: { value: new Vector4(1, 3, 16, 1) },
      uGrassRange: { value: new Vector4(0, 0, GRASS_RANGE_OFF, GRASS_RANGE_OFF) },
      uIsGrass: { value: isGrass ? 1 : 0 },
      uSeasonClass: { value: seasonClass }
    },
    vertexShader: PROP_VERTEX_GLSL
  });

export const createPropDepthMaterial = (
  uniforms: Record<string, IUniform>,
  choppable = false,
  seasonClass: SeasonClass = 0
) =>
  new RawShaderMaterial({
    defines: getDefines(choppable, getWinterDefines(uniforms), false, seasonClass > 0),
    fragmentShader: DEPTH_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms: {
      ...uniforms,
      uGrassHole: { value: new Vector4(0, 0, 0, 0) },
      uGrassHoleShape: { value: new Vector4(1, 3, 16, 1) },
      uGrassRange: { value: new Vector4(0, 0, GRASS_RANGE_OFF, GRASS_RANGE_OFF) },
      uIsGrass: { value: 0 },
      uSeasonClass: { value: seasonClass }
    },
    vertexShader: PROP_VERTEX_GLSL
  });
