import {
  Group,
  type IUniform,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms
} from "three";

import { SUN_SHADOW_GLSL } from "../three-shadows";
import { createBuildingShadowBatch } from "./building-shadow-batch";

/**
 * Reuses the island sun map, so built-in lit surfaces (buildings, roads) receive tree, building and
 * unit shadows without another shadow pass. A material's own shader extension goes in
 * `userData.extendShader` with a distinct `userData.shaderKey`.
 */
export const connectSunShadowReceivers = (
  materials: MeshStandardMaterial[],
  uniforms: Record<string, IUniform>
) => {
  for (const material of materials) {
    // A material's own vertex extension (e.g. Nubian cloth wind) runs after the shadow hookup.
    const extend = material.userData.extendShader as
      | ((shader: WebGLProgramParametersWithUniforms) => void)
      | undefined;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = "varying vec3 vBuildingWorld;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n#ifdef USE_INSTANCING\n" +
        "vBuildingWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;\n" +
        // Cross-building batches (building-static-batches.ts): per-building matrices, shared draw.
        "#elif defined(USE_BATCHING)\n" +
        "vBuildingWorld=(modelMatrix*batchingMatrix*vec4(transformed,1.0)).xyz;\n#else\n" +
        "vBuildingWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\n#endif"
      );
      shader.fragmentShader =
        "varying vec3 vBuildingWorld;\n" + SUN_SHADOW_GLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        float buildingSunVisibility=sampleSunShadow(vBuildingWorld);
        reflectedLight.directDiffuse*=buildingSunVisibility;
        reflectedLight.directSpecular*=buildingSunVisibility;`
      );
      extend?.(shader);
    };
    // The WebGPU presenter gives the stand-in of a tagged receiver the same sun shadow.
    material.userData.sunShadowReceiver = true;
    const key = extend ? `roman-island-shadow-v1-i1:${material.userData.shaderKey}` : "roman-island-shadow-v1-i1";
    material.customProgramCacheKey = () => key;
  }
};
/**
 * Compatible building pieces share one depth draw; specialized vertex paths retain casters.
 * Source meshes, materials and simulation state are borrowed, never modified or disposed.
 */
export const createBuildingShadowCaster = (
  source: Group,
  material: MeshBasicMaterial,
  enabled = true
) => {
  const root = new Group();
  root.name = "building-shadow-caster";
  root.matrixAutoUpdate = false;
  const batch = createBuildingShadowBatch(source, root, material, enabled);
  return {
    root,
    update: batch.update,
    dispose: batch.dispose,
    getStats: batch.getStats
  };
};
