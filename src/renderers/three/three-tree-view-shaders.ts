import { TREE_VIEW_AZIMUTHS, TREE_VIEW_ELEVATIONS } from "../../render-common/baker/tree-view-layout";
import { SNOW_MAP_GLSL } from "../../render-common/snow-map";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { LEAF_LIGHT_GLSL } from "../../render-common/shaders/leaf-glsl";
import { PROP_FOG_GLSL, PROP_SHADING_GLSL, WIND_GLSL } from "../../render-common/shaders/prop-glsl";
import { SEASON_SPRITE_GLSL } from "../../render-common/shaders/season-glsl";
import { PROP_SNOW_GLSL } from "../../render-common/shaders/season-ground-glsl";
import { WINTER_TREE_GLSL } from "../../render-common/shaders/winter-glsl";
import { IMPOSTOR_TEXEL_GLSL } from "./three-impostors";
import { SUN_SHADOW_GLSL } from "./three-shadows";

/** Rotation about y of the instance (three.js makeRotationY convention). */
const ROTATE_Y_GLSL = `
vec3 rotateY(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * value.x + s * value.z, value.y, -s * value.x + c * value.z);
}
`;

const AZIMUTH_STEP = (Math.PI * 2 / TREE_VIEW_AZIMUTHS).toFixed(6);
const ELEVATION_STEP = (TREE_VIEW_ELEVATIONS[1]! - TREE_VIEW_ELEVATIONS[0]!).toFixed(6);
const LAST_ROW = (TREE_VIEW_ELEVATIONS.length - 1).toFixed(1);

/**
 * R15a view blocks: the quad faces the eye through the tree's axis; each of the (up to) four
 * nearest baked views is sampled where the eye ray's point on the quad projects into that view,
 * so the blend between azimuths and elevations stays registered while the eye walks around.
 * Basis convention: getTreeViewBasis (tree-view-baker.ts).
 */
export const TREE_VIEW_VERTEX_GLSL = `
precision highp float;
in vec2 corner;
in vec3 anchor;
in vec4 transform;
in vec4 block;
in vec2 bareBlock;
in vec4 bounds;
in vec4 params;
in vec3 tint;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uChunkMask;
uniform float uChunksX;
uniform float uMaskEnabled;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${WIND_GLSL}
#ifdef WINTER
${SNOW_MAP_GLSL}
#endif
const float AZIMUTH_STEP = ${AZIMUTH_STEP};
const float ELEVATION_STEP = ${ELEVATION_STEP};
const float LAST_ROW = ${LAST_ROW};
const float AZIMUTHS = ${TREE_VIEW_AZIMUTHS.toFixed(1)};
out vec4 vLocal01;
out vec4 vLocal23;
out vec3 vWorld;
out vec2 vSpot;
flat out vec4 vBase01;
flat out vec4 vBase23;
flat out vec4 vWeights;
flat out vec4 vParams;
flat out vec3 vTint;
flat out vec2 vFrameSize;
/** The season class (bounds.w / 2) and the tree's phase for the autumn tint. */
flat out vec2 vSeason;

bool isChunkHidden() {
  if (uMaskEnabled < 0.5 || uChunksX < 0.5) return false;
  int chunkIndex = int(params.z + 0.5);
  int chunksX = int(uChunksX + 0.5);
  return texelFetch(uChunkMask, ivec2(chunkIndex % chunksX, chunkIndex / chunksX), 0).r < 0.5;
}

vec2 viewRange(float elevation) {
  float c = cos(elevation);
  float s = sin(elevation);
  return vec2(bounds.y * c - bounds.x * s, bounds.z * c + bounds.x * s);
}

/** Position inside a baked frame (0..1 on both axes) of a mesh-space point. */
vec2 frameLocal(vec3 point, float column, float row) {
  float azimuth = column * AZIMUTH_STEP;
  float elevation = row * ELEVATION_STEP;
  vec3 right = vec3(cos(azimuth), 0.0, -sin(azimuth));
  vec3 up = vec3(-sin(elevation) * sin(azimuth), cos(elevation), -sin(elevation) * cos(azimuth));
  vec2 range = viewRange(elevation);
  return vec2((dot(point, right) + bounds.x) / (2.0 * bounds.x),
    (dot(point, up) - range.x) / (range.y - range.x));
}

${ROTATE_Y_GLSL}

bool isBare() {
#ifdef WINTER
  float winter = getSnowMap(anchor.xz);
  return winter * 0.88 > fract(transform.w * 0.15915494 + 0.37);
#else
  return false;
#endif
}

void main() {
  if (params.w < 0.5 || isChunkHidden()) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float scale = transform.y;
  float heightScale = scale * transform.z;
  vec3 eye = -transpose(mat3(viewMatrix)) * viewMatrix[3].xyz;
  vec3 center = anchor + vec3(0.0, 0.5 * (bounds.y + bounds.z) * heightScale, 0.0);
  vec3 toEye = rotateY(normalize(eye - center), -transform.x);
  float azimuth = atan(toEye.x, toEye.z);
  float elevation = asin(clamp(toEye.y, 0.0, 1.0));
  vec3 right = vec3(cos(azimuth), 0.0, -sin(azimuth));
  vec3 up = vec3(-sin(elevation) * sin(azimuth), cos(elevation), -sin(elevation) * cos(azimuth));
  vec2 range = viewRange(elevation);
  vec2 quad = vec2(mix(-bounds.x, bounds.x, corner.x), mix(range.x, range.y, corner.y));
  vec3 point = right * quad.x + up * quad.y;
  float column = mod(azimuth / AZIMUTH_STEP + AZIMUTHS, AZIMUTHS);
  float column0 = floor(column);
  float column1 = mod(column0 + 1.0, AZIMUTHS);
  float row = clamp(elevation / ELEVATION_STEP, 0.0, LAST_ROW);
#ifdef VIEW_ELEVATION_BLEND
  float row0 = floor(row);
  float row1 = min(row0 + 1.0, LAST_ROW);
  float elevationBlend = row - row0;
#else
  float row0 = floor(row + 0.5);
  float row1 = row0;
  float elevationBlend = 0.0;
#endif
  float azimuthBlend = column - column0;
  vWeights = vec4((1.0 - azimuthBlend) * (1.0 - elevationBlend), azimuthBlend * (1.0 - elevationBlend),
    (1.0 - azimuthBlend) * elevationBlend, azimuthBlend * elevationBlend);
  vLocal01 = vec4(frameLocal(point, column0, row0), frameLocal(point, column1, row0));
  vLocal23 = vec4(frameLocal(point, column0, row1), frameLocal(point, column1, row1));
  vec2 origin = isBare() ? bareBlock : block.xy;
  vBase01 = vec4(origin + vec2(column0, row0) * block.zw, origin + vec2(column1, row0) * block.zw);
  vBase23 = vec4(origin + vec2(column0, row1) * block.zw, origin + vec2(column1, row1) * block.zw);
  vec3 world = anchor + rotateY(point * vec3(scale, heightScale, scale), transform.x);
  float height = clamp(corner.y, 0.0, 1.0);
  world.xz += windDisplacement(anchor.xz, transform.w, uTime) * height * height * scale;
  vWorld = world;
  vSpot = quad * 24.0;
  vParams = vec4(params.xy, transform.x, mod(bounds.w, 2.0));
  vSeason = vec2(floor(bounds.w * 0.5 + 0.25), transform.w);
  vTint = tint;
  vFrameSize = block.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const TREE_VIEW_FRAGMENT_GLSL = `
