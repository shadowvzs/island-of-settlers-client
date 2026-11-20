import {
  BufferAttribute,
  type DataTexture,
  DoubleSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial} from "three";

import type { BakedSprites, SpriteFrame } from "../../render-common/baker/prop-baker";
import { PIXELS_PER_UNIT } from "../../render-common/iso-projection";
import { isAdventurePropKind } from "../../render-common/props/adventure-prop-kinds";
import { TREE_KINDS } from "../../render-common/props/island-trees";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getMeshKind } from "../../render-common/props/prop-meshes";
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
import { PROP, PROP_TYPE_COUNT } from "../../shared/world/world-data";
import { excludeFromAmbientOcclusion } from "./ambient-occlusion-exclusion";
import { getMeshSeasonClass } from "./seasonal-prop-materials";
import { getWinterDefines } from "./three-prop-materials";
import { getDepthOnlyDefines, SUN_SHADOW_GLSL } from "./three-shadows";
import { getCullChunk } from "./three-visibility";

/** World prop kinds drawn as trees (their impostors follow felling and growth). */
export const TREE_KIND_SET = new Set<number>(TREE_KINDS);
const ROCK_KINDS = new Set<number>([PROP.smallRock, PROP.largeRock, PROP.pebbles]);

/** Far LOD sprites: trees and every world plant (rocks and render only cover stay 3D / hidden). */
export const isImpostorKind = (kind: number) => isAdventurePropKind(kind) ||
  kind >= 0 && kind < PROP_TYPE_COUNT && !ROCK_KINDS.has(kind);

/**
 * Light of a baked impostor texel (needs LIGHTING, FOG_OF_WAR, PROP_SHADING and LEAF_LIGHT): the
 * normal map's alpha marks leaves (1) or wood (0.5), like the 3D crown's leaf and prop light.
 */
export const IMPOSTOR_TEXEL_GLSL = `
vec3 shadeImpostorTexel(vec3 albedo, vec3 normal, float leafClass, float sunVisibility, vec3 world, float fog) {
  if (leafClass > 0.75) return applyFogOfWar(lightLeaf(albedo, normal, sunVisibility, world.xz), fog, world.xz);
  return shadeProp(albedo, normal, sunVisibility, world.xz, fog);
}
`;

/** tint.w of a sprite instance: bit 0 mirrors it, the rest is twice its season class. */
const SPRITE_FLAGS_GLSL = `
bool isMirrored(float flags) { return mod(flags, 2.0) > 0.5; }
float getSpriteSeasonClass(float flags) { return floor(flags * 0.5 + 0.25); }
`;

/** Billboard built from the camera's right and up axes; one baked pixel = 1 / PIXELS_PER_UNIT. */
const VERTEX_GLSL = `
precision highp float;
in vec2 corner;
in vec3 anchor;
in vec4 frame;
in vec4 rect;
in vec4 params;
in vec4 tint;
in float chunk;
in float isTree;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uChunkMask;
uniform float uChunksX;
uniform float uMaskEnabled;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${WIND_GLSL}
out vec2 vUv;
out vec3 vWorld;
out vec4 vParams;
out vec4 vTint;
${SPRITE_FLAGS_GLSL}

void main() {
  if (uMaskEnabled > 0.5 && uChunksX > 0.5) {
    int chunkIndex = int(chunk + 0.5);
    int chunksX = int(uChunksX + 0.5);
    vec2 masks = texelFetch(uChunkMask, ivec2(chunkIndex % chunksX, chunkIndex / chunksX), 0).rg;
    float visible = isTree > 0.5 ? masks.r : masks.g;
    if (visible < 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  }
  vec2 local = corner * frame.xy - frame.zw;
  if (isMirrored(tint.w)) local.x = -local.x;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = anchor + (right * local.x - up * local.y) / ${PIXELS_PER_UNIT.toFixed(4)};
  float height = clamp(-local.y / max(frame.w, 1.0), 0.0, 1.0);
  world.xz += windDisplacement(anchor.xz, params.x, uTime) * height * height * params.w;
  vUv = mix(rect.xy, rect.zw, corner);
  vWorld = world;
  vParams = params;
  vTint = tint;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec2 vUv;
in vec3 vWorld;
in vec4 vParams;
in vec4 vTint;
uniform sampler2D uSpriteAlbedo;
uniform sampler2D uSpriteNormal;
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
#ifdef WINTER
uniform sampler2D uSpriteWind;
${WINTER_TREE_GLSL}
${PROP_SNOW_GLSL}
#endif
${SPRITE_FLAGS_GLSL}
${SEASON_SPRITE_GLSL}

void main() {
  vec4 albedo = texture(uSpriteAlbedo, vUv);
  if (albedo.a < 0.5 || isHiddenByFog(vParams.z, vWorld.xz)) discard;
  vec4 normalSample = texture(uSpriteNormal, vUv);
  vec3 normal = normalSample.xyz * 2.0 - 1.0;
  if (isMirrored(vTint.w)) normal = normal.zyx;
#ifdef WINTER
  float kind = texture(uSpriteWind, vUv).b;
  vec2 texel = vUv * vec2(textureSize(uSpriteAlbedo, 0));
  float themeWinter = getSnowMap(vWorld.xz);
  vec4 winter = getSpriteWinterSnow(albedo.rgb, normal, kind, themeWinter, getPropSnow(vWorld, themeWinter), texel);
  if (winter.a < 0.5) discard;
  albedo.rgb = winter.rgb;
#endif
  vec4 season = applySeasonSprite(albedo.rgb, getSpriteSeasonClass(vTint.w), normalSample.a, vParams.x,
    vUv * vec2(textureSize(uSpriteAlbedo, 0)));
  if (season.a < 0.5) discard;
#ifdef DEPTH_ONLY
  fragColor = vec4(1.0);
#else
  albedo.rgb = season.rgb;
  float sunVisibility = bakedSunVisibility(vParams.y) * sampleSunShadow(vWorld);
  vec3 lit = shadeImpostorTexel(albedo.rgb * vTint.rgb, normalize(normal), normalSample.a, sunVisibility,
    vWorld, vParams.z);
  fragColor = vec4(finishSurface(lit, vWorld), 1.0);
#endif
}
`;

