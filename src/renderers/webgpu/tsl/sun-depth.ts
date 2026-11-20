import type { IUniform } from "three";
import { attribute, Discard, float, Fn, positionLocal, texture, varying, vec3, vec4 } from "three/tsl";
import { DoubleSide, type Material, MeshBasicNodeMaterial, type Side, type Texture } from "three/webgpu";

import type { SeasonClass } from "../../../render-common/seasonal-appearance/season-palettes";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createSeasonFoliage, createSeasonPick } from "./prop-season";
import { isLeafAtlasUv } from "./prop-surface";
import { createPropFogHiding, createPropVertex } from "./prop-vertex";
import { createWinterNodes, foliageKindOf } from "./prop-winter";
import { PropNodeMaterial } from "./props";
import { createUniformBindings, syncUniformBindings, type UniformBindings } from "./uniform-bindings";
import { createWindNodes } from "./wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface ShaderSource {
  defines?: Record<string, unknown>;
  fragmentShader?: string;
  uniforms?: Record<string, IUniform>;
  vertexShader?: string;
}

/**
 * C-1: the sun-depth casters of the node renderer. Depth only (no colour write); each caster keeps
 * the vertex contract and the discards of its WebGL depth twin, so shadows sway with the trees and
 * dormant, wintry or fog-hidden foliage leaves the shadow as in WebGL.
 */
const depthOnly = (material: MeshBasicNodeMaterial, name: string, bindings?: UniformBindings) => {
  material.colorWrite = false;
  material.name = name;
  material.toneMapped = false;
  if (bindings !== undefined) material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};

/** The plain caster (Three's own transform, skinning, instancing and batching), per face side. */
export const createSunDepthMaterial = (side: Side = DoubleSide) =>
  depthOnly(new MeshBasicNodeMaterial({ side }), "wg:sun-depth");

/** `createPropDepthMaterial` (three-prop-materials.ts): the prop vertex, leaf alpha and keep discards. */
export const isPropDepthMaterial = (material: Material) => {
  const { fragmentShader, uniforms, vertexShader } = material as ShaderSource;
  return uniforms?.uLeafAtlas !== undefined && uniforms.uIsGrass !== undefined &&
    vertexShader?.includes("instanceTint") === true && fragmentShader?.includes("sampleLeaf(vUv).a < 0.5") === true;
};

/** The rock caster of three-rocks.ts: the plain transform with the fog-hidden discard. */
export const isRockDepthMaterial = (material: Material) => {
  const { fragmentShader, uniforms } = material as ShaderSource;
  return uniforms?.uRockTexture !== undefined && fragmentShader?.includes("isHiddenByFog(vExtra.y") === true;
};

const createPropDiscard = (bindings: UniformBindings, source: ShaderSource, noiseTexture: Texture) => {
  const { valueNoise } = createNoiseNodes(noiseTexture);
  const liveFog = createLiveFogSampler(bindings);
  const vertex = createPropVertex({
    bindings, choppable: source.defines?.PROP_CHOP !== undefined, isGrass: false, liveFog, valueNoise,
    wind: createWindNodes(valueNoise)
  });
  const world = varying(vertex.world, "vWorld") as TslNode;
  const instance = varying(vertex.instance, "vInstance") as TslNode;
  const uv = varying(vertex.uv, "vUv") as TslNode;
  const leafAlpha = isLeafAtlasUv(uv).select(texture(source.uniforms!.uLeafAtlas!.value as Texture, uv).a, 1);
  let dropped: TslNode = createPropFogHiding(liveFog, valueNoise)(instance.y, world.xz).or(leafAlpha.lessThan(0.5));
  const snowMap = source.uniforms!.uSnowMap?.value as Texture | undefined;
  if (source.defines?.WINTER !== undefined && snowMap) {
    const winter = createWinterNodes(snowMap, valueNoise);
    dropped = dropped.or(winter.keep(foliageKindOf(uv), winter.snowAt(world.xz), world).lessThan(0.5));
  }
  if (source.defines?.SEASONAL !== undefined) {
    const pick = varying(createSeasonPick(vertex.position, vertex.phase, valueNoise), "vSeasonPick");
    const season = createSeasonFoliage(bindings, source.uniforms!.uSeasonClass!.value as SeasonClass,
      valueNoise)(vec3(1), uv, pick);
    dropped = dropped.or(season.keep.lessThan(0.5));
  }
  return { clip: vertex.clip, dropped };
};

/** The seasonal/wintry sun-depth twin of the instanced prop material. */
export const createTslPropDepthMaterial = (sourceMaterial: Material): Material | null => {
  if (!isPropDepthMaterial(sourceMaterial)) return null;
  const source = sourceMaterial as ShaderSource;
  const noiseTexture = source.uniforms!.uNoiseTexture?.value as Texture | undefined;
  if (!noiseTexture) return null;
  const bindings = createUniformBindings("prop-depth", source.uniforms!);
  const { clip, dropped } = createPropDiscard(bindings, source, noiseTexture);
  const material = new PropNodeMaterial({ side: sourceMaterial.side });
  material.vertexNode = clip;
  material.colorNode = Fn(() => {
    Discard(dropped);
    return vec4(0, 0, 0, 1);
  })();
  return depthOnly(material, "wg:prop-depth", bindings);
};

/** The rock caster: rock positions are world positions (GLSL `vWorld = position`). */
export const createTslRockDepthMaterial = (sourceMaterial: Material): Material | null => {
  if (!isRockDepthMaterial(sourceMaterial)) return null;
  const source = sourceMaterial as ShaderSource;
  const noiseTexture = source.uniforms!.uNoiseTexture?.value as Texture | undefined;
  if (!noiseTexture) return null;
  const bindings = createUniformBindings("rock-depth", source.uniforms!);
  const { valueNoise } = createNoiseNodes(noiseTexture);
  const world = varying(positionLocal, "vWorld") as TslNode;
  const visibility = varying((attribute("rockExtra", "vec4") as TslNode).y, "vVisibility") as TslNode;
  const hidden = createPropFogHiding(createLiveFogSampler(bindings), valueNoise)(visibility, world.xz);
  const material = new MeshBasicNodeMaterial({ side: sourceMaterial.side });
  material.colorNode = Fn(() => {
    Discard(hidden);
    return vec4(float(0), 0, 0, 1);
  })();
  return depthOnly(material, "wg:rock-depth", bindings);
};
