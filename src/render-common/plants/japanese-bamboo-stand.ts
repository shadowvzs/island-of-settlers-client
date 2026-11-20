import { srgbToLinear } from "../color";
import { bambooClump } from "../buildings/nation-japanese-props";
import type { BuildingPart } from "../buildings/building-recipe";
import { BAMBOO_LEAF_COLOUR } from "./bamboo-grove-species";

/** sRGB base of the Japanese `leaf` building paint (renderers/three/buildings/building-surface-paint). */
const JAPANESE_LEAF_PAINT = [91, 151, 52].map(value => value / 255) as [number, number, number];

/** The building leaf blades' detail map and shading read darker than its base paint (calibrated in review). */
const LEAF_DETAIL_LIFT = 1.7;

/** Linear vertex tint that turns the Japanese leaf paint into the approved bamboo leaf green. */
const leafTint = (): [number, number, number] => {
  const target = srgbToLinear(...BAMBOO_LEAF_COLOUR), paint = srgbToLinear(...JAPANESE_LEAF_PAINT);
  return [0, 1, 2].map(axis => target[axis]! / paint[axis]! * LEAF_DETAIL_LIFT) as [number, number, number];
};

/**
 * The Japanese buildings' bamboo stand as a standalone decoration (building use and map editor, never sold).
 * Same `bambooClump` geometry; only this copy's leaves take the shared bamboo leaf colour, so building
 * models keep their look.
 */
export const japaneseBambooStandParts = (detailed: boolean): BuildingPart[] => {
  const tint = leafTint();
  return bambooClump([0, 0, 0], detailed).map(part => part.shape === "bamboo-leaves" ? { ...part, tint } : part);
};
