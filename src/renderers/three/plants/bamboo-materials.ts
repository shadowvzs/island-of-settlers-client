import { DataTexture, DoubleSide, type IUniform, MeshStandardMaterial, RGBAFormat, ShaderChunk, Vector2,
  type WebGLProgramParametersWithUniforms } from "three";

import { NOISE_GLSL } from "../../../render-common/shaders/common-glsl";
import { WIND_GLSL } from "../../../render-common/shaders/prop-glsl";
import type { BambooTextures } from "./bamboo-textures";

/** World units of sway at bend weight 1 per unit of the shared vegetation wind displacement. */
const BAMBOO_BEND = 2.4;

const VERTEX_PARS = `
attribute vec3 bambooSway;
uniform float uTime;
uniform vec2 uWind;
${NOISE_GLSL}
${WIND_GLSL}
`;

/**
 * Whole-culm sway from the shared vegetation wind field: the displacement depends only on the culm's
 * phase and its bend weight (height fraction squared), so branches and sprays riding on a node move
 * exactly with that node. High adds leaf flutter pinned at each petiole.
 */
const VERTEX_WIND = `
#include <begin_vertex>
{
  vec3 bambooOrigin = vec3(0.0);
  mat3 bambooBasis = mat3(1.0);
#ifdef USE_INSTANCING
  bambooOrigin = instanceMatrix[3].xyz;
  bambooBasis = mat3(instanceMatrix);
#endif
  vec2 bambooGust = windDisplacement(bambooOrigin.xz, bambooSway.x, uTime) * bambooSway.y * ${BAMBOO_BEND.toFixed(2)};
  transformed += transpose(bambooBasis) * vec3(bambooGust.x, 0.0, bambooGust.y);
#ifdef BAMBOO_FLUTTER
  transformed += flutterOffset(position, bambooSway.x, uTime) * bambooSway.z * (0.25 + length(uWind));
#endif
}
`;

/** Leaf undersides are paler and slightly glaucous, as in real bamboo. */
const LEAF_UNDERSIDE = `
#include <color_fragment>
if ( !gl_FrontFacing ) {
  float bambooGrey = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( bambooGrey ) * vec3( 1.05, 1.15, 1.0 ), 0.28 );
}
`;

/** Both leaf faces keep the authored sky-leaning normal: thin blades are lit through, never black. */
const SKY_LIT_NORMAL = ShaderChunk.normal_fragment_begin.replace("gl_FrontFacing ? 1.0 : - 1.0", "1.0");

/** Island-free scenes (icons, reviews): calm air, neutral noise. */
const fallbackUniforms = () => {
  const noise = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat);
  noise.needsUpdate = true;
  return { noise, uniforms: { uNoiseTexture: { value: noise }, uTime: { value: 0 },
    uWind: { value: new Vector2() }, uWindPhase: { value: new Vector2() } } as Record<string, IUniform> };
};

const windHook = (uniforms: Record<string, IUniform>, leaf: boolean) =>
  (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace("#include <begin_vertex>", VERTEX_WIND);
    if (!leaf) return;
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", SKY_LIT_NORMAL)
      .replace("#include <color_fragment>", LEAF_UNDERSIDE);
  };

/**
 * One culm material and one leaf material per detail level: vertex-tinted shared atlases, High normal
 * maps, leaf flutter only on High. No extra pass, no alpha test (leaf outlines are real geometry).
 */
export const createBambooMaterials = (textures: BambooTextures, detailed: boolean,
  shared?: Record<string, IUniform>) => {
  const fallback = fallbackUniforms();
  const uniforms = Object.fromEntries(["uNoiseTexture", "uTime", "uWind", "uWindPhase"].map(name =>
    [name, shared?.[name] ?? fallback.uniforms[name]!]));
  const culm = new MeshStandardMaterial({ map: textures.culm.map, metalness: 0,
    normalMap: detailed ? textures.culm.normalMap : null, roughness: .5, vertexColors: true });
  const leaf = new MeshStandardMaterial({ map: textures.leaf.map, metalness: 0,
    normalMap: detailed ? textures.leaf.normalMap : null, roughness: .62, side: DoubleSide, vertexColors: true });
  culm.name = "bamboo-culm"; leaf.name = "bamboo-leaf";
  const tier = detailed ? "high" : "minimal";
  if (detailed) leaf.defines = { BAMBOO_FLUTTER: "" };
  culm.onBeforeCompile = windHook(uniforms, false);
  leaf.onBeforeCompile = windHook(uniforms, true);
  culm.customProgramCacheKey = () => `bamboo-culm-v2:${tier}`;
  leaf.customProgramCacheKey = () => `bamboo-leaf-v2:${tier}`;
  return { culm, leaf, dispose: () => { culm.dispose(); leaf.dispose(); fallback.noise.dispose(); } };
};
export type BambooMaterials = ReturnType<typeof createBambooMaterials>;
