import {
  BufferAttribute,
  type Camera,
  InstancedBufferGeometry,
  type IUniform,
  Vector3,
  Vector4} from "three";

import { BUTTERFLY_CAPACITY } from "../../render-common/butterflies/butterfly-manager";
import {
  BUTTERFLY_WING_GLSL,
  createButterflyGeometry
} from "../../render-common/butterflies/butterfly-mesh";
import type { ButterflyFrame } from "../../render-common/butterflies/butterfly-pool";
import { BUTTERFLY_SPECIES } from "../../render-common/butterflies/butterfly-species";
import type { CameraState } from "../../render-common/camera-state";
import { BUTTERFLY_VARIANT_U } from "../../render-common/flyers/flyer-atlas-layout";
import { PIXELS_PER_UNIT } from "../../render-common/iso-projection";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { LEAF_GLSL, PROP_FOG_GLSL, PROP_SHADING_GLSL } from "../../render-common/shaders/prop-glsl";
import {
  commitInstanceAttributes,
  createDynamicInstanceAttribute,
  createFlyerMeshes,
  DITHER_GLSL,
  FLYER_ATLAS_GLSL,
  updateFlyerLod
} from "./three-flyers";

/** Butterflies keep at least this wingspan on screen (CSS px). */
const MIN_WINGSPAN_PIXELS = 9;
/** Perspective fade (dithered) between these multiples of the camera to target distance. */
const FADE_START = 1.1;
const FADE_END = 1.6;

/**
 * Instanced butterfly: every species in one geometry (a vertex of another species collapses).
 * The wings turn about the body axis and bend with the beat in the vertex shader, then the
 * heading and size. iPosition: xyz, wingspan; iPose: heading, wing angle, species, fog
 * visibility; iLook: shade, bend, pattern variant. aUv: the upper and under side atlas UVs.
 */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 color;
in vec4 aUv;
in float aSide;
in float aSpecies;
in vec4 iPosition;
in vec4 iPose;
in vec4 iLook;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec4 uButterflyLod;
uniform vec3 uButterflyCamera;
out vec3 vWorld;
out vec3 vColor;
out vec4 vUv;
out vec3 vFogFadeWing;
${BUTTERFLY_WING_GLSL}

