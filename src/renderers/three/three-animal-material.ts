import {
  GLSL3,
  GreaterDepth,
  type IUniform,
  RawShaderMaterial,
  type Texture,
  Vector3,
  Vector4} from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { DERIVATIVE_BUMP_GLSL } from "../../render-common/shaders/derivative-bump-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import { SILHOUETTE_ALPHA, SILHOUETTE_COLOR } from "../../render-common/wildlife/animal-silhouette";
import { type AnimalModel,createRigGlsl } from "../../render-common/wildlife/model/animal-rig";
import { COAT_SPOTS_GLSL, type CoatSpots } from "../../render-common/wildlife/model/coat-spots";
import { RABBIT_COAT_GLSL } from "../../render-common/wildlife/model/rabbit-coat-shading";
import { getDepthOnlyDefines, SUN_SHADOW_GLSL } from "./three-shadows";

/**
 * Skinning of the animal models on the shared rig: every vertex belongs to up to two body
 * parts (from the model's skin weights), the rig walks the joint list (legs, spine, neck,
 * head, ears, tail) with the per instance joint angles for both and blends them, then the body
 * is tilted to the slope, scaled, turned to its heading and placed. One instanced draw per
 * species, variant and level of detail; the CPU only writes 8 vec4 per animal.
 */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
in vec2 uv;
in vec3 parts;
in float spotRegion;
in vec4 fur;
in float roughness;
in vec4 animalCoat;
in vec4 animalPlace;
in vec4 animalBody;
in vec4 animalStyle;
in vec4 animalPose0;
in vec4 animalPose1;
in vec4 animalPose2;
in vec4 animalPose3;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out float vSpotRegion;
out float vVisibility;
flat out float vAppear;
out float vHeight;
out vec3 vRest;
out vec3 vRestNormal;
out vec4 vFur;
flat out vec4 vCoat;
out vec3 vMasks;
out vec3 vTone;
out float vRoughness;
${createRigGlsl()}

