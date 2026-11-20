import {
  BufferAttribute,
  DoubleSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial} from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import {
  createWeedClumpMesh,
  replaceWaterWeedsRegion,
  type WaterWeeds
} from "../../render-common/water/water-weeds";
import type { CellRegion } from "../../shared/world/grid-geometry";
import { PREVAILING_WIND_DIRECTION } from "../../shared/world/prevailing-wind";

/**
 * Strand sway in the current (unlike the land plants' wind, a water motion is right here): the
 * strands stream downstream by the flow speed, wave along their length and drift sideways a
 * little; still pools only sway slowly. Tips keep their length (they dip as they stream).
 */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
in float bend;
in vec4 placement;
in vec4 shape;
in vec2 current;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vFog;

void main() {
  float c = cos(placement.w);
  float s = sin(placement.w);
  vec3 local = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
  local *= vec3(shape.y, shape.x, shape.y);
  float speed = length(current);
  vec2 along = speed > 0.01 ? current / speed : vec2(${PREVAILING_WIND_DIRECTION.x.toFixed(4)}, ${PREVAILING_WIND_DIRECTION.z.toFixed(4)});
  vec2 across = vec2(-along.y, along.x);
  float phase = shape.z + bend * 2.6;
  float stream = (0.12 + min(speed, 1.2) * 0.22 + sin(uTime * 1.5 + phase) * 0.06) * shape.x;
  float wave = sin(uTime * 1.1 + phase * 1.3) * 0.05 * shape.x;
  float weight = bend * bend;
  local.xz += (along * stream + across * wave) * weight;
  local.y *= 1.0 - 0.25 * weight * min(speed + 0.3, 1.0);
  vec3 world = placement.xyz + local;
  vWorld = world;
  vNormal = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);
  vColor = color;
  vFog = shape.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vFog;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

void main() {
  if (isHiddenByFog(vFog, vWorld.xz)) discard;
  vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 lit = lightSurface(vColor, normalize(normal + vec3(0.0, 0.8, 0.0)), 1.0, 1.0, vWorld.xz);
  fragColor = vec4(finishSurface(applyFogOfWar(lit, vFog, vWorld.xz), vWorld), 1.0);
}
`;

/**
 * Underwater weeds: one instanced clump mesh (70 triangles) per weed spot, drawn
 * only into the refraction pass, so they show through the water with its wave offset and
 * absorption (one draw call there, nothing in the main pass).
 */
/** The clumps' instance data (placement, shape, current). */
const setWeedInstances = (geometry: InstancedBufferGeometry, weeds: WaterWeeds) => {
  geometry.setAttribute("placement", new InstancedBufferAttribute(weeds.placement, 4));
  geometry.setAttribute("shape", new InstancedBufferAttribute(weeds.shape, 4));
  geometry.setAttribute("current", new InstancedBufferAttribute(weeds.flow, 2));
  geometry.instanceCount = weeds.count;
};

export const createThreeWaterWeeds = (weeds: WaterWeeds, uniforms: Record<string, IUniform>) => {
  const clump = createWeedClumpMesh();
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(clump.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(clump.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(clump.colors, 3));
  geometry.setAttribute("bend", new BufferAttribute(clump.bend, 1));
  geometry.setIndex(new BufferAttribute(clump.indices, 1));
  setWeedInstances(geometry, weeds);
  let current = weeds;
  const material = new RawShaderMaterial({
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms,
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = weeds.count > 0;
  const apply = (next: WaterWeeds) => {
    current = next;
    setWeedInstances(geometry, next);
    mesh.visible = next.count > 0;
  };
  /** Map editor: all weeds replaced (a full build; kept for compatibility with the old swaps). */
  const setWeeds = (next: WaterWeeds) => apply(next);
  /** Map editor: only the edited cells' clumps change; every other clump keeps its identity. */
  const replaceWeeds = (region: WaterWeeds, cells: CellRegion) =>
    apply(replaceWaterWeedsRegion(current, region, cells));
  return {
    mesh,
    replaceWeeds,
    setWeeds,
    triangles: (clump.indices.length / 3) * weeds.count
  };
};
