import { type BufferGeometry, DoubleSide, type IUniform, type Material, Mesh, MeshDepthMaterial,
  MeshStandardMaterial, RGBADepthPacking, Uint8BufferAttribute, type WebGLProgramParametersWithUniforms,
  type WebGLRenderer } from "three";

import { decorationSwayPart, type DecorationSwaySource,
  decorationSwayWeights } from "../../../render-common/plants/decoration-sway-weights";
import { NOISE_GLSL } from "../../../render-common/shaders/common-glsl";
import { WIND_GLSL } from "../../../render-common/shaders/prop-glsl";

/** Shared renderer uniforms the sway reads: the same wind field, gusts and clock as the world trees. */
const SWAY_UNIFORM_NAMES = ["uNoiseTexture", "uTime", "uWind", "uWindPhase"] as const;
const SWAY_ATTRIBUTE = "decorationSway";
/** Leaf flutter relative to the world-tree flutter (decoration leaves are smaller). */
const DECORATION_FLUTTER = .7;

const VERTEX_PARS = `
attribute vec3 ${SWAY_ATTRIBUTE};
uniform float uTime;
uniform vec2 uWind;
${NOISE_GLSL}
${WIND_GLSL}
`;

/**
 * Trunk < branch < leaf (attribute xyz): the whole plant leans with the world-tree wind field at its
 * own position, branches add the secondary sway, leaves flutter about their attachment. The offset
 * is world space, turned back into the (yaw-only) instance space.
 */
const VERTEX_SWAY = `
#include <begin_vertex>
{
#ifdef USE_INSTANCING
  mat4 swayWorld = modelMatrix * instanceMatrix;
#else
  mat4 swayWorld = modelMatrix;
#endif
  vec3 swayOrigin = swayWorld[3].xyz;
  float swayPhase = dot(swayOrigin.xz, vec2(1.7, 2.3));
  vec2 swayLean = windDisplacement(swayOrigin.xz, swayPhase, uTime) * ${SWAY_ATTRIBUTE}.x;
  transformed += transpose(mat3(swayWorld)) * vec3(swayLean.x, 0.0, swayLean.y);
  transformed += branchSway(position, swayPhase, uTime) * ${SWAY_ATTRIBUTE}.y;
  transformed += flutterOffset(position, swayPhase, uTime) * ${SWAY_ATTRIBUTE}.z *
    (0.25 + length(uWind)) * ${DECORATION_FLUTTER.toFixed(2)};
}
`;

const injectSway = (uniforms: Record<string, IUniform>) => (shader: WebGLProgramParametersWithUniforms) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace("#include <begin_vertex>", VERTEX_SWAY);
};

const SWAY_CACHE_KEY = "decoration-sway-v1";

/** The swaying twin of a plant material: the source's own shader hook first, then the sway. */
const swayingMaterial = (source: MeshStandardMaterial, inject: ReturnType<typeof injectSway>) => {
  const material = source.clone();
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    source.onBeforeCompile(shader, renderer);
    inject(shader);
  };
  material.customProgramCacheKey = () => `${source.customProgramCacheKey()}:${SWAY_CACHE_KEY}`;
  return material;
};

/** Shadow twin with the same displacement, so the sun shadow sways with the plant. */
const swayingDepth = (source: MeshStandardMaterial, inject: ReturnType<typeof injectSway>) => {
  const cutout = source.alphaTest > 0 && source.map;
  const depth = new MeshDepthMaterial({ alphaTest: cutout ? source.alphaTest : 0, depthPacking: RGBADepthPacking,
    map: cutout ? source.map : null, side: DoubleSide });
  depth.onBeforeCompile = inject;
  depth.customProgramCacheKey = () => `${SWAY_CACHE_KEY}:depth`;
  return depth;
};

interface SwayTemplate {
  dispose(): void;
  root: { children: readonly unknown[] };
}

interface PlantMesh {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  part: ReturnType<typeof decorationSwayPart>;
}

/** Every mesh must be a known plant or structure part on a lit standard material (no impostor cards). */
const plantMeshes = (template: SwayTemplate): PlantMesh[] | undefined => {
  const meshes: PlantMesh[] = [];
  for (const child of template.root.children) {
    if (!(child instanceof Mesh) || !(child.material instanceof MeshStandardMaterial)) return undefined;
    const part = decorationSwayPart(child.name);
    if (!part || child.userData.decorationSway) return undefined;
    meshes.push({ mesh: child as PlantMesh["mesh"], part });
  }
  return meshes.some(entry => entry.part !== "structure") ? meshes : undefined;
};

const positionsOf = (geometry: BufferGeometry) => {
  const attribute = geometry.getAttribute("position");
  const positions = new Float32Array(attribute.count * 3);
  for (let index = 0; index < attribute.count; index++)
    positions.set([attribute.getX(index), attribute.getY(index), attribute.getZ(index)], index * 3);
  return positions;
};

/**
 * D08 (High only, `QualityPreset.decorationWind`): decoration plants sway with the shared world wind.
 * `prepare` bakes the hierarchy into each plant geometry and gives plant meshes swaying material and
 * depth twins; structures (pots, soil, frames, stone, iron) keep their static materials. Templates
 * with an unknown or impostor part stay static. The returned template also frees the twins.
 */
export const createDecorationWindSway = (shared: Record<string, IUniform>) => {
  const inject = injectSway(Object.fromEntries(SWAY_UNIFORM_NAMES.flatMap(name =>
    shared[name] ? [[name, shared[name]]] : [])));
  const ready = SWAY_UNIFORM_NAMES.every(name => shared[name]);
  const prepare = <Template extends SwayTemplate>(template: Template): Template => {
    const meshes = ready ? plantMeshes(template) : undefined;
    if (!meshes) return template;
    const sources: DecorationSwaySource[] = meshes.map(({ mesh, part }) => ({ part: part!,
      positions: positionsOf(mesh.geometry) }));
    const weights = decorationSwayWeights(sources);
    const twins = new Map<Material, { depth: MeshDepthMaterial; material: MeshStandardMaterial }>();
    const twinFor = (source: MeshStandardMaterial) => {
      const twin = twins.get(source) ??
        { depth: swayingDepth(source, inject), material: swayingMaterial(source, inject) };
      twins.set(source, twin);
      return twin;
    };
    meshes.forEach(({ mesh }, index) => {
      const sway = weights[index];
      if (!sway) return;
      // A geometry shared by two meshes (leaf faces and their silver undersides) is baked once.
      if (!mesh.geometry.getAttribute(SWAY_ATTRIBUTE))
        mesh.geometry.setAttribute(SWAY_ATTRIBUTE, new Uint8BufferAttribute(sway, 3, true));
      const { depth, material } = twinFor(mesh.material);
      mesh.material = material; mesh.customDepthMaterial = depth; mesh.userData.decorationSway = true;
    });
    const dispose = () => {
      template.dispose();
      for (const twin of twins.values()) { twin.material.dispose(); twin.depth.dispose(); }
      twins.clear();
    };
    return { ...template, dispose };
  };
  return { prepare };
};
export type DecorationWindSway = ReturnType<typeof createDecorationWindSway>;