void main() {
  for (int index = 0; index < 4; index++) {
    pose[index] = animalPose0[index];
    pose[index + 4] = animalPose1[index];
    pose[index + 8] = animalPose2[index];
    pose[index + 12] = animalPose3[index];
  }
  vec3 local = position;
  vec3 localNormal = normal;
  poseBlended(local, localNormal, parts, animalBody.w);
  vHeight = local.y;
  local = rotateX(rotateZ(local, animalBody.x), -animalBody.y) * animalBody.z;
  localNormal = rotateX(rotateZ(localNormal, animalBody.x), -animalBody.y);
  vWorld = rotateY(local, animalPlace.w) + animalPlace.xyz;
  vNormal = rotateY(localNormal, animalPlace.w);
  vRest = position;
  vRestNormal = normal;
  vUv = uv;
  vSpotRegion = spotRegion;
  vFur = fur;
  vRoughness = roughness;
  vec3 tone = vec3(1.0 + animalStyle.w * 0.07, 1.0, 1.0 - animalStyle.w * 0.08);
  vColor = color * animalStyle.x * tone;
  vCoat = animalCoat;
  vMasks = color;
  vTone = animalStyle.x * tone;
  vVisibility = animalStyle.z;
  vAppear = animalStyle.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

/**
 * Fur detail: the procedural stroke texture projected triplanar in rest pose space, each
 * projection turned so the strokes run along the vertex's anatomical fur flow (mane hanging
 * down, torso back and down, short dense legs) and stretched by its stroke length; detail
 * normals from the stroke height by screen space derivatives (fading out when sub pixel), a
 * specular by the per vertex roughness (matte fur, moist nose, glossy eyes) and a soft fur
 * sheen on the silhouette.
 */
const FUR_GLSL = `
/** Hair relief depth in world units per fur scale unit (the bump is physically scaled). */
const float FUR_DEPTH = 0.003;

/** Texture coordinates of one projection plane with the strokes along the flow. */
vec2 alongFlow(vec2 point, vec2 flow, float strokeLength) {
  vec2 direction = dot(flow, flow) > 0.01 ? normalize(flow) : vec2(1.0, 0.0);
  return vec2(-dot(point, direction) / strokeLength, dot(point, vec2(-direction.y, direction.x)));
}

vec4 sampleFur() {
  vec3 weights = pow(abs(vRestNormal), vec3(4.0));
  weights /= max(weights.x + weights.y + weights.z, 0.0001);
  vec3 p = vRest * uFurScale;
  vec3 flow = vFur.xyz;
  float strokeLength = max(vFur.w, 0.2);
  return texture(uFurTexture, alongFlow(p.xy, flow.xy, strokeLength)) * weights.z
    + texture(uFurTexture, alongFlow(p.xz, flow.xz, strokeLength)) * weights.y
    + texture(uFurTexture, alongFlow(p.zy, flow.zy, strokeLength)) * weights.x;
}

/** 1 while a stroke spans a few pixels, 0 when it would only shimmer. */
float getFurDetail() {
  float texels = length(fwidth(vRest * uFurScale)) * 128.0;
  return 1.0 - smoothstep(1.2, 3.5, texels);
}

${DERIVATIVE_BUMP_GLSL}

vec3 shadeFurSheen(vec3 albedo, vec3 normal, float sun, float hair) {
  vec3 halfway = normalize(uSunDirection + uViewDirection);
  float gloss = pow(max(dot(normal, halfway), 0.0), mix(90.0, 6.0, vRoughness));
  vec3 specular = uSunColor * gloss * (1.0 - vRoughness) * 0.7 * sun * uHighlight;
  float facing = max(dot(normal, uViewDirection), 0.0);
  float rim = pow(1.0 - facing, 3.0) * max(dot(normal, uSunDirection) + 0.35, 0.0);
  return specular + albedo * (uSunColor * 0.16 + uAmbientSky * 0.1) * rim * hair;
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
in float vSpotRegion;
in float vVisibility;
flat in float vAppear;
in float vHeight;
in vec3 vRest;
in vec3 vRestNormal;
in vec4 vFur;
in float vRoughness;
flat in vec4 vCoat;
in vec3 vMasks;
in vec3 vTone;
uniform sampler2D uAlbedo;
uniform float uJuvenile;
uniform sampler2D uFurTexture;
uniform float uFurScale;
uniform float uSpots;
uniform float uSpotCell;
uniform vec3 uSpotColor;
uniform vec3 uWarmTint;
#ifdef WINTER_COAT
uniform vec4 uWinterGrade;
#endif
#ifdef ELK_RUMP
uniform vec4 uRumpPatch;
#endif
#ifdef NORMAL_MAP
uniform sampler2D uNormalMap;
#endif
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

${FUR_GLSL}
${COAT_SPOTS_GLSL}

#ifdef RABBIT_COAT
${RABBIT_COAT_GLSL}
#endif

/** The model's texture (untextured surfaces such as eyes: white, their colour is the tint). */
vec3 sampleAlbedo() {
  return vUv.x < 0.0 ? vec3(1.0) : texture(uAlbedo, vUv).rgb;
}

/**
 * Texel times the vertex tint (zones, shade, tone), with the juvenile coat: the warm tint and
 * the white spots in rest space; rabbits: the individual's coat recoloured from the texel.
 */
vec3 getSeasonCoatColor(vec3 texel) {
#ifdef RABBIT_COAT
  return shadeRabbitCoat(texel, vMasks.g, vRest, vCoat, uJuvenile) * vTone;
#else
  vec3 color = texel * vColor * uWarmTint;
  if (uSpots <= 0.0 || vSpotRegion <= 0.0) return color;
  float spot = getSpotMask(vRest, uSpotCell) * vSpotRegion * uSpots;
  return mix(color, uSpotColor * vTone, spot);
#endif
}

/** The coat colour; the winter coat is greyer and tinted (constant grade per variant). */
vec3 getCoatColor(vec3 texel) {
  vec3 color = getSeasonCoatColor(texel);
#ifdef WINTER_COAT
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, uWinterGrade.x) * uWinterGrade.yzw;
#endif
  return color;
}

#ifdef ELK_RUMP
/** Pale straw rump patch and the dark brown border that frames it (wapiti). */
const vec3 RUMP_STRAW = vec3(0.74, 0.66, 0.5);
const vec3 RUMP_EDGE = vec3(0.14, 0.09, 0.07);

/**
 * The rump patch as an ellipse seen from behind (rest space), crisp at every level of detail:
 * the border is a pixel wide, so the low models keep the same marking.
 */
vec3 applyRumpPatch(vec3 albedo, vec3 texel) {
  vec2 across = vec2((vRest.y - uRumpPatch.y) / uRumpPatch.z, vRest.z / uRumpPatch.w);
  float reach = length(across);
  float behind = smoothstep(uRumpPatch.x + 0.04, uRumpPatch.x - 0.01, vRest.x);
  float soft = fwidth(reach) * 1.5 + 0.03;
  float inside = (1.0 - smoothstep(1.0 - soft, 1.0, reach)) * behind;
  float edge = smoothstep(0.92, 1.0, reach) * (1.0 - smoothstep(1.12, 1.4, reach)) * behind;
  // The patch keeps the hair detail of the texture (its luminance), only its colour changes.
  float hair = 0.75 + 0.5 * dot(texel, vec3(0.299, 0.587, 0.114));
  albedo = mix(albedo, RUMP_EDGE * vTone * hair, edge * 0.9);
  return mix(albedo, RUMP_STRAW * vTone * hair, inside);
}
#endif

#ifdef NORMAL_MAP
/** Tangent space normal map with the frame from screen space derivatives (no tangents). */
vec3 applyNormalMap(vec3 normal) {
  if (vUv.x < 0.0) return normal;
  vec3 mapped = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
  mapped.y = -mapped.y;
  vec3 dp1 = dFdx(vWorld);
  vec3 dp2 = dFdy(vWorld);
  vec2 duv1 = dFdx(vUv);
  vec2 duv2 = dFdy(vUv);
  vec3 dp2perp = cross(dp2, normal);
  vec3 dp1perp = cross(normal, dp1);
  vec3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 bitangent = dp2perp * duv1.y + dp1perp * duv2.y;
  float scale = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-12));
  return normalize(mat3(tangent * scale, bitangent * scale, normal) * mapped);
}
#endif

void main() {
  if (isHiddenByFog(vVisibility, vWorld.xz)) discard;
#ifdef SILHOUETTE
  float aboveGrass = smoothstep(0.03, 0.12, vHeight);
  vec3 silhouette = vec3(${SILHOUETTE_COLOR.map((value) => value.toFixed(2)).join(", ")});
  fragColor = vec4(colorDisplayOutput(silhouette), ${SILHOUETTE_ALPHA.toFixed(2)} * aboveGrass);
#elif defined(DEPTH_ONLY)
  fragColor = vec4(1.0);
#else
  vec3 texel = sampleAlbedo();
  vec3 surfaceNormal = normalize(vNormal);
#ifdef NORMAL_MAP
  surfaceNormal = applyNormalMap(surfaceNormal);
#endif
  float hair = step(0.01, vFur.w);
  vec4 fur = sampleFur();
  float detail = getFurDetail() * hair;
  vec3 normal = perturbDerivativeNormal(vWorld, surfaceNormal, fur.r * detail * FUR_DEPTH / uFurScale);
  vec3 albedo = getCoatColor(texel) * mix(1.0, 0.88 + fur.g * 0.24, detail * 0.5);
#ifdef ELK_RUMP
  albedo = applyRumpPatch(albedo, texel);
#endif
#ifdef FUR_CLUMPS
  // Hair clumps and partings (High): a soft low-frequency light / dark break-up of the coat.
  albedo *= 1.0 + (valueNoise(vRest.xy * 38.0 + vRest.z * 23.0) - 0.5) * 0.18 * hair;
#endif
  float occlusion = mix(0.6, 1.0, smoothstep(0.0, 0.25, vHeight)) * mix(0.8, 1.0, normal.y * 0.5 + 0.5);
  float sun = sampleSunShadow(vWorld);
  vec3 color = lightSurface(albedo, normal, sun, occlusion, vWorld.xz);
  color += shadeFurSheen(albedo, normal, sun, hair);
  fragColor = vec4(finishSurface(applyFogOfWar(color, vVisibility, vWorld.xz), vWorld), 1.0);
#endif
  // Discard after fur/normal derivatives: discarding inside a derivative quad would darken the surviving pixels.
  // Opaque ordered coverage, stable in each pass: no alpha sorting, extra draw or scale shrinking.
  // Rest-space coordinates make the same body samples disappear from body and shadow passes.
  if (vAppear < 1.0) {
    vec3 cell = floor(vRest * 320.0);
    float threshold = fract(sin(dot(cell, vec3(12.9898, 78.233, 39.425))) * 43758.5453);
    if (vAppear <= threshold) discard;
  }
}
`;

/** Textures of a species: its albedo atlas, optional normal atlas and the shared fur strokes. */
export interface AnimalTextures {
  albedo: Texture;
  /** Fur strokes; `clumps` adds the hair clump break-up (High detail, not Minimal). */
  fur: { clumps: boolean; scale: number; texture: Texture };
  normal: Texture | null;
}

const NO_SPOTS: CoatSpots = { cell: 1, color: [1, 1, 1], warm: [1, 1, 1] };

/**
 * Passes of an animal layer: the lit body, the sun shadow depth, and the silhouette drawn only
 * where the scene (crowns, hills) is in front of the animal.
 */
export type AnimalPass = "main" | "shadow" | "silhouette";

const PASS_DEFINES: Record<AnimalPass, Record<string, string>> = {
  main: {},
  shadow: getDepthOnlyDefines(true),
  silhouette: { SILHOUETTE: "" }
};

/** The silhouette blends over the scene where the scene's depth is nearer than the animal. */
const setSilhouetteState = (material: RawShaderMaterial) => {
  material.depthFunc = GreaterDepth;
  material.depthWrite = false;
  material.transparent = true;
  return material;
};

export const createAnimalMaterial = (
  uniforms: Record<string, IUniform>,
  model: AnimalModel,
  textures: AnimalTextures,
  spots: CoatSpots | undefined,
  pass: AnimalPass
) => {
  const coat = spots ?? NO_SPOTS;
  const warmTint = coat.warm.map((channel) => 1 + (channel - 1) * model.warmth);
  const material = new RawShaderMaterial({
    defines: {
      ...PASS_DEFINES[pass],
      ...(model.coatMasks ? { RABBIT_COAT: "" } : {}),
      ...(textures.normal ? { NORMAL_MAP: "" } : {}),
      ...(model.winterGrade ? { WINTER_COAT: "" } : {}),
      ...(model.rumpPatch ? { ELK_RUMP: "" } : {}),
      ...(textures.fur.clumps ? { FUR_CLUMPS: "" } : {})
    },
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    uniforms: {
      ...uniforms,
      uAlbedo: { value: textures.albedo },
      uAntlerPivot: { value: new Vector3(...model.antlerPivot) },
      uFurScale: { value: textures.fur.scale },
      uFurTexture: { value: textures.fur.texture },
      uJuvenile: { value: model.coatMasks?.juvenile ?? 0 },
      uJoints: { value: model.joints.map((joint) => new Vector3(...joint)) },
      uNormalMap: { value: textures.normal },
      uSpotCell: { value: coat.cell },
      uSpotColor: { value: new Vector3(...coat.color) },
      uSpots: { value: spots ? model.spots : 0 },
      uWarmTint: { value: new Vector3(...warmTint) },
      uRumpPatch: { value: new Vector4(...(model.rumpPatch ?? [0, 0, 1, 1])) },
      uWinterGrade: { value: new Vector4(...(model.winterGrade ?? [1, 1, 1, 1])) }
    },
    vertexShader: VERTEX_GLSL
  });
  return pass === "silhouette" ? setSilhouetteState(material) : material;
};
