import type { IUniform } from "three";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  Discard,
  floor,
  Fn,
  ivec2,
  max,
  mix,
  mod,
  normalize,
  smoothstep,
  texture,
  textureLoad,
  textureSize,
  varying,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { DataTexture, type Material, MeshBasicNodeMaterial, RGBAFormat, type Texture } from "three/webgpu";

import { PIXELS_PER_UNIT } from "../../../render-common/iso-projection";
import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createSeasonSprite } from "./prop-season";
import { createPropLight } from "./prop-surface";
import { createPropFogHiding } from "./prop-vertex";
import { createWinterNodes } from "./prop-winter";
import { sunShadowAt } from "./sun-shadow";
import { createSurfaceAir, createSurfaceColorTail } from "./surface-output";
import { createTerrainLighting } from "./terrain-nodes";
import {
  bindScalar,
  bindVector,
  createUniformBindings,
  syncUniformBindings,
  type UniformBindings
} from "./uniform-bindings";
import { createWindNodes } from "./wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface ImpostorSource {
  defines?: Record<string, unknown>;
  uniforms?: Record<string, IUniform>;
}

const HIDDEN_CLIP = vec4(2, 2, 2, 1);
/** Stands in for `uChunkMask` while the game has no mask (the mask is off then). */
const EMPTY_MASK = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);
EMPTY_MASK.needsUpdate = true;

/** The far LOD sprite material of three-impostors.ts (its DEPTH_ONLY caster twin is not ported). */
export const isImpostorMaterial = (material: Material) => {
  const { uniforms } = material as ImpostorSource;
  return uniforms?.uSpriteAlbedo !== undefined && uniforms.uSpriteNormal !== undefined &&
    uniforms.uChunkMask !== undefined;
};

/** SPRITE_FLAGS_GLSL: bit 0 of tint.w mirrors the sprite, the rest is twice its season class. */
const isMirrored = (flags: TslNode): TslNode => mod(flags, 2).greaterThan(0.5);
const seasonClassOf = (flags: TslNode): TslNode => floor(flags.mul(0.5).add(0.25));

/** The chunk mask texel of this sprite (r trees, g other plants), or visible while the mask is off. */
const createChunkVisibility = (bindings: UniformBindings, source: Record<string, IUniform>) => {
  const chunksX = bindScalar(bindings, "uChunksX");
  const enabled = bindScalar(bindings, "uMaskEnabled");
  const index = floor(attribute("chunk", "float").add(0.5));
  const columns = floor(max(chunksX, 1).add(0.5));
  const row = floor(index.div(columns));
  const coordinate: TslNode = (ivec2 as (...args: unknown[]) => TslNode)(index.sub(row.mul(columns)), row);
  const mask = (textureLoad as (...args: unknown[]) => TslNode)(EMPTY_MASK, coordinate);
  bindings.sync.push(() => { mask.value = (source.uChunkMask!.value as Texture | null) ?? EMPTY_MASK; });
  const masks = mask.rg;
  const visible = attribute("isTree", "float").greaterThan(0.5).select(masks.r, masks.g);
  return enabled.greaterThan(0.5).and(chunksX.greaterThan(0.5)).and(visible.lessThan(0.5)).not();
};

