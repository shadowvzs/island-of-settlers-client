import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DstColorFactor,
  DynamicDrawUsage,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial,
  ZeroFactor
} from "three";

import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import type { AnimalFrame } from "../../render-common/wildlife/sim/animal-pool";
import { MAX_VISIBLE_ANIMALS } from "../../render-common/wildlife/sim/animal-pool";
import { getSpecies } from "../../render-common/wildlife/wildlife-species";

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const INDICES = new Uint16Array([0, 2, 1, 0, 3, 2]);
/** Footprint of the shade (share of the body length, the width a share of that). */
const LENGTH_SHARE = 0.78;
const WIDTH_SHARE = 0.45;
/** Darkness with the sun shadows drawn (only the occluded ground under the belly) and without. */
const SUN_SHADOW_STRENGTH = 0.45;
const NO_SUN_STRENGTH = 0.75;
/** Lifted this far above the ground (share of the body length) the shade has faded out. */
const LIFT_FADE = 0.45;

const VERTEX_GLSL = `
precision highp float;
in vec2 corner;
in vec4 contactPlace;
in vec4 contactShape;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vLocal;
out vec3 vWorld;
out float vStrength;
out float vFog;

void main() {
  vec2 axis = vec2(cos(contactPlace.w), sin(contactPlace.w));
  vec2 offset = axis * corner.x * contactShape.x + vec2(-axis.y, axis.x) * corner.y * contactShape.y;
  vec3 world = contactPlace.xyz + vec3(offset.x, 0.03, offset.y);
  vLocal = corner;
  vWorld = world;
  vStrength = contactShape.z;
  vFog = contactShape.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * Multiplied onto the ground: dense under the body out to the hooves (where it shows past the
 * body from the camera), fading softly beyond them.
 */
const FRAGMENT_GLSL = `
precision highp float;
in vec2 vLocal;
in vec3 vWorld;
in float vStrength;
in float vFog;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}

void main() {
  float shade = smoothstep(1.0, 0.3, length(vLocal)) * vStrength;
  if (shade < 0.01 || isHiddenByFog(vFog, vWorld.xz)) discard;
  if (uAtmospherePass > 0.5 && (uAtmosphereProfile.x > 0.0 || uExplorationFog > 0.5)) {
    AtmosphereRay ray = atmosphereSurfaceRay(vWorld);
    shade *= exp(-atmosphereOpticalDepth(ray) - concealmentOpticalDepth(ray)
      - atmosphereViewLimitOpticalDepth(vWorld));
  }
  fragColor = vec4(mix(vec3(1.0), vec3(0.4, 0.42, 0.47), shade), 1.0);
}
`;

const createInstanceAttribute = (geometry: InstancedBufferGeometry, name: string) => {
  const attribute = new InstancedBufferAttribute(new Float32Array(MAX_VISIBLE_ANIMALS * 4), 4);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
};

/**
 * Soft contact shade under every drawn animal (one instanced draw for all of them): an ellipse
 * along the heading, fading as a hop lifts the body. Without sun shadows (Minimal) it is the
 * only grounding; with them it adds the occluded ground under the belly.
 */
export const createAnimalContactShadows = (
  uniforms: Record<string, IUniform>,
  sunShadows: boolean
) => {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("corner", new BufferAttribute(CORNERS, 2));
  geometry.setIndex(new BufferAttribute(INDICES, 1));
  const place = createInstanceAttribute(geometry, "contactPlace");
  const shape = createInstanceAttribute(geometry, "contactShape");
  geometry.instanceCount = 0;
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
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  const strength = sunShadows ? SUN_SHADOW_STRENGTH : NO_SUN_STRENGTH;
  const places = place.array as Float32Array;
  const shapes = shape.array as Float32Array;
  let count = 0;

  /** Writes animal `index` of the frame as the next shade (no allocation). */
  const write = (frame: AnimalFrame, index: number) => {
    const length = getSpecies(frame.species[index]!).length * frame.scale[index]!;
    const lift = Math.max(0, frame.y[index]! - frame.ground[index]!);
    const fade = Math.max(0, 1 - lift / (length * LIFT_FADE));
    const offset = count * 4;
    places[offset] = frame.x[index]!;
    places[offset + 1] = frame.ground[index]!;
    places[offset + 2] = frame.z[index]!;
    places[offset + 3] = frame.heading[index]!;
    shapes[offset] = length * LENGTH_SHARE;
    shapes[offset + 1] = length * LENGTH_SHARE * WIDTH_SHARE;
    shapes[offset + 2] = strength * fade * frame.appear[index]!;
    shapes[offset + 3] = frame.visibility[index]!;
    count += 1;
  };

  const begin = () => {
    count = 0;
  };

  const commit = () => {
    geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    for (const attribute of [place, shape]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * 4);
      attribute.needsUpdate = true;
    }
  };

  return { begin, commit, mesh, write };
};
