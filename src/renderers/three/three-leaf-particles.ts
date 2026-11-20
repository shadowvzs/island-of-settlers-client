import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  GLSL3,
  InstancedBufferAttribute,
  InstancedMesh,
  type IUniform,
  Matrix4,
  Quaternion,
  RawShaderMaterial,
  Vector3,
  type Vector4
} from "three";

import type { LeafParticles } from "../../render-common/felling/leaf-particles";
import { getSeasonLeafShades } from "../../render-common/seasonal-appearance/season-leaf-shades";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_SHADING_GLSL } from "../../render-common/shaders/prop-glsl";

/** Fresh, mid and yellowing leaf colours (the island lights in display space). */
const LEAF_SHADES = [
  [0.34, 0.52, 0.15],
  [0.24, 0.42, 0.11],
  [0.62, 0.57, 0.17]
] as const;

const WINTER_LEAF_SHADES = [
  [0.36, 0.25, 0.14],
  [0.28, 0.21, 0.13],
  [0.52, 0.39, 0.22]
] as const;

const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
in vec3 instanceColor;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;

void main() {
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_SHADING_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

void main() {
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  fragColor = vec4(finishSurface(shadeProp(vColor, normal, 1.0, vWorld.xz, 1.0), vWorld), 1.0);
}
`;

/** A unit leaf: stem at the origin, tip at +y, slightly folded along its midrib. */
const createLeafGeometry = () => {
  const geometry = new BufferGeometry();
  const positions = [0, 0, 0, 0.5, 0.45, 0.1, 0, 1, 0, -0.5, 0.45, 0.1];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
};

/**
 * Falling leaves of the felling simulation as one instanced draw with island lighting. Leaves
 * shrink while they fade (no blending).
 */
export const createLeafParticleMesh = (
  capacity: number,
  uniforms: Record<string, IUniform>,
  visualWinter = false
) => {
  const material = new RawShaderMaterial({
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms,
    vertexShader: VERTEX_GLSL
  });
  const mesh = new InstancedMesh(createLeafGeometry(), material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;
  const shades = visualWinter ? WINTER_LEAF_SHADES : LEAF_SHADES;
  const colors = shades.map((shade) => new Color(...shade));
  const season = uniforms.uSeason?.value as Vector4 | undefined;
  /** The leaf shades follow the GPU season tint (autumn, dormant, spring, monsoon), recomputed per update. */
  const updateSeasonColors = () => {
    if (!season) return;
    const tinted = getSeasonLeafShades(shades,
      { autumn: season.x, dormant: season.y, monsoon: season.w, spring: season.z });
    tinted.forEach((shade, index) => colors[index]!.setRGB(...shade));
  };
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const euler = new Euler();
  const size = new Vector3();

  const update = (particles: LeafParticles) => {
    updateSeasonColors();
    let count = 0;
    const live = Math.min(capacity, particles.capacity);
    for (let leaf = 0; leaf < live; leaf += 1) {
      const alpha = particles.alpha[leaf]!;
      if (alpha <= 0) continue;
      const angle = particles.angle[leaf]!;
      position.set(particles.x[leaf]!, particles.y[leaf]!, particles.z[leaf]!);
      rotation.setFromEuler(euler.set(Math.sin(angle * 1.3) * 0.9 + 1.2, angle, 0));
      size.setScalar(particles.size[leaf]! * alpha);
      mesh.setMatrixAt(count, matrix.compose(position, rotation, size));
      mesh.setColorAt(count, colors[particles.shade[leaf]!]!);
      count += 1;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  };

  return { mesh, update };
};
