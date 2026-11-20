import {
  BufferAttribute,
  GLSL3,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial} from "three";

import { CRITTER_RIPPLES } from "../../render-common/critters/critter-manager";
import type { RippleFrame } from "../../render-common/critters/sim/critter-pool";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import { commitInstanceAttributes, createDynamicInstanceAttribute } from "./three-flyers";

/** A flat quad per ring on the water; iRipple: x, y, z, largest radius; iAge: age, fog. */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec4 iRipple;
in vec4 iAge;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec2 vLocal;
out vec2 vAgeFog;

void main() {
  vLocal = position.xz;
  vAgeFog = iAge.xy;
  vec2 ground = iRipple.xz + position.xz * iRipple.w;
  vWorld = vec3(ground.x, iRipple.y + 0.01, ground.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

/**
 * The ring eases out from the centre, thins and fades; a faint second ring trails it (opacity at
 * a distance from the centre in largest radii). Shared with the whales' water layer.
 */
export const RIPPLE_RING_GLSL = `
const vec3 FOAM = vec3(0.86, 0.91, 0.95);

float ring(float distance, float radius, float width) {
  return 1.0 - smoothstep(0.0, width, abs(distance - radius));
}

float rippleAlpha(float age, float distance) {
  float grown = 1.0 - (1.0 - age) * (1.0 - age);
  float width = mix(0.09, 0.035, age);
  float rings = ring(distance, grown, width) + 0.45 * ring(distance, grown * 0.62, width * 0.8);
  return rings * pow(1.0 - age, 1.4) * 0.7;
}
`;

/** Lit like the water's foam (sky and sun), blended over the surface. */
const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec2 vLocal;
in vec2 vAgeFog;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${RIPPLE_RING_GLSL}

void main() {
  if (isHiddenByFog(vAgeFog.y, vWorld.xz)) discard;
  float alpha = rippleAlpha(vAgeFog.x, length(vLocal));
  if (alpha < 0.01) discard;
  vec3 color = lightSurface(FOAM, vec3(0.0, 1.0, 0.0), 1.0, 1.0, vWorld.xz);
  fragColor = vec4(finishSurface(applyFogOfWar(color, vAgeFog.y, vWorld.xz), vWorld), alpha);
}
`;

const createQuad = () => {
  const geometry = new InstancedBufferGeometry();
  const corners = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(corners), 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
};

/** Water rings (wakes, dabbling, strikes, leaping fish): one instanced, blended draw. */
export const createThreeRipples = (shared: Record<string, IUniform>) => {
  const geometry = createQuad();
  const ripple = createDynamicInstanceAttribute(CRITTER_RIPPLES);
  const age = createDynamicInstanceAttribute(CRITTER_RIPPLES);
  geometry.setAttribute("iRipple", ripple);
  geometry.setAttribute("iAge", age);
  geometry.instanceCount = 0;
  const material = new RawShaderMaterial({
    depthWrite: false,
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    transparent: true,
    uniforms: shared,
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const rings = ripple.array as Float32Array;
  const ages = age.array as Float32Array;

  const update = (frame: RippleFrame) => {
    const count = Math.min(frame.count, CRITTER_RIPPLES);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      rings[offset] = frame.x[index]!;
      rings[offset + 1] = frame.y[index]!;
      rings[offset + 2] = frame.z[index]!;
      rings[offset + 3] = frame.size[index]!;
      ages[offset] = frame.age[index]!;
      ages[offset + 1] = frame.visibility[index]!;
    }
    geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count > 0) commitInstanceAttributes([ripple, age], count);
  };

  return { mesh, update };
};