/** VERTEX_GLSL: the camera-facing billboard, its wind lean and the chunk mask. */
const createBillboard = (bindings: UniformBindings, source: Record<string, IUniform>,
  valueNoise: (point: TslNode) => TslNode) => {
  const corner = attribute("corner", "vec2") as TslNode;
  const anchor = attribute("anchor", "vec3") as TslNode;
  const frame = attribute("frame", "vec4") as TslNode;
  const rect = attribute("rect", "vec4") as TslNode;
  const params = attribute("params", "vec4") as TslNode;
  const tint = attribute("tint", "vec4") as TslNode;
  const local = corner.mul(frame.xy).sub(frame.zw);
  const mirrored = vec2(isMirrored(tint.w).select(local.x.negate(), local.x), local.y);
  const [column0, column1, column2] = [0, 1, 2].map(index => (cameraViewMatrix as TslNode).element(index));
  const right = vec3(column0.x, column1.x, column2.x);
  const up = vec3(column0.y, column1.y, column2.y);
  const placed = anchor.add(right.mul(mirrored.x).sub(up.mul(mirrored.y)).div(PIXELS_PER_UNIT));
  const height = clamp(mirrored.y.negate().div(max(frame.w, 1)), 0, 1);
  const lean = createWindNodes(valueNoise).windDisplacement(anchor.xz, params.x, bindScalar(bindings, "uTime"),
    bindVector(bindings, "uWind", 2), bindVector(bindings, "uWindPhase", 2)).mul(height.mul(height)).mul(params.w);
  const world = placed.add(vec3(lean.x, 0, lean.y));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
  return {
    clip: createChunkVisibility(bindings, source).select(clip, HIDDEN_CLIP),
    params: varying(params, "vParams") as TslNode,
    tint: varying(tint, "vTint") as TslNode,
    uv: varying(mix(rect.xy, rect.zw, corner), "vUv") as TslNode,
    world: varying(world, "vWorld") as TslNode
  };
};

/** The baked normal of a sprite pixel (mirrored sprites swap x and z). */
const spriteNormalOf = (normalSample: TslNode, tint: TslNode): TslNode => {
  const raw = normalSample.xyz.mul(2).sub(1);
  return isMirrored(tint.w).select(raw.zyx, raw);
};

/**
 * FRAGMENT_GLSL `#ifdef WINTER`: the winter crowns of the far sprites (theme snow map, the global
 * season's snow load under SEASON_SNOW, foliage kind from the bake's wind map). Null without WINTER.
 */
const createSpriteWinter = (bindings: UniformBindings, { defines, uniforms: source }: Required<ImpostorSource>,
  sprite: ReturnType<typeof createBillboard>, valueNoise: (point: TslNode) => TslNode) => {
  const windMap = source.uSpriteWind?.value as Texture | null | undefined;
  const snowMap = source.uSnowMap?.value as Texture | null | undefined;
  if (defines.WINTER === undefined || !windMap || !snowMap) return null;
  const nodes = createWinterNodes(snowMap, valueNoise);
  const kind = (texture(windMap, sprite.uv) as TslNode).b;
  const themeWinter = nodes.snowAt(sprite.world.xz);
  const load = defines.SEASON_SNOW !== undefined
    ? nodes.seasonLoadAt(sprite.world, themeWinter, bindVector(bindings, "uSeasonCover", 4)) : themeWinter;
  return (albedo: TslNode, normal: TslNode, spot: TslNode): TslNode =>
    nodes.sprite(albedo, normal, kind, themeWinter, load, spot);
};

/** The sprite texel, its season look and the discards of FRAGMENT_GLSL (alpha, fog, dormant haze). */
const createSpriteTexel = (bindings: UniformBindings, source: Required<ImpostorSource>,
  sprite: ReturnType<typeof createBillboard>, valueNoise: (point: TslNode) => TslNode) => {
  const albedoMap = texture(source.uniforms.uSpriteAlbedo!.value as Texture, sprite.uv) as TslNode;
  const normalSample = (texture(source.uniforms.uSpriteNormal!.value as Texture, sprite.uv) as TslNode).toVar();
  const hiddenByFog = createPropFogHiding(createLiveFogSampler(bindings), valueNoise);
  const size: TslNode = (textureSize as (...args: unknown[]) => TslNode)(albedoMap, 0);
  const texel = sprite.uv.mul(vec2(size));
  const winter = createSpriteWinter(bindings, source, sprite, valueNoise);
  const wintry = winter === null ? null : winter(albedoMap.rgb, spriteNormalOf(normalSample, sprite.tint), texel).toVar();
  const albedo = (wintry === null ? albedoMap.rgb : wintry.rgb).toVar();
  const season = createSeasonSprite(bindings, valueNoise)(albedo, seasonClassOf(sprite.tint.w),
    normalSample.a, sprite.params.x, texel).toVar();
  const cut = albedoMap.a.lessThan(0.5).or(hiddenByFog(sprite.params.z, sprite.world.xz))
    .or(season.a.lessThan(0.5));
  const dropped = wintry === null ? cut : cut.or(wintry.a.lessThan(0.5));
  return { dropped, normalSample, season };
};

