import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { IndigenousBuildingMotif } from "./indigenous-building-motifs";

/** Paint the real stock-side stones, above the complete stock pile and below the supported eave. */
export const indigenousQuarryPainting = (recipe: BuildingRecipe,
  motif: IndigenousBuildingMotif): BuildingPart | undefined => {
  const left = recipe.door[0];
  const front = recipe.parts.filter(part => part.architecture && part.surface === "indigenous-rubble" &&
    part.size[2] < .15 && part.position[2] > recipe.door[2] - .08 && part.position[0] < left &&
    part.shape === "box").sort((a, b) => b.size[0] - a.size[0])[0];
  if (!front) return undefined;
  const wall = getRomanPartBounds(front), width = Math.min(.66, front.size[0] - .14);
  const x = (wall.min[0] + wall.max[0]) / 2;
  const stockTop = Math.max(.29, ...recipe.parts.filter(part => part.stock).map(part => {
    const bounds = getRomanPartBounds(part);
    if (bounds.max[0] < x - width / 2 || bounds.min[0] > x + width / 2) return 0;
    return bounds.max[1];
  }));
  const eave = wall.max[1], height = Math.min(.48, eave - stockTop - .10);
  if (height <= .15) return undefined;
  const y = (stockTop + eave) / 2, minX = x - width / 2, maxX = x + width / 2;
  const minY = y - height / 2, maxY = y + height / 2;
  const carriers = recipe.parts.filter(part => {
    if (!part.architecture || part.stock || part.position[2] < recipe.door[2] - .08 ||
      part.size[2] >= .15 || !(part.indigenousMasonryStone || part === front)) return false;
    const bounds = getRomanPartBounds(part);
    return bounds.min[0] < maxX && bounds.max[0] > minX && bounds.min[1] < maxY && bounds.max[1] > minY;
  }).map(part => ({ masonry: part.indigenousMasonryStone, position: [...part.position] as typeof part.position,
    size: [...part.size] as typeof part.size, variant: part.decorVariant }));
  return { architecture: true, compactGeometry: true, indigenousPigment: motif,
    indigenousPigmentCarriers: carriers, indigenousPigmentProjection: "front",
    indigenousPigmentRegion: [.5, .5, .5, .5], position: [x, y, front.position[2]],
    shape: "indigenous-pigment", size: [width, height, .002], stage: 2,
    surface: "paint", tint: [1, 1, 1], wallMountedDecoration: true };
};
