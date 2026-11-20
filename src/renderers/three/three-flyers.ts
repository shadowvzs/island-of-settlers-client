import {
  type BufferGeometry,
  type Camera,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  InstancedBufferAttribute,
  type IUniform,
  Mesh,
  type PerspectiveCamera,
  RawShaderMaterial,
  Vector3,
  type Vector4
} from "three";

import type { CameraState } from "../../render-common/camera-state";
import { PIXELS_PER_UNIT } from "../../render-common/iso-projection";

/** The flyer atlas (bird feathers, butterfly wings); untextured vertices (uv < 0) are white. */
export const FLYER_ATLAS_GLSL = `
uniform sampler2D uFlyerAtlas;

vec4 sampleFlyerAtlas(vec2 uv) {
  if (uv.x < 0.0) return vec4(1.0);
  return texture(uFlyerAtlas, uv);
}
`;

/** Screen door fade: no blending or sorting, far flyers thin out over a few frames. */
export const DITHER_GLSL = `
bool isDitheredOut(float fade) {
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
  float threshold = (cell.x * 4.0 + cell.y + 0.5) / 16.0;
  return fade < threshold;
}
`;

/** Per instance vec4 (or `size`) attribute rewritten every frame. */
export const createDynamicInstanceAttribute = (capacity: number, size = 4) => {
  const attribute = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
  attribute.setUsage(DynamicDrawUsage);
  return attribute;
};

/** Uploads the first `count` instances of each attribute. */
export const commitInstanceAttributes = (
  attributes: readonly InstancedBufferAttribute[],
  count: number
) => {
  for (const attribute of attributes) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }
};

/** Ground target of the camera: perspective flyers fade out well beyond its distance. */
const target = new Vector3();

/**
 * Flyer LOD uniform: x pixels per world unit at distance 1 (perspective) or at the target
 * (ortho), y perspective flag, z / w fade start / end distance (multiples of the camera to
 * target distance).
 */
export const updateFlyerLod = (
  lod: Vector4,
  camera: Camera,
  state: CameraState,
  fadeStart: number,
  fadeEnd: number
) => {
  const perspective = (camera as PerspectiveCamera).isPerspectiveCamera === true;
  if (!perspective) {
    lod.set(PIXELS_PER_UNIT * state.zoom, 0, 1, 2);
    return;
  }
  const fov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
  const reach = camera.position.distanceTo(target.set(state.centerX, 0, state.centerZ));
  lod.set(state.viewportHeight / (2 * Math.tan(fov / 2)), 1, reach * fadeStart, reach * fadeEnd);
};

export interface FlyerShaders {
  depthFragment: string;
  fragment: string;
  vertex: string;
}

const createFlyerMaterial = (
  uniforms: Record<string, IUniform>,
  vertexShader: string,
  fragmentShader: string
) =>
  new RawShaderMaterial({
    /** Butterfly wing outlines are alpha cut: soft edges without sorting (birds stay opaque). */
    alphaToCoverage: true,
    fragmentShader,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms,
    vertexShader
  });

/** The instanced flyer mesh and its sun shadow caster (same vertices, depth only), hidden. */
export const createFlyerMeshes = (
  geometry: BufferGeometry,
  uniforms: Record<string, IUniform>,
  shaders: FlyerShaders
) => {
  const mesh = new Mesh(geometry, createFlyerMaterial(uniforms, shaders.vertex, shaders.fragment));
  const casterMaterial = createFlyerMaterial(uniforms, shaders.vertex, shaders.depthFragment);
  const caster = new Mesh(geometry, casterMaterial);
  for (const item of [mesh, caster]) {
    item.frustumCulled = false;
    item.visible = false;
  }
  return { caster, mesh };
};
