import { entryByCode, fillPathTokens } from "@shared/catalog";

import type { GlbImage } from "../../glb-reader";
import { SPECIES_IDS } from "../wildlife-species";
import { type AnimalAsset,parseAnimalAsset } from "./animal-asset";

/** Decoded RGBA texture (straight alpha, rows top first like glTF uvs). */
interface DecodedImage {
  height: number;
  pixels: Uint8Array;
  width: number;
}

/** A species ready for the renderers: models plus decoded atlases. */
export interface LoadedAnimal {
  albedo: DecodedImage;
  asset: AnimalAsset;
  normal: DecodedImage | null;
}

/** Every species' model; a species whose model failed to load is null (not drawn). */
export type AnimalModels = readonly (LoadedAnimal | null)[];

/** Bundled animal GLBs by client asset path; Vite needs a static glob (one per catalog model folder). */
const ASSET_PREFIX = "../../../../assets/";
const MODEL_URLS = import.meta.glob<string>("../../../../assets/models/animals/*/*.glb",
  { eager: true, import: "default", query: "?url" });

/** The bundled URL of a species' authored model (`animal:*` `model`, a client asset GLB). */
const modelUrl = (species: number) => {
  const entry = entryByCode("animal", species);
  if (entry?.model?.kind !== "glb") throw new Error(`Animal ${species} names no GLB model`);
  const url = MODEL_URLS[`${ASSET_PREFIX}${fillPathTokens(entry.model.asset.path, { key: entry.key })}`];
  if (!url) throw new Error(`Animal model of ${entry.key} is not bundled`);
  return url;
};

const decodeImage = async (image: GlbImage): Promise<DecodedImage> => {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
    {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none"
    }
  );
  const { height, width } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { colorSpace: "srgb" })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = context.getImageData(0, 0, width, height).data;
  return { height, pixels: new Uint8Array(data.buffer), width };
};

const loadSpecies = async (species: number): Promise<LoadedAnimal | null> => {
  try {
    const response = await fetch(modelUrl(species));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const asset = parseAnimalAsset(species, await response.arrayBuffer());
    const [albedo, normal] = await Promise.all([
      decodeImage(asset.albedo),
      asset.normal ? decodeImage(asset.normal) : null
    ]);
    return { albedo, asset, normal };
  } catch (error) {
    console.warn(`animal model of species ${species} not loaded, it is not drawn`, error);
    return null;
  }
};

/** Fetches and parses every species' GLB (in parallel) and decodes their textures. */
export const loadAnimalModels = (): Promise<AnimalModels> =>
  Promise.all(SPECIES_IDS.map((species) => loadSpecies(species)));
