import type { BuildingPart } from "./building-recipe";

const SCALED_BOX_SHAPES: ReadonlySet<BuildingPart["shape"]> = new Set(["box", "bevel-box"]);

/** Which parts take a texture drawn to scale, and at how many texture tiles per recipe unit. */
export interface RecipeTextureScale {
  /** Surfaces whose round parts (cylinders, cones) also unroll at the same block size. */
  roundSurfaces?: ReadonlySet<BuildingPart["surface"]>;
  surfaces: ReadonlySet<BuildingPart["surface"]>;
  tilesPerUnit: number;
}

const ROUND_SHAPES: ReadonlySet<BuildingPart["shape"]> = new Set(["cylinder", "cone"]);

const takesScale = (part: BuildingPart, scale: RecipeTextureScale) => {
  if (part.worldUv || part.stock || !scale.surfaces.has(part.surface)) return false;
  if (SCALED_BOX_SHAPES.has(part.shape)) return true;
  return Boolean(scale.roundSurfaces?.has(part.surface)) && ROUND_SHAPES.has(part.shape);
};

/**
 * Bricks, stones, boards and render keep one size on every wall, whatever the box size: the
 * matching parts get recipe-unit texture coordinates (`worldUv`) instead of one tile per face.
 */
export const withRecipeTextureScale = (parts: BuildingPart[], scale: RecipeTextureScale) =>
  parts.map(part => takesScale(part, scale) ? { ...part, worldUv: scale.tilesPerUnit } : part);

/**
 * Roman ashlar and render: one texture tile (8 stone courses) per 8/7 recipe units, the typical
 * wall height, so courses keep the approved size and no longer stretch on long or tall walls.
 */
const ROMAN_MASONRY_TEXTURE_SCALE: RecipeTextureScale = {
  surfaces: new Set<BuildingPart["surface"]>(["plaster", "stone"]),
  tilesPerUnit: .875
};

/** The displayed Roman recipe's masonry texture scale (nation kits apply their own). */
export const withRomanMasonryTextureScale = (parts: BuildingPart[]) =>
  withRecipeTextureScale(parts, ROMAN_MASONRY_TEXTURE_SCALE);
