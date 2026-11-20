import {
  DoubleSide,
  MeshStandardMaterial,
  type Texture,
  Vector2,
  type WebGLProgramParametersWithUniforms
} from "three";

import type { NationDecorSurface } from "../../../render-common/buildings/building-recipe";
import { glslLiteral } from "../../../render-common/shaders/glsl-literal";
import { paintNubianOrganicDecor } from "./nubian-organic-texture";
import {
  albedoTexture,
  type AtlasPainter,
  createAtlasPainter,
  normalTexture} from "./nubian-paint-common";
import { paintNubianPotteryAndShields } from "./nubian-pottery-shield-texture";
import { paintNubianTextileAtlas } from "./nubian-textile-texture";

/** One clock for every Nubian hanging: set once per frame by whichever hanging draws first. */
const clothTime = { value: 0 };

/** Cloth-wind tuning shared by the GLSL template and the WebGPU TSL twin (`webgpu/tsl/buildings.ts`). */
export const NUBIAN_CLOTH_WIND = {
  billowBase: .004,
  billowRipple: .012,
  gustBase: .6,
  gustRate: .37,
  gustShare: .4,
  hangMax: 1,
  hangMin: 0,
  phaseX: 7,
  phaseZ: 5,
  rippleOffset: .5,
  rippleShare: .5,
  rippleUvX: 9,
  rippleUvY: 4,
  timeScale: 1.9
} as const;

/**
 * Light wind on the hangings (High): the hem on the rod stays put, the cloth below billows
 * outward along its own normal (never into the wall) with a ripple travelling across it.
 * Weight comes from the texture's v (1 at the rod, 0 at the fringe), so no extra attribute.
 */
const CLOTH = NUBIAN_CLOTH_WIND;
const CLOTH_WIND_GLSL = `
float clothHang = clamp(1.0 - uv.y, ${glslLiteral(CLOTH.hangMin)}, ${glslLiteral(CLOTH.hangMax)});
float clothPhase = nubianClothTime * ${glslLiteral(CLOTH.timeScale)} + ` +
  `position.x * ${glslLiteral(CLOTH.phaseX)} + position.z * ${glslLiteral(CLOTH.phaseZ)};
float clothRipple = sin(clothPhase + uv.y * ${glslLiteral(CLOTH.rippleUvY)} - ` +
  `uv.x * ${glslLiteral(CLOTH.rippleUvX)}) * ${glslLiteral(CLOTH.rippleShare)} + ` +
  `${glslLiteral(CLOTH.rippleOffset)};
float clothGust = ${glslLiteral(CLOTH.gustBase)} + ${glslLiteral(CLOTH.gustShare)} * ` +
  `sin(clothPhase * ${glslLiteral(CLOTH.gustRate)});
transformed += objectNormal * clothHang * clothHang * (${glslLiteral(CLOTH.billowBase)} + ` +
  `${glslLiteral(CLOTH.billowRipple)} * clothRipple * clothGust);
`;

const addClothWind = (shader: WebGLProgramParametersWithUniforms) => {
  shader.uniforms.nubianClothTime = clothTime;
  shader.vertexShader = `uniform float nubianClothTime;\n${shader.vertexShader}`.replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>\n${CLOTH_WIND_GLSL}`
  );
};

/**
 * Sun-shadow hookup (building-shadows.ts) replaces onBeforeCompile; it runs this extension too and
 * keys its program by it, so the wind survives on the island renderer.
 */
const withClothWind = (material: MeshStandardMaterial) => {
  material.onBeforeCompile = addClothWind;
  material.customProgramCacheKey = () => "nubian-cloth-wind-v1";
  material.userData.extendShader = addClothWind;
  material.userData.shaderKey = "nubian-cloth-wind-v1";
  material.onBeforeRender = () => {
    clothTime.value = performance.now() / 1000;
  };
  return material;
};

const atlasMaterial = (
  painter: AtlasPainter,
  detailed: boolean,
  roughness: number,
  textures: Texture[]
) => {
  const map = albedoTexture(painter),
    normalMap = detailed ? normalTexture(painter, (2 * painter.width) / 1024) : null;
  textures.push(map, ...(normalMap ? [normalMap] : []));
  return new MeshStandardMaterial({
    map,
    metalness: 0,
    normalMap,
    normalScale: new Vector2(0.7, 0.7),
    roughness,
    vertexColors: true
  });
};

/**
 * The Nubian decor atlases (High 1024², Minimal 256²): woven hangings (cut-out fringe, wind on
 * High) and one painted atlas shared by jars, shields, skulls and hats, so every prop of a
 * building merges into two batches.
 */
export const createNubianDecorMaterials = (detailed: boolean) => {
  const textures: Texture[] = [];
  const textile = atlasMaterial(paintNubianTextileAtlas(detailed), detailed, 0.96, textures);
  textile.alphaTest = 0.5;
  textile.side = DoubleSide;
  const decorPainter = createAtlasPainter(detailed ? 1024 : 256, detailed ? 1024 : 256);
  paintNubianPotteryAndShields(decorPainter);
  paintNubianOrganicDecor(decorPainter);
  const decor = atlasMaterial(decorPainter, detailed, 0.72, textures);
  const materials: Record<Extract<NationDecorSurface, `nubian-${string}`>, MeshStandardMaterial> = {
    "nubian-decor": decor,
    "nubian-textile": detailed ? withClothWind(textile) : textile
  };
  return { dispose: () => textures.forEach((texture) => texture.dispose()), materials };
};
