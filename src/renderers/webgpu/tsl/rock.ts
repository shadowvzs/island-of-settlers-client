import type { IUniform } from "three";
import {
  attribute,
  clamp,
  Discard,
  dot,
  float,
  Fn,
  fwidth,
  length,
  min,
  normalize,
  positionLocal,
  texture,
  vec2,
  vec3,
  vec4,
  varying
} from "three/tsl";
import { type Material, MeshBasicNodeMaterial, type Texture } from "three/webgpu";

import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createPropFogHiding } from "./prop-vertex";
import {
  createDepositDetailNodes,
  type StoneFamily
} from "./rock-detail";
import { createRockFormNodes } from "./rock-form";
import { createRockLightNodes, createRockShadingNodes } from "./rock-light";
import { createRockSurfaceNodes, type RockSurface } from "./rock-surface";
import { sunShadowReceiverOf } from "./sun-shadow";
import { createSurfaceAir, createSurfaceColorTail } from "./surface-output";
import { createTerrainLighting } from "./terrain-nodes";
import {
  bindComputed,
  bindScalar,
  bindTexture,
  bindVector,
  createUniformBindings,
  syncUniformBindings
} from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface RockSource {
  defines?: Record<string, unknown>;
  fragmentShader?: string;
  uniforms?: Record<string, IUniform>;
}

const ROCK_SOURCE_MARKER = "struct RockSurface";

/** The sculpted rock material of `three-rocks.ts` (not its sun-depth twin). */
export const isRockMaterial = (material: Material) => {
  const source = material as RockSource;
  return source.uniforms?.uRockTexture !== undefined &&
    source.uniforms.uRockNormal !== undefined &&
    source.fragmentShader?.includes(ROCK_SOURCE_MARKER) === true;
};

/** `SNOW_MAP_GLSL getSnowMap`: the theme snow 0..1 at a world xz. */
const createSnowSampler = (bindings: ReturnType<typeof createUniformBindings>) => {
  if (!bindings.source.uSnowMap?.value) return (_xz: TslNode): TslNode => float(0);
  const snowMap = bindTexture(bindings, "uSnowMap");
  const texels = vec2(snowMap.size(0));
  return (xz: TslNode): TslNode => texture(snowMap, xz.add(0.5).div(texels)).r;
};

/** `MACRO_NORMAL_GLSL getMacroNormal`: the landform normal (xyz) and weight (w) at a world xz. */
const createMacroNormalSampler = (bindings: ReturnType<typeof createUniformBindings>) => {
  const macro = bindTexture(bindings, "uMacroNormals");
  const texels = vec2(macro.size(0));
  return (xz: TslNode): TslNode => {
    const texel = texture(macro, xz.add(0.5).div(texels));
    return vec4(normalize(texel.xyz.mul(2).sub(1)), texel.a);
  };
};

/** `STONE_TINT`: the boulder's own shading tinted in the material colour (deposit clusters). */
const createStoneTint = (bindings: ReturnType<typeof createUniformBindings>) => {
  const value = bindings.source.uStoneTint?.value as { b: number; g: number; r: number } | undefined;
  if (value === undefined) return null;
  return vec3(
    bindComputed(bindings, () => value.r),
    bindComputed(bindings, () => value.g),
    bindComputed(bindings, () => value.b)
  ) as TslNode;
};

/** The deposit family detail appended after the flat tint (`STONE_DEPOSIT_DETAIL_GLSL`). */
const createDepositDetail = (sourceMaterial: Material,
  noise: ReturnType<typeof createNoiseNodes>) => {
  const family = (sourceMaterial.userData as { rockDepositFamily?: StoneFamily }).rockDepositFamily;
  if (family === undefined) return null;
  const details = createDepositDetailNodes(noise.valueNoise, noise.valueNoise4);
  return details[family] ?? null;
};