precision highp float;
in vec4 vLocal01;
in vec4 vLocal23;
in vec3 vWorld;
in vec2 vSpot;
flat in vec4 vBase01;
flat in vec4 vBase23;
flat in vec4 vWeights;
flat in vec4 vParams;
flat in vec3 vTint;
flat in vec2 vFrameSize;
flat in vec2 vSeason;
uniform sampler2D uViewAlbedo;
uniform sampler2D uViewNormal;
/** Transparent frame border (texels): the eye ray's point maps inside it. */
uniform vec2 uMarginTexels;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_SHADING_GLSL}
${LEAF_LIGHT_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${IMPOSTOR_TEXEL_GLSL}
${ROTATE_Y_GLSL}
#ifdef WINTER
${WINTER_TREE_GLSL}
${PROP_SNOW_GLSL}
#endif
${SEASON_SPRITE_GLSL}

/** The bake's alpha cutoff: the mips keep the base coverage (and thin features) at exactly this cut. */
const float COVERAGE_CUT = 0.5;
vec4 albedoSum = vec4(0.0);
vec4 normalSum = vec4(0.0);

void addView(vec2 base, vec2 local, vec2 frameSize, float weight) {
  if (weight < 0.002 || any(lessThan(local, vec2(0.0))) || any(greaterThan(local, vec2(1.0)))) return;
  vec2 margin = uMarginTexels / vec2(textureSize(uViewAlbedo, 0));
  vec2 uv = base + margin + local * (frameSize - margin * 2.0);
  vec4 albedo = texture(uViewAlbedo, uv);
  vec4 normal = texture(uViewNormal, uv);
  float coverage = albedo.a * weight;
  albedoSum += vec4(albedo.rgb * coverage, coverage);
  normalSum += vec4((normal.xyz * 2.0 - 1.0) * coverage, normal.a * coverage);
}

void main() {
  if (isHiddenByFog(vParams.y, vWorld.xz)) discard;
  addView(vBase01.xy, vLocal01.xy, vFrameSize, vWeights.x);
  addView(vBase01.zw, vLocal01.zw, vFrameSize, vWeights.y);
#ifdef VIEW_ELEVATION_BLEND
  addView(vBase23.xy, vLocal23.xy, vFrameSize, vWeights.z);
  addView(vBase23.zw, vLocal23.zw, vFrameSize, vWeights.w);
#endif
  // The alpha test follows the dominant view: a thin frond that only one of two blended views
  // covers stays (a plain 0.5 cut on the blend would keep only where the views agree).
  float dominant = max(max(vWeights.x, vWeights.y), max(vWeights.z, vWeights.w));
  if (albedoSum.a < COVERAGE_CUT * dominant) discard;
  vec3 albedo = albedoSum.rgb / albedoSum.a;
  float leafClass = normalSum.a / albedoSum.a;
  vec3 normal = normalize(rotateY(normalSum.xyz, vParams.z));
#ifdef WINTER
  float winter = getSnowMap(vWorld.xz);
  float kind = leafClass > 0.75 ? vParams.w : FOLIAGE_WOOD;
  float snow = getPropSnow(vWorld, winter);
  float load = getFoliageSnowLoad(kind, winter, snow);
  albedo = addTreeSnow(getWinterFoliageSnow(albedo, kind, winter, snow), getTreeSnow(load, normal, vSpot * 0.2));
#endif
  vec4 season = applySeasonSprite(albedo, vSeason.x, leafClass, vSeason.y, vSpot);
  if (season.a < 0.5) discard;
  albedo = season.rgb;
  float sunVisibility = bakedSunVisibility(vParams.x) * sampleSunShadow(vWorld);
  vec3 lit = shadeImpostorTexel(albedo * vTint, normal, leafClass, sunVisibility, vWorld, vParams.y);
  fragColor = vec4(finishSurface(lit, vWorld), 1.0);
}
`;
