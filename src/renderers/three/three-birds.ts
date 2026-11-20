import {
  BufferAttribute,
  type Camera,
  InstancedBufferGeometry,
  type IUniform,
  Vector3,
  Vector4} from "three";

import { FOG_VISIBILITY_FADE_GLSL } from "../../render-common/atmosphere/fog-visibility";
import { getWingPose, type WingPose } from "../../render-common/birds/bird-flight";
import { BIRD_CAPACITY } from "../../render-common/birds/bird-manager";
import { BIRD_WING_GLSL, createBirdGeometry } from "../../render-common/birds/bird-mesh";
import type { BirdFrame } from "../../render-common/birds/bird-pool";
import { BIRD_SPECIES } from "../../render-common/birds/bird-species";
import type { CameraState } from "../../render-common/camera-state";
import { PIXELS_PER_UNIT } from "../../render-common/iso-projection";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_SHADING_GLSL } from "../../render-common/shaders/prop-glsl";
import {
  commitInstanceAttributes,
  createDynamicInstanceAttribute,
  createFlyerMeshes,
  DITHER_GLSL,
  FLYER_ATLAS_GLSL,
  updateFlyerLod
} from "./three-flyers";

/** Far birds keep at least this wingspan on screen (CSS px): the silhouette stays readable. */
const MIN_WINGSPAN_PIXELS = 13;
/** Perspective fade (dithered) between these multiples of the camera to target distance. */
const FADE_START = 1.7;
const FADE_END = 2.6;

/**
 * Instanced bird: the species meshes share one geometry (a vertex of another species collapses),
 * the flap bends the wings in the vertex shader, then bank, pitch, heading and size. uBirdLod:
 * x pixels per world unit at distance 1 (perspective) or at the target (ortho), y perspective
 * flag, z / w fade start / end distance.
 */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
in vec2 aUv;
in float aSpan;
in float aSpecies;
in vec4 iPosition;
in vec4 iPose;
in vec4 iWing;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec4 uBirdLod;
uniform vec3 uBirdCamera;
out vec3 vWorld;
out vec3 vColor;
out vec3 vNormal;
out vec2 vUv;
out vec2 vFogFade;
out vec3 vBirdUp;
${BIRD_WING_GLSL}

vec3 orientBird(vec3 p) {
  float cb = cos(iPose.y);
  float sb = sin(iPose.y);
  p = vec3(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb);
  float cp = cos(iPose.z);
  float sp = sin(iPose.z);
  p = vec3(p.x * cp - p.y * sp, p.x * sp + p.y * cp, p.z);
  float ch = cos(iPose.x);
  float sh = sin(iPose.x);
  return vec3(p.x * ch - p.z * sh, p.y, p.x * sh + p.z * ch);
}

