import {
  DataTexture,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type WebGLProgramParametersWithUniforms
} from "three";

import { ROAD_APPEARANCE } from "../../../render-common/road-appearance";
import {
  TRAFFIC_PAVED_GROOVE_GLSL,
  TRAFFIC_RUT_GLSL,
  TRAFFIC_WEAR_FIELD_GLSL
} from "../../../render-common/shaders/traffic-wear-glsl";
import type { RoadTier } from "../../../shared/settlement/road-types";
import { paintDirtRoadTexture } from "./road-dirt-texture";
import { loadRoadSoilMaterial } from "./road-soil-material";
import { paintStoneRoadTexture } from "./road-stone-textures";

const DIRT_ROAD_SHADER_KEY = "compacted-dirt-road-edges-v1";
const DIRT_ROAD_RUT_SHADER_KEY = "compacted-dirt-road-edges-ruts-v2";
const PAVED_ROAD_GROOVE_SHADER_KEY = "paved-road-grooves-v1";

/** The shared traffic-wear field (dirt-road ruts and paved-road cart grooves). */
export interface RoadRutUniforms {
  uTrafficWear: IUniform;
}

/** One density fetch, then one line fetch only on sections carts really used. */
const addRoadWear = (
  shader: WebGLProgramParametersWithUniforms, ruts: RoadRutUniforms, glsl: string, shade: string
) => {
  Object.assign(shader.uniforms, ruts);
  shader.vertexShader = `varying vec2 vRoadRutXz;\n${
    shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoadRutXz = uv;")}`;
  shader.fragmentShader = `varying vec2 vRoadRutXz;\n${glsl}${shader.fragmentShader.replace("#include <color_fragment>",
    `#include <color_fragment>\n    diffuseColor.rgb *= ${shade};`)}`;
};

/**
 * Dirt road edges: the vertex alpha feathers the map's own alpha into the verge. With `ruts`, the
 * traffic-wear field also draws wheel ruts on busy sections (paved tiers use their own faint grooves).
 */
const createDirtRoadShader = (ruts?: RoadRutUniforms) => (shader: WebGLProgramParametersWithUniforms) => {
  shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
    `#include <map_fragment>
    #ifdef USE_MAP
      diffuseColor.a = opacity;
    #endif`).replace("#include <color_fragment>",
    `#include <color_fragment>
    #if defined(USE_MAP) && defined(USE_COLOR_ALPHA)
      diffuseColor.a *= mix(sampledDiffuseColor.a, 1.0, smoothstep(.1, .9, vColor.a));
    #endif`);
  if (ruts) addRoadWear(shader, ruts, `${TRAFFIC_WEAR_FIELD_GLSL}${TRAFFIC_RUT_GLSL}`, "trafficRutShade(vRoadRutXz)");
};

/** Paved tiers keep the stone readable: only heavy traffic leaves two faint, narrow dark grooves. */
const createPavedRoadShader = (ruts?: RoadRutUniforms) => (shader: WebGLProgramParametersWithUniforms) => {
  if (ruts) addRoadWear(shader, ruts, `${TRAFFIC_WEAR_FIELD_GLSL}${TRAFFIC_PAVED_GROOVE_GLSL}`,
    "trafficPavedGrooveShade(vRoadRutXz)");
};

/** Original world-aligned seamless grit and paving; adjoining roads share the same surface. */
/**
 * Every road tier filters linearly with mipmaps: DataTexture defaults to nearest sampling, which
 * showed the small Minimal paving texture as square pixels up close (possessed view).
 */
const smoothRoadTexture = (texture: DataTexture) => {
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
};

export const createRoadMaterial = (tier: RoadTier, detailed: boolean, ruts?: RoadRutUniforms) => {
  const appearance = ROAD_APPEARANCE[tier];
  // Minimal keeps 128 px: 64 px joints read as stair steps up close (possessed view).
  const size = detailed ? 256 : 128;
  const pixels = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(pixels.length);
  if (tier === "dirt") paintDirtRoadTexture(pixels, relief, size);
  else paintStoneRoadTexture(pixels, relief, size, tier, appearance.rgb);
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  smoothRoadTexture(texture);
  const bump = detailed ? new DataTexture(relief, size, size, RGBAFormat) : undefined;
  if (bump) {
    bump.wrapS = bump.wrapT = RepeatWrapping;
    smoothRoadTexture(bump);
  }
  const material = new MeshStandardMaterial({
    bumpMap: bump,
    bumpScale: appearance.bump,
    map: texture,
    metalness: 0,
    roughness: appearance.roughness,
    vertexColors: true,
    transparent: true,
    depthWrite: false
  });
  if (tier === "dirt") {
    // Runs after the sun shadow hookup when the road receives shadows (building-shadows.ts).
    const shaderKey = ruts ? DIRT_ROAD_RUT_SHADER_KEY : DIRT_ROAD_SHADER_KEY;
    const extendShader = createDirtRoadShader(ruts);
    material.userData.shaderKey = shaderKey;
    material.userData.extendShader = extendShader;
    material.onBeforeCompile = extendShader;
    material.customProgramCacheKey = () => shaderKey;
  } else if (ruts) {
    const extendShader = createPavedRoadShader(ruts);
    material.userData.shaderKey = PAVED_ROAD_GROOVE_SHADER_KEY;
    material.userData.extendShader = extendShader;
    material.onBeforeCompile = extendShader;
    material.customProgramCacheKey = () => PAVED_ROAD_GROOVE_SHADER_KEY;
  }
  if (tier === "dirt") loadRoadSoilMaterial(material, detailed);
  // WebGPU TSL twin: the traffic-wear uniform is otherwise closure-only on onBeforeCompile.
  material.userData.roadTier = tier;
  material.userData.roadRuts = ruts;
  return material;
};