/** tint.w: the mirror flag (bit 0) plus twice the season class of the instance's prop kind. */
const getSpriteFlags = (instances: PropInstances, index: number) =>
  (instances.rotation[index]! > Math.PI ? 1 : 0) + 2 * getMeshSeasonClass(instances.meshIds[index]!);

const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint16Array([0, 2, 1, 0, 3, 2]);

/** Billboard size and pivot of a baked sprite at an instance scale. */
const getFrameValues = (sprite: SpriteFrame, scale: number, stretch: number) => [
  sprite.width * scale,
  sprite.height * scale * stretch,
  sprite.pivotX * scale,
  sprite.pivotY * scale * stretch
];

const getRectValues = (sprite: SpriteFrame) => [sprite.u0, sprite.v0, sprite.u1, sprite.v1];

const createGeometry = (
  instances: PropInstances,
  sprites: BakedSprites,
  trees: number[],
  chunksX?: number
) => {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("corner", new BufferAttribute(QUAD_CORNERS, 2));
  geometry.setIndex(new BufferAttribute(QUAD_INDICES, 1));
  const chunk = new Float32Array(trees.length);
  const isTree = new Float32Array(trees.length);
  const anchor = new Float32Array(trees.length * 3);
  const frame = new Float32Array(trees.length * 4);
  const rect = new Float32Array(trees.length * 4);
  const params = new Float32Array(trees.length * 4);
  const tint = new Float32Array(trees.length * 4);
  trees.forEach((index, slot) => {
    const sprite = sprites.sprites[instances.meshIds[index]!]!;
    const scale = instances.scale[index]!;
    anchor.set([instances.x[index]!, instances.y[index]!, instances.z[index]!], slot * 3);
    if (chunksX) chunk[slot] = getCullChunk(instances.x[index]!, instances.z[index]!, chunksX);
    isTree[slot] = TREE_KIND_SET.has(getMeshKind(instances.meshIds[index]!)) ? 1 : 0;
    frame.set(getFrameValues(sprite, scale, instances.stretch[index]!), slot * 4);
    rect.set(getRectValues(sprite), slot * 4);
    params.set(
      [instances.phase[index]!, instances.sunVisibility[index]!, instances.fog[index]!, scale],
      slot * 4
    );
    tint.set([instances.tint[index * 3]!, instances.tint[index * 3 + 1]!,
      instances.tint[index * 3 + 2]!, getSpriteFlags(instances, index)], slot * 4);
  });
  const attributes = {
    anchor: [anchor, 3],
    chunk: [chunk, 1],
    isTree: [isTree, 1],
    frame: [frame, 4],
    params: [params, 4],
    rect: [rect, 4],
    tint: [tint, 4]
  } as const;
  for (const [name, [array, size]] of Object.entries(attributes)) {
    geometry.setAttribute(name, new InstancedBufferAttribute(array, size));
  }
  geometry.instanceCount = trees.length;
  return geometry;
};

const writeSlot = (
  attribute: InstancedBufferAttribute,
  slot: number,
  values: ArrayLike<number>
) => {
  (attribute.array as Float32Array).set(values, slot * attribute.itemSize);
  attribute.addUpdateRange(slot * attribute.itemSize, attribute.itemSize);
  attribute.needsUpdate = true;
};

/**
 * Per tree edits of the quads: collapse one (a felled or growing tree is drawn elsewhere) or
 * restore it (the original frame is kept), and re-read its sprite after its mesh changed.
 */