void main() {
  if (abs(aSpecies - iWing.z) > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float distance = mix(1.0, length(uBirdCamera - iPosition.xyz), uBirdLod.y);
  float pixels = iPosition.w * uBirdLod.x / distance;
  float enlarge = clamp(${MIN_WINGSPAN_PIXELS.toFixed(1)} / max(pixels, 0.01), 1.0, 2.5);
  // Folded, still perch poses keep their physical scale so roof slots cannot overlap at far LOD.
  float perched = step(1.7, iWing.y);
  enlarge = mix(enlarge, 1.0, perched);
  vec3 local = orientBird(deformBirdPoint(position, aSpan, iWing.x, iWing.y));
  vec4 world = vec4(iPosition.xyz + local * iPosition.w * enlarge, 1.0);
  vWorld = world.xyz;
  vColor = color * iWing.w;
  vNormal = orientBird(deformBirdNormal(normal, aSpan, position.z, iWing.x));
  vUv = aUv;
  vBirdUp = orientBird(vec3(0.0, 1.0, 0.0));
  vFogFade = vec2(iPose.w, 1.0 - smoothstep(uBirdLod.z, uBirdLod.w, distance) * uBirdLod.y);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vColor;
in vec3 vNormal;
in vec2 vUv;
in vec2 vFogFade;
in vec3 vBirdUp;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_SHADING_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${DITHER_GLSL}
${FLYER_ATLAS_GLSL}
/** Seen from below (banking, cinematic camera) the plumage turns paler. */
const vec3 UNDERSIDE_TINT = vec3(0.42, 0.4, 0.36);

void main() {
  float visibility = sampleLiveFog(vFogFade.x, vWorld.xz);
  // Fade through the whole reveal band: birds no longer stay opaque and then pop out at one
  // visibility value. The map edge haze is the last band, like every other prop.
  float fade = min(vFogFade.y, fogVisibilityFade(visibility));
  fade = min(fade, getMapInterior(vWorld.xz));
  if (isDitheredOut(fade)) discard;
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float underside = smoothstep(0.05, -0.25, dot(normal, normalize(vBirdUp)));
  vec3 plumage = vColor * sampleFlyerAtlas(vUv).rgb;
  vec3 albedo = mix(plumage, plumage * 0.55 + UNDERSIDE_TINT, underside * 0.55);
  vec3 color = shadeProp(albedo, normal, 1.0, vWorld.xz, visibility);
  fragColor = vec4(finishSurface(color, vWorld), 1.0);
}
`;

/** Sun shadow caster: same vertices, depth only. */
const DEPTH_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec2 vFogFade;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${DITHER_GLSL}
${FOG_VISIBILITY_FADE_GLSL}
void main() {
  float visibility = sampleLiveFog(vFogFade.x, vWorld.xz);
  float fogFade = min(fogVisibilityFade(visibility), getMapInterior(vWorld.xz));
  if (vFogFade.y < 0.5 || isDitheredOut(fogFade)) discard;
  fragColor = vec4(1.0);
}
`;

/** Every species' rest mesh in one indexed geometry, tagged with its species id per vertex. */
const createSpeciesGeometry = () => {
  const parts = BIRD_SPECIES.map((species) => createBirdGeometry(species.shape));
  const count = parts.reduce((sum, part) => sum + part.spans.length, 0);
  const indexCount = parts.reduce((sum, part) => sum + part.indices.length, 0);
  const attributes = {
    color: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    position: new Float32Array(count * 3),
    span: new Float32Array(count),
    species: new Float32Array(count),
    uv: new Float32Array(count * 2)
  };
  const indices = new Uint16Array(indexCount);
  let offset = 0;
  let indexOffset = 0;
  parts.forEach((part, species) => {
    attributes.position.set(part.positions, offset * 3);
    attributes.normal.set(part.normals, offset * 3);
    attributes.color.set(part.colors, offset * 3);
    attributes.uv.set(part.uvs, offset * 2);
    attributes.span.set(part.spans, offset);
    attributes.species.fill(species, offset, offset + part.spans.length);
    part.indices.forEach((index, at) => (indices[indexOffset + at] = index + offset));
    offset += part.spans.length;
    indexOffset += part.indices.length;
  });
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute("position", new BufferAttribute(attributes.position, 3));
  geometry.setAttribute("normal", new BufferAttribute(attributes.normal, 3));
  geometry.setAttribute("color", new BufferAttribute(attributes.color, 3));
  geometry.setAttribute("aUv", new BufferAttribute(attributes.uv, 2));
  geometry.setAttribute("aSpan", new BufferAttribute(attributes.span, 1));
  geometry.setAttribute("aSpecies", new BufferAttribute(attributes.species, 1));
  return geometry;
};

/**
 * Ambient birds in 3D: one instanced draw (plus one sun shadow caster draw) for every species,
 * smooth normals and feather detail from the flyer atlas, vertex animated flaps, banking into
 * turns, a minimum on screen size and a perspective fade.
 */
export const createThreeBirds = (shared: Record<string, IUniform>) => {
  const geometry = createSpeciesGeometry();
  const attributes = {
    position: createDynamicInstanceAttribute(BIRD_CAPACITY),
    pose: createDynamicInstanceAttribute(BIRD_CAPACITY),
    wing: createDynamicInstanceAttribute(BIRD_CAPACITY)
  };
  geometry.setAttribute("iPosition", attributes.position);
  geometry.setAttribute("iPose", attributes.pose);
  geometry.setAttribute("iWing", attributes.wing);
  const instanceAttributes = [attributes.position, attributes.pose, attributes.wing];
  geometry.instanceCount = 0;
  const lod = new Vector4(PIXELS_PER_UNIT, 0, 1, 2);
  const cameraPosition = new Vector3();
  const uniforms = { ...shared, uBirdCamera: { value: cameraPosition }, uBirdLod: { value: lod } };
  const { caster, mesh } = createFlyerMeshes(geometry, uniforms, {
    depthFragment: DEPTH_FRAGMENT_GLSL,
    fragment: FRAGMENT_GLSL,
    vertex: VERTEX_GLSL
  });
  const pose: WingPose = { angle: 0, fold: 0 };

  const writeBird = (birds: BirdFrame, bird: number) => {
    const species = BIRD_SPECIES[birds.species[bird]!]!;
    getWingPose(birds.flapPhase[bird]!, birds.flapAmount[bird]!, birds.tuck[bird]!, species, pose);
    if (birds.tuck[bird]! >= 0.99 && birds.flapAmount[bird]! <= 0.02) {
      // Fully settled birds carry the folded wings along their body rather than holding a glide.
      pose.angle = -0.65;
      pose.fold = 1.8;
    }
    const offset = bird * 4;
    const positions = attributes.position.array as Float32Array;
    positions[offset] = birds.x[bird]!;
    positions[offset + 1] = birds.y[bird]!;
    positions[offset + 2] = birds.z[bird]!;
    positions[offset + 3] = birds.scale[bird]!;
    const poses = attributes.pose.array as Float32Array;
    poses[offset] = birds.heading[bird]!;
    poses[offset + 1] = birds.bank[bird]!;
    poses[offset + 2] = birds.pitch[bird]!;
    poses[offset + 3] = birds.visibility[bird]!;
    const wings = attributes.wing.array as Float32Array;
    wings[offset] = pose.angle;
    wings[offset + 1] = pose.fold;
    wings[offset + 2] = birds.species[bird]!;
    wings[offset + 3] = birds.shade[bird]!;
  };

  const update = (birds: BirdFrame, camera: Camera, state: CameraState) => {
    const count = Math.min(birds.count, BIRD_CAPACITY);
    mesh.visible = count > 0;
    caster.visible = count > 0;
    geometry.instanceCount = count;
    if (count === 0) return;
    for (let bird = 0; bird < count; bird += 1) writeBird(birds, bird);
    commitInstanceAttributes(instanceAttributes, count);
    updateFlyerLod(lod, camera, state, FADE_START, FADE_END);
    cameraPosition.copy(camera.position);
  };

  return { caster, mesh, update };
};
