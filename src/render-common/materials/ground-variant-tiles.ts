import {
  GROUND_DETAIL_IDS, GROUND_LITTER_IDS, GROUND_VARIANT_TILE_IDS
} from "../shaders/ground-variant-layers-glsl";
import type { MaterialLayer } from "./material-textures";

/**
 * The baked variant tiles (assets/ground-variants, tools/assets/ground-variant-tiles.ts) as ground layers: three
 * opaque PNGs per variant (albedo RGB; relief: height, normal x, normal z; surface: AO, roughness) packed into the
 * two RGBA layer formats. Opaque files decode without premultiplication, so every channel keeps its bytes.
 */
const TILE_URLS = [...GROUND_VARIANT_TILE_IDS, ...GROUND_LITTER_IDS, ...GROUND_DETAIL_IDS].map(id => ({
  albedo: new URL(`../../../assets/ground-variants/${id}-albedo.png`, import.meta.url).href,
  relief: new URL(`../../../assets/ground-variants/${id}-relief.png`, import.meta.url).href,
  surface: new URL(`../../../assets/ground-variants/${id}-surface.png`, import.meta.url).href
}));

const decodeRgba = async (url: string, size: number) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ground variant tile ${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none", premultiplyAlpha: "none", resizeHeight: size, resizeQuality: "high", resizeWidth: size
  });
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, size, size).data;
};

/** Albedo + height and normal x/z + AO + roughness of one variant from its three maps. */
export const packVariantMaps = (albedo: ArrayLike<number>, relief: ArrayLike<number>, surface: ArrayLike<number>,
  size: number): MaterialLayer => {
  const albedoHeight = new Uint8Array(size * size * 4);
  const normalRoughness = new Uint8Array(size * size * 4);
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const at = pixel * 4;
    albedoHeight[at] = albedo[at]!;
    albedoHeight[at + 1] = albedo[at + 1]!;
    albedoHeight[at + 2] = albedo[at + 2]!;
    albedoHeight[at + 3] = relief[at]!;
    normalRoughness[at] = relief[at + 1]!;
    normalRoughness[at + 1] = relief[at + 2]!;
    normalRoughness[at + 2] = surface[at]!;
    normalRoughness[at + 3] = surface[at + 1]!;
  }
  return { albedoHeight, normalRoughness };
};

/** A flat stand-in (mid grey, flat normal) when a tile cannot load: the ground still draws. */
const flatLayer = (size: number): MaterialLayer => {
  const albedoHeight = new Uint8Array(size * size * 4).fill(128);
  const normalRoughness = new Uint8Array(size * size * 4);
  for (let at = 0; at < normalRoughness.length; at += 4) normalRoughness.set([128, 128, 255, 230], at);
  return { albedoHeight, normalRoughness };
};

/**
 * Every variant, litter and detail tile at the painted tiles' size, in GROUND_VARIANT_TILE_IDS, GROUND_LITTER_IDS then
 * GROUND_DETAIL_IDS order (the array layers after the base).
 */
export const loadGroundVariantLayers = (size: number) => Promise.all(TILE_URLS.map(async urls => {
  try {
    const [albedo, relief, surface] = await Promise.all([urls.albedo, urls.relief, urls.surface]
      .map(url => decodeRgba(url, size)));
    return packVariantMaps(albedo!, relief!, surface!, size);
  } catch (error) {
    console.warn("ground variant tile failed, using a flat layer", error);
    return flatLayer(size);
  }
}));
