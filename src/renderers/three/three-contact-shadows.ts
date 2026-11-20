import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DstColorFactor,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial,
  ZeroFactor} from "three";

import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { COMMON_UNIFORMS_GLSL, FOG_OF_WAR_GLSL, NOISE_GLSL } from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const INDICES = new Uint16Array([0, 2, 1, 0, 3, 2]);

const VERTEX_GLSL = `
precision highp float;
in vec2 corner;
in vec4 contact;
in float fog;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vLocal;
out vec3 vWorld;
out float vFog;

void main() {
  vec3 world = contact.xyz + vec3(corner.x, 0.0, corner.y) * contact.w + vec3(0.0, 0.05, 0.0);
  vLocal = corner;
  vWorld = world;
  vFog = fog;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/** Multiplied onto the ground: darkest under the stems, fading out softly (no hard circle). */
const FRAGMENT_GLSL = `
precision highp float;
in vec2 vLocal;
in vec3 vWorld;
in float vFog;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}

void main() {
  float distance = length(vLocal * vec2(1.0, 1.15)) + (valueNoise(vWorld.xz * 9.0) - 0.5) * 0.25;
  float strength = pow(clamp(1.0 - distance, 0.0, 1.0), 1.6);
  if (strength < 0.01 || isHiddenByFog(vFog, vWorld.xz)) discard;
  if (uAtmospherePass > 0.5 && (uAtmosphereProfile.x > 0.0 || uExplorationFog > 0.5)) {
    AtmosphereRay ray = atmosphereSurfaceRay(vWorld);
    strength *= exp(-atmosphereOpticalDepth(ray) - concealmentOpticalDepth(ray)
      - atmosphereViewLimitOpticalDepth(vWorld));
  }
  fragColor = vec4(mix(vec3(1.0), vec3(0.42, 0.44, 0.5), strength * 0.85), 1.0);
}
`;

export interface ContactShadowInstance {
  fog: number;
  radius: number;
  x: number;
  y: number;
  z: number;
}

/** Generic instanced contact decals (decorations, placed props) sharing the same shader. */
export const createContactShadowMesh = (uniforms: Record<string, IUniform>) => {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("corner", new BufferAttribute(CORNERS, 2));
  geometry.setIndex(new BufferAttribute(INDICES, 1));
  const material = new RawShaderMaterial({
    blendDst: ZeroFactor,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blending: CustomBlending,
    depthWrite: false,
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    transparent: true,
    uniforms,
    userData: { contactShadow: true },
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  let capacity = 0;
  let contact = new Float32Array(0), fog = new Float32Array(0);
  const allocate = (count: number) => {
    capacity = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
    contact = new Float32Array(capacity * 4);
    fog = new Float32Array(capacity);
    geometry.setAttribute("contact", new InstancedBufferAttribute(contact, 4));
    geometry.setAttribute("fog", new InstancedBufferAttribute(fog, 1));
    geometry.instanceCount = 0;
  };
  const update = (instances: readonly ContactShadowInstance[]) => {
    if (instances.length > capacity) allocate(instances.length);
    instances.forEach((instance, index) => {
      contact.set([instance.x, instance.y, instance.z, instance.radius], index * 4);
      fog[index] = instance.fog;
    });
    geometry.instanceCount = instances.length;
    const contactAttribute = geometry.getAttribute("contact") as InstancedBufferAttribute;
    const fogAttribute = geometry.getAttribute("fog") as InstancedBufferAttribute;
    contactAttribute.needsUpdate = true; fogAttribute.needsUpdate = true;
  };
  allocate(0);
  return { mesh, update, dispose: () => { geometry.dispose(); material.dispose(); } };
};

/**
 * Root zone occlusion for plants: one soft dark decal per plant (leaf litter, stems, soil shade)
 * so bushes and reeds sit in the ground instead of on it. One draw call for all of them.
 */
export const createContactShadows = (
  instances: PropInstances,
  meshes: PropMesh[],
  uniforms: Record<string, IUniform>
) => {
  const slots: number[] = [];
  for (let index = 0; index < instances.count; index += 1) {
    if (meshes[instances.meshIds[index]!]!.contactRadius) slots.push(index);
  }
  const contact = new Float32Array(slots.length * 4);
  const fog = new Float32Array(slots.length);
  slots.forEach((index, slot) => {
    const radius = meshes[instances.meshIds[index]!]!.contactRadius! * instances.scale[index]!;
    contact.set([instances.x[index]!, instances.y[index]!, instances.z[index]!, radius], slot * 4);
    fog[slot] = instances.fog[index]!;
  });
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("corner", new BufferAttribute(CORNERS, 2));
  geometry.setIndex(new BufferAttribute(INDICES, 1));
  geometry.setAttribute("contact", new InstancedBufferAttribute(contact, 4));
  geometry.setAttribute("fog", new InstancedBufferAttribute(fog, 1));
  geometry.instanceCount = slots.length;
  const material = new RawShaderMaterial({
    blendDst: ZeroFactor,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blending: CustomBlending,
    depthWrite: false,
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    transparent: true,
    uniforms,
    userData: { contactShadow: true },
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  const slotOf = new Map(slots.map((index, slot) => [instances.sourceIndex[index]!, slot]));
  const contactAttribute = geometry.getAttribute("contact") as InstancedBufferAttribute;
  /** Removed plants (map editor): their decal shrinks to nothing. */
  const removePlants = (sourceIndices: readonly number[]) => {
    for (const id of sourceIndices) {
      const slot = slotOf.get(id);
      if (slot === undefined) continue;
      contact[slot * 4 + 3] = 0;
      contactAttribute.addUpdateRange(slot * 4 + 3, 1);
      contactAttribute.needsUpdate = true;
    }
  };
  const refreshHeights = (heights: ReadonlyMap<number, number>) => {
    for (const [id, height] of heights) {
      const slot = slotOf.get(id);
      if (slot === undefined) continue;
      contact[slot * 4 + 1] = height;
      contactAttribute.addUpdateRange(slot * 4 + 1, 1);
      contactAttribute.needsUpdate = true;
    }
  };
  return { mesh, refreshHeights, removePlants };
};
