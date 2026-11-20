import { type MeshStandardMaterial, ShaderChunk } from "three";

const diffuseLine = "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );";
const thinLeafChunk = ShaderChunk.lights_physical_pars_fragment.replace(diffuseLine, `${diffuseLine}
  // Thin elm lamina transmits a restrained fraction of incident light to its reverse face.
  float elmBackScatter = 0.18 * saturate( -dot( geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += elmBackScatter * directLight.color * BRDF_Lambert( material.diffuseColor );`);

/** Light-dependent reverse-face readability; no emissive contribution or additional render pass. */
export const configureBonsaiElmLeafLighting = (material: MeshStandardMaterial) => {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_pars_fragment>", thinLeafChunk);
  };
  material.customProgramCacheKey = () => "bonsai-elm-thin-leaf-v1";
};