/** FRAGMENT_GLSL colour: `shadeImpostorTexel` (leaf or prop light, fog of war) and `finishSurface`. */
const createSpriteColor = (bindings: UniformBindings, sourceMaterial: Material,
  sprite: ReturnType<typeof createBillboard>, texel: ReturnType<typeof createSpriteTexel>,
  noise: ReturnType<typeof createNoiseNodes>) => {
  const source = sourceMaterial as ImpostorSource;
  const rain = bindScalar(bindings, "uRain");
  const sunDirection = bindVector(bindings, "uSunDirection", 3);
  const sunColor = bindVector(bindings, "uSunColor", 3);
  const viewDirection = bindVector(bindings, "uViewDirection", 3);
  const lighting = createTerrainLighting(bindings, sourceMaterial, noise.fbm3, { rain, sun: sunDirection, sunColor });
  const backLightWeight = mix(0.3, 1, smoothstep(0.15, 0.5, sunDirection.y));
  const { lightLeaf, lightProp } = createPropLight({ highlight: bindScalar(bindings, "uHighlight"),
    lightSurface: lighting.lightSurface, sunColor, sunDirection, viewDirection }, backLightWeight);
  const normal = normalize(spriteNormalOf(texel.normalSample, sprite.tint));
  const albedo = texel.season.rgb.mul(sprite.tint.rgb);
  const sunVisibility = mix(1, sprite.params.y, bindScalar(bindings, "uBakedShadowWeight"))
    .mul(sunShadowAt(source.uniforms, sprite.world));
  const xz = sprite.world.xz;
  const lit = texel.normalSample.a.greaterThan(0.75)
    .select(lightLeaf(albedo, normal, sunVisibility, xz), lightProp(albedo, normal, sunVisibility, xz));
  const fog = createFogNodes({ fbm3: noise.fbm3, liveFog: createLiveFogSampler(bindings),
    noiseTexture: source.uniforms!.uNoiseTexture!.value as Texture });
  const fogged = fog.applyFogOfWar(lit, sprite.params.z, xz, bindVector(bindings, "uWorldSize", 2),
    bindScalar(bindings, "uTime"), bindScalar(bindings, "uExplorationFog"), bindScalar(bindings, "uFogOfWarLit"),
    bindVector(bindings, "uFogColor", 3), rain, viewDirection, sunDirection, sunColor);
  return vec4(createSurfaceColorTail(bindings)(fogged, createSurfaceAir(bindings).toward(sprite.world)), 1);
};

/**
 * TSL twin of the far LOD sprites (three-impostors.ts): every tree and world plant at far zoom as
 * one baked camera-facing quad, with the WINTER crowns. Not ported: the DEPTH_ONLY sun caster (its twin cast large false blocks into the far cascade; skipped).
 */
export const createTslImpostorMaterial = (sourceMaterial: Material): Material | null => {
  if (!isImpostorMaterial(sourceMaterial)) return null;
  const source = sourceMaterial as ImpostorSource;
  const noiseTexture = source.uniforms!.uNoiseTexture?.value as Texture | undefined;
  if (!noiseTexture || source.defines?.DEPTH_ONLY !== undefined) return null;
  const bindings = createUniformBindings("impostor", source.uniforms!);
  const noise = createNoiseNodes(noiseTexture);
  const sprite = createBillboard(bindings, source.uniforms!, noise.valueNoise);
  const material = new MeshBasicNodeMaterial({ side: sourceMaterial.side });
  material.vertexNode = sprite.clip;
  material.colorNode = Fn(() => {
    const texel = createSpriteTexel(bindings, { defines: source.defines ?? {}, uniforms: source.uniforms! }, sprite,
      noise.valueNoise);
    Discard(texel.dropped);
    return createSpriteColor(bindings, sourceMaterial, sprite, texel, noise);
  })();
  material.name = "wg:impostor";
  material.toneMapped = false;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