const createTreeSlots = (
  geometry: InstancedBufferGeometry,
  instances: PropInstances,
  sprites: BakedSprites,
  trees: number[]
) => {
  const slots = new Map(trees.map((index, slot) => [instances.sourceIndex[index]!, slot]));
  const frame = geometry.getAttribute("frame") as InstancedBufferAttribute;
  const rect = geometry.getAttribute("rect") as InstancedBufferAttribute;
  const original = Float32Array.from(frame.array as Float32Array);
  const setVisible = (sourceIndex: number, visible: boolean) => {
    const slot = slots.get(sourceIndex);
    if (slot === undefined) return;
    writeSlot(frame, slot, visible ? original.subarray(slot * 4, slot * 4 + 4) : [0, 0, 0, 0]);
  };
  /**
   * A tree grew mature or went back to its world variant: its sprite follows its mesh id (the
   * new frame shows with the next setVisible).
   */
  const refresh = (sourceIndex: number) => {
    const slot = slots.get(sourceIndex);
    if (slot === undefined) return;
    const index = trees[slot]!;
    const anchor = geometry.getAttribute("anchor") as InstancedBufferAttribute;
    writeSlot(anchor, slot, [instances.x[index]!, instances.y[index]!, instances.z[index]!]);
    const sprite = sprites.sprites[instances.meshIds[index]!]!;
    original.set(getFrameValues(sprite, instances.scale[index]!, instances.stretch[index]!), slot * 4);
    writeSlot(rect, slot, getRectValues(sprite));
  };
  return { refresh, setVisible };
};

/**
 * The baked sprite maps: colour, normals and, on islands with snow, the wind map (its blue
 * channel holds the foliage kind for the winter crowns).
 */
export interface ImpostorTextures {
  albedo: DataTexture;
  normals: DataTexture;
  wind: DataTexture | null;
}

const createMaterial = (
  uniforms: Record<string, IUniform>,
  textures: ImpostorTextures,
  depthOnly: boolean
) => {
  const chunkMask = { value: null as DataTexture | null };
  const chunksX = { value: 0 };
  const maskEnabled = { value: 0 };
  const material = new RawShaderMaterial({
    defines: {
      ...getDepthOnlyDefines(depthOnly),
      ...getWinterDefines(uniforms)
    },
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms: {
      ...uniforms,
      uChunkMask: chunkMask,
      uChunksX: chunksX,
      uMaskEnabled: maskEnabled,
      uSpriteAlbedo: { value: textures.albedo },
      uSpriteNormal: { value: textures.normals },
      uSpriteWind: { value: textures.wind }
    },
    vertexShader: VERTEX_GLSL
  });
  // R12b: a camera-facing card has flat depth; it must not receive screen-space occlusion.
  if (!depthOnly) excludeFromAmbientOcclusion(material);
  return { material, chunkMask, chunksX, maskEnabled };
};

/**
 * Far zoom LOD: every tree and world plant as one baked sprite quad facing the camera. A few
 * thousand quads replace over a million triangles; a depth-only twin keeps their shadows.
 */
export const createImpostors = (
  instances: PropInstances,
  sprites: BakedSprites,
  textures: ImpostorTextures,
  uniforms: Record<string, IUniform>,
  options: { chunkMask?: DataTexture | null; chunksX?: number } = {}
) => {
  const slots: number[] = [];
  for (let index = 0; index < instances.count; index += 1) {
    if (isImpostorKind(getMeshKind(instances.meshIds[index]!))) slots.push(index);
  }
  const geometry = createGeometry(instances, sprites, slots, options.chunksX);
  const treeSlots = createTreeSlots(geometry, instances, sprites, slots);
  const colored = createMaterial(uniforms, textures, false);
  const depth = createMaterial(uniforms, textures, true);
  const mesh = new Mesh(geometry, colored.material);
  const caster = new Mesh(geometry, depth.material);
  mesh.frustumCulled = false;
  caster.frustumCulled = false;
  const setChunkMask = (mask: DataTexture | null) => {
    colored.chunkMask.value = mask;
    colored.chunksX.value = mask ? (options.chunksX ?? 0) : 0;
    colored.maskEnabled.value = mask ? 1 : 0;
  };
  const setCasterChunkMask = (mask: DataTexture | null) => {
    depth.chunkMask.value = mask;
    depth.chunksX.value = mask ? (options.chunksX ?? 0) : 0;
    depth.maskEnabled.value = mask ? 1 : 0;
  };
  setChunkMask(options.chunkMask ?? null);
  setCasterChunkMask(options.chunkMask ?? null);
  return {
    caster,
    count: slots.length,
    mesh,
    refreshTree: treeSlots.refresh,
    setCasterChunkMask,
    setChunkMask,
    setTreeVisible: treeSlots.setVisible,
    treeKinds: TREE_KIND_SET
  };
};
