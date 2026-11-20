import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

/** Center the complete existing silhouette, rather than mirroring its one-sided occupational yard. */
export const romanStaticModelCenteringOffset = (recipe: BuildingRecipe): Point3 => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const part of recipe.parts) {
    const bounds = getRomanPartBounds(part);
    minX = Math.min(minX, bounds.min[0]); maxX = Math.max(maxX, bounds.max[0]);
    minZ = Math.min(minZ, bounds.min[2]); maxZ = Math.max(maxZ, bounds.max[2]);
  }
  return [-(minX + maxX) / 2, 0, -(minZ + maxZ) / 2];
};

/** One authored translation moves architecture, props, openings and every gameplay attachment. */
export const translateRomanBuildingRecipe = (recipe: BuildingRecipe, offset: Point3) => {
  const shift = (point: Point3): Point3 => point.map((value, axis) => value + offset[axis]!) as Point3;
  for (const part of recipe.parts) part.position = shift(part.position);
  recipe.door = shift(recipe.door);
  recipe.mechanism = shift(recipe.mechanism);
  recipe.workerExit = shift(recipe.workerExit);
  recipe.workPoint = shift(recipe.workPoint);
  if (recipe.flagAnchor) recipe.flagAnchor = shift(recipe.flagAnchor);
  if (recipe.archerPositions) recipe.archerPositions = recipe.archerPositions.map(shift);
  if (recipe.balconyDoor) recipe.balconyDoor.position = shift(recipe.balconyDoor.position);
  recipe.modelOriginOffset = [...offset];
};
