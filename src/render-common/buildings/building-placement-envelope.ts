import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { DEFAULT_ROMAN_DOOR } from "./roman-door-profile";
import { romanFurnaceAnchors } from "./roman-furnaces";
import { ROMAN_MILL_ROTOR_HALF_DEPTH,ROMAN_MILL_ROTOR_RADIUS } from "./roman-mill-dimensions";

export interface BuildingRotorClearance {
  kind: "vertical-rotor";
  center: Point3;
  radius: number;
  halfDepth: number;
}

export interface BuildingEntranceClearance {
  kind: "door-swing";
  min: Point3;
  max: Point3;
}

/** Non-solid visual overlay only: smoke never reserves walkable ground or blocks another plot. */
export const getRomanEffectEnvelopes = (definition: BuildingDefinition, recipe: BuildingRecipe) => {
  const furnace = romanFurnaceAnchors(definition, recipe);
  if (!furnace) return [];
  const [x, y, z] = furnace.smoke;
  return [{ kind: "smoke" as const, solid: false as const,
    min: [x - .33, y - .21, z - .32] as Point3, max: [x + .61, y + 1.17, z + .32] as Point3 }];
};

/** Compact cottages reserve a separate entrance swing; their moving leaf is not masonry. */
export const getRomanEntranceClearances = (typeId: number, recipe: BuildingRecipe): BuildingEntranceClearance[] => {
  if (![1, 20].includes(typeId)) return [];
  const dimensions = recipe.doorDimensions ?? DEFAULT_ROMAN_DOOR;
  const [x, y, z] = recipe.door;
  const radius = dimensions.width + .05;
  return [{ kind: "door-swing", min: [x - .05, y, z - .05],
    max: [x + radius, y + dimensions.spring + dimensions.width / 2 + .02, z + radius] }];
};

/** All authored static geometry, including roofs and stocks, but excluding revolving sails. */
export const getRomanStaticRecipeBounds = (recipe: BuildingRecipe) => {
  let extentX = 0, extentZ = 0;
  for (const part of recipe.parts) {
    const { max, min } = getRomanPartBounds(part);
    extentX = Math.max(extentX, Math.abs(min[0]), Math.abs(max[0]));
    extentZ = Math.max(extentZ, Math.abs(min[2]), Math.abs(max[2]));
  }
  return { extentX, extentZ, width: extentX * 2, depth: extentZ * 2 };
};

/** Complete sail sweep in local model units. Its lowest edge clears workers and shoulder cargo. */
export const getRomanRotorClearances = (typeId: number, recipe: BuildingRecipe): BuildingRotorClearance[] => {
  if (typeId !== MILL_TYPE_ID) return [];
  return [{ kind: "vertical-rotor", center: [...recipe.mechanism], radius: ROMAN_MILL_ROTOR_RADIUS, halfDepth: ROMAN_MILL_ROTOR_HALF_DEPTH }];
};
