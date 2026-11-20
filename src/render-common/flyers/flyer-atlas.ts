import { paintBirdFeathers } from "../birds/bird-feathers";
import { paintButterflyWings } from "../butterflies/butterfly-wing-texture";
import { FLYER_ATLAS_SIZE } from "./flyer-atlas-layout";

/** The square flyer atlas (RGBA, alpha = coverage of the butterfly wings). */
export interface FlyerAtlas {
  pixels: Uint8Array;
  size: number;
}

/**
 * Paints the flyer atlas (bird feathers, butterfly wing variants): deterministic, about 50 ms,
 * so the app paints it in a worker.
 */
export const createFlyerAtlas = (): FlyerAtlas => {
  const pixels = new Uint8Array(FLYER_ATLAS_SIZE * FLYER_ATLAS_SIZE * 4);
  paintButterflyWings(pixels);
  paintBirdFeathers(pixels);
  return { pixels, size: FLYER_ATLAS_SIZE };
};