/** The rock surface, tinted, deposit-detailed, lit, fogged and tone-mapped. */
const createRockFragment = (options: {
  bindings: ReturnType<typeof createUniformBindings>;
  detailed: boolean;
  noise: ReturnType<typeof createNoiseNodes>;
  noiseTexture: Texture;
  rockNormal: Texture;
  rockTexture: Texture;
  sourceMaterial: Material;
}) => {
  const { bindings, detailed, noise, noiseTexture, rockNormal, rockTexture, sourceMaterial } =
    options;
  const world = varying(positionLocal, "vWorld") as TslNode;
  const normal = varying(attribute("normal", "vec3"), "vNormal") as TslNode;
  const mask = varying(attribute("rockMask", "vec4"), "vMask") as TslNode;
  const extra = varying(attribute("rockExtra", "vec4"), "vExtra") as TslNode;
  const normalVector = normalize(normal) as TslNode;
  const footprint = length(fwidth(world)) as TslNode;
  const snowAt = createSnowSampler(bindings);
  const macroNormal = createMacroNormalSampler(bindings);
  const form = createRockFormNodes(noise.valueNoise, noise.valueNoise4, detailed);
  const surface = createRockSurfaceNodes({
    detailed,
    fbm3: noise.fbm3,
    getFractures: form.getFractures,
    macroNormal,
    rockNormal,
    rockTexture,
    snowAt,
    time: bindScalar(bindings, "uTime"),
    valueNoise: noise.valueNoise,
    valueNoise4: noise.valueNoise4
  });
  const rock: RockSurface = detailed
    ? surface.getRockDetailSurface(world, normalVector, mask, extra, footprint)
    : surface.getRockSurface(world, normalVector, mask, extra, footprint);
  let albedo: TslNode = rock.albedo;
  const tint = createStoneTint(bindings);
  if (tint !== null) {
    const shade = dot(albedo, vec3(0.299, 0.587, 0.114));
    albedo = tint.mul(clamp(shade.mul(1.8), 0.4, 1.15));
    const deposit = createDepositDetail(sourceMaterial, noise);
    if (deposit !== null && detailed) albedo = deposit(albedo, world, footprint);
  } else if (bindings.source.uRockPropTint) {
    // GROUND-PALETTE step 5: the island's rock palette, like the ground rock (`uRockPropTint` of the GLSL rock).
    albedo = min(albedo.mul(bindVector(bindings, "uRockPropTint", 3)), vec3(1)) as TslNode;
  }

  const liveFog = createLiveFogSampler(bindings);
  const visibility = extra.y as TslNode;
  const hidden = createPropFogHiding(liveFog, noise.valueNoise)(visibility, world.xz);

  const rain = bindScalar(bindings, "uRain");
  const sunDirection = bindVector(bindings, "uSunDirection", 3);
  const sunColor = bindVector(bindings, "uSunColor", 3);
  const viewDirection = bindVector(bindings, "uViewDirection", 3);
  const time = bindScalar(bindings, "uTime");
  const lighting = createTerrainLighting(bindings, sourceMaterial, noise.fbm3,
    { rain, sun: sunDirection, sunColor });
  const rockLight = createRockLightNodes({
    ambientGround: bindVector(bindings, "uAmbientGround", 3),
    ambientSky: bindVector(bindings, "uAmbientSky", 3),
    highlight: bindScalar(bindings, "uHighlight"),
    sunColor,
    sunDirection,
    viewDirection
  });
  // `sampleSoftRockShadow`: five lookups over the rock skin (C-1).
  const sunVisibility = sunShadowReceiverOf(bindings.source)?.sampleSoft(world, normalVector) ?? float(1);
  const shading = createRockShadingNodes(lighting, rockLight);
  const contrasted = shading.assembleRockShading(albedo, rock, sunVisibility,
    world.xz as TslNode);

  const fog = createFogNodes({ fbm3: noise.fbm3, liveFog, noiseTexture });
  const fogged = fog.applyFogOfWar(contrasted, visibility, world.xz,
    bindVector(bindings, "uWorldSize", 2), time,
    bindScalar(bindings, "uExplorationFog"), bindScalar(bindings, "uFogOfWarLit"),
    bindVector(bindings, "uFogColor", 3), rain, viewDirection, sunDirection, sunColor);
  const finish = createSurfaceColorTail(bindings);
  const air = createSurfaceAir(bindings);
  // GLSL `if (isHiddenByFog(...)) discard;`: the statement must stay in the fragment stack.
  return Fn(() => {
    Discard(hidden);
    return finish(fogged, air.toward(world));
  })();
};

/**
 * TSL twin of the sculpted rock material (`three-rocks.ts`): the ROCK_SURFACE/ROCK_DETAIL
 * surface, the rock fill and specular light, fog-of-war and the colour tail. High and Minimal
 * (ROCK_LITE) both work, with the camera air of `finishSurface`.
 */
export const createTslRockMaterial = (sourceMaterial: Material): Material | null => {
  const source = sourceMaterial as RockSource;
  const uniforms = source.uniforms;
  const rockTexture = uniforms?.uRockTexture?.value as Texture | undefined;
  const rockNormal = uniforms?.uRockNormal?.value as Texture | undefined;
  const noiseTexture = uniforms?.uNoiseTexture?.value as Texture | undefined;
  if (uniforms === undefined || rockTexture === undefined || rockNormal === undefined ||
    noiseTexture === undefined) return null;
  const bindings = createUniformBindings("rock", uniforms);
  // The surface kernels use `If` (ore kinds, stone detail), which needs a statement stack.
  const fragmentNode = Fn(() => createRockFragment({
    bindings,
    detailed: source.defines?.ROCK_LITE === undefined,
    noise: createNoiseNodes(noiseTexture),
    noiseTexture,
    rockNormal,
    rockTexture,
    sourceMaterial
  }))();
  const material = new MeshBasicNodeMaterial({
    depthTest: sourceMaterial.depthTest,
    depthWrite: sourceMaterial.depthWrite,
    side: sourceMaterial.side
  });
  material.name = "wg:rock";
  material.colorNode = vec4(fragmentNode, 1);
  material.toneMapped = false;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