void main() {
  if (abs(aSpecies - iPose.z) > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float distance = mix(1.0, length(uButterflyCamera - iPosition.xyz), uButterflyLod.y);
  float pixels = iPosition.w * uButterflyLod.x / distance;
  float enlarge = clamp(${MIN_WINGSPAN_PIXELS.toFixed(1)} / max(pixels, 0.01), 1.0, 2.0);
  vec3 p = deformButterflyPoint(position, aSide, iPose.y, iLook.y);
  float ch = cos(iPose.x);
  float sh = sin(iPose.x);
  vec3 local = vec3(p.x * ch - p.z * sh, p.y, p.x * sh + p.z * ch);
  vec4 world = vec4(iPosition.xyz + local * iPosition.w * enlarge, 1.0);
  vWorld = world.xyz;
  vColor = color * iLook.x;
  float variant = aUv.x < 0.0 ? 0.0 : iLook.z * ${BUTTERFLY_VARIANT_U.toFixed(6)};
  vUv = aUv + vec4(variant, 0.0, variant, 0.0);
  float fade = 1.0 - smoothstep(uButterflyLod.z, uButterflyLod.w, distance) * uButterflyLod.y;
  vFogFadeWing = vec3(iPose.w, fade, abs(aSide));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * The wing side facing the camera (cards are wound with the upper side in front), alpha cut by
 * the painted outline (alpha to coverage), prop lighting, and the sun shining through the thin
 * wings from behind: the light picks up both sides' pigment, so the pattern glows through.
 */
const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vColor;
in vec4 vUv;
in vec3 vFogFadeWing;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_SHADING_GLSL}
${PROP_FOG_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${DITHER_GLSL}
${LEAF_GLSL}
${FLYER_ATLAS_GLSL}
const float WING_TRANSLUCENCY = 0.85;

void main() {
  if (isHiddenByFog(vFogFadeWing.x, vWorld.xz) || isDitheredOut(vFogFadeWing.y)) discard;
  vec4 front = sampleFlyerAtlas(gl_FrontFacing ? vUv.xy : vUv.zw);
  float coverage = sharpenCoverage(front.a);
  if (coverage < 0.02) discard;
  vec3 back = sampleFlyerAtlas(gl_FrontFacing ? vUv.zw : vUv.xy).rgb;
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 albedo = vColor * front.rgb;
  vec3 color = lightProp(albedo, normal, 1.0, vWorld.xz);
  float through = max(dot(-normal, uSunDirection), 0.0) * vFogFadeWing.z;
  vec3 transmitted = albedo * sqrt(back * vColor);
  color += transmitted * uSunColor * through * WING_TRANSLUCENCY * getBackLightWeight();
  color = applyFogOfWar(color, vFogFadeWing.x, vWorld.xz);
  fragColor = vec4(finishSurface(color, vWorld), coverage);
}
`;

const DEPTH_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec4 vUv;
in vec3 vFogFadeWing;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${PROP_FOG_GLSL}
${FLYER_ATLAS_GLSL}
void main() {
  if (isHiddenByFog(vFogFadeWing.x, vWorld.xz) || vFogFadeWing.y < 0.5) discard;
  if (sampleFlyerAtlas(vUv.xy).a < 0.5) discard;
  fragColor = vec4(1.0);
}
`;

/** Every species' mesh in one geometry, tagged with its species id per vertex. */
const createSpeciesGeometry = () => {
  const parts = BUTTERFLY_SPECIES.map((_, species) => createButterflyGeometry(species));
  const count = parts.reduce((sum, part) => sum + part.sides.length, 0);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 4);
  const sides = new Float32Array(count);
  const speciesIds = new Float32Array(count);
  let offset = 0;
  parts.forEach((part, species) => {
    positions.set(part.positions, offset * 3);
    colors.set(part.colors, offset * 3);
    for (let vertex = 0; vertex < part.sides.length; vertex += 1) {
      uvs.set(part.upperUv.subarray(vertex * 2, vertex * 2 + 2), (offset + vertex) * 4);
      uvs.set(part.underUv.subarray(vertex * 2, vertex * 2 + 2), (offset + vertex) * 4 + 2);
    }
    sides.set(part.sides, offset);
    speciesIds.fill(species, offset, offset + part.sides.length);
    offset += part.sides.length;
  });
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("aUv", new BufferAttribute(uvs, 4));
  geometry.setAttribute("aSide", new BufferAttribute(sides, 1));
  geometry.setAttribute("aSpecies", new BufferAttribute(speciesIds, 1));
  return geometry;
};

/**
 * Butterflies in 3D: painted alpha cut wing cards (pattern variants) and a segmented body per
 * species, one instanced draw (plus one sun shadow caster draw), bending wing beats in the
 * vertex shader, translucent wings against the sun.
 */
export const createThreeButterflies = (shared: Record<string, IUniform>) => {
  const geometry = createSpeciesGeometry();
  const attributes = {
    pose: createDynamicInstanceAttribute(BUTTERFLY_CAPACITY),
    position: createDynamicInstanceAttribute(BUTTERFLY_CAPACITY),
    look: createDynamicInstanceAttribute(BUTTERFLY_CAPACITY)
  };
  geometry.setAttribute("iPosition", attributes.position);
  geometry.setAttribute("iPose", attributes.pose);
  geometry.setAttribute("iLook", attributes.look);
  const instanceAttributes = [attributes.position, attributes.pose, attributes.look];
  geometry.instanceCount = 0;
  const lod = new Vector4(PIXELS_PER_UNIT, 0, 1, 2);
  const cameraPosition = new Vector3();
  const uniforms = {
    ...shared,
    uButterflyCamera: { value: cameraPosition },
    uButterflyLod: { value: lod }
  };
  const { caster, mesh } = createFlyerMeshes(geometry, uniforms, {
    depthFragment: DEPTH_FRAGMENT_GLSL,
    fragment: FRAGMENT_GLSL,
    vertex: VERTEX_GLSL
  });
  const positions = attributes.position.array as Float32Array;
  const poses = attributes.pose.array as Float32Array;
  const looks = attributes.look.array as Float32Array;

  const writeButterfly = (butterflies: ButterflyFrame, index: number) => {
    const offset = index * 4;
    positions[offset] = butterflies.x[index]!;
    positions[offset + 1] = butterflies.y[index]!;
    positions[offset + 2] = butterflies.z[index]!;
    positions[offset + 3] = butterflies.scale[index]!;
    poses[offset] = butterflies.heading[index]!;
    poses[offset + 1] = butterflies.wing[index]!;
    poses[offset + 2] = butterflies.species[index]!;
    poses[offset + 3] = butterflies.visibility[index]!;
    looks[offset] = butterflies.shade[index]!;
    looks[offset + 1] = butterflies.bend[index]!;
    looks[offset + 2] = butterflies.variant[index]!;
  };

  const update = (butterflies: ButterflyFrame, camera: Camera, state: CameraState) => {
    const count = Math.min(butterflies.count, BUTTERFLY_CAPACITY);
    mesh.visible = count > 0;
    caster.visible = count > 0;
    geometry.instanceCount = count;
    if (count === 0) return;
    for (let index = 0; index < count; index += 1) writeButterfly(butterflies, index);
    commitInstanceAttributes(instanceAttributes, count);
    updateFlyerLod(lod, camera, state, FADE_START, FADE_END);
    cameraPosition.copy(camera.position);
  };

  return { caster, mesh, update };
};
