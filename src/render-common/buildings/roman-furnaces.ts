import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe, Point3 } from "./building-recipe";

/** Anchors belong to the shared asset recipe, so moving tools never move a hearth. */
export const romanFurnaceAnchors = (definition: BuildingDefinition, recipe: BuildingRecipe) => {
  if (!["forge", "smelt", "bake", "brew", "burn", "mint"].includes(definition.task))
    return undefined;
  const chimney = recipe.parts
    .filter((part) => part.surface === "dark" && part.size[1] <= 0.03 && part.position[1] > 0.9)
    .sort((a, b) => b.position[1] - a.position[1])[0];
  if (!chimney) return undefined;
  const smoke: Point3 = [...(chimney.windowOpeningPosition ?? chimney.position)];
  smoke[1] += 0.02;
  let fire: Point3 | undefined;
  let size: Point3 = [1, 1, 1];
  const [x] = recipe.mechanism;
  if (definition.id === 26) fire = [x, 0.23, 0.13];
  if (definition.id === 32) fire = [x, 0.23, recipe.mechanism[2] - 0.003];
  if (definition.id === 25) {
    fire = [x + 0.05, 0.3, -0.39];
    size = [0.85, 0.5, 0.7];
  }
  if (definition.id === 24) fire = [0.93, 0.16, -0.025];
  if (definition.id === 23) {
    fire = [0.81, 0.16, 0.675];
    size = [0.75, 0.6, 0.6];
  }
  if (definition.id === 34) {
    fire = [0.75, 0.16, 0.145];
    size = [0.7, 0.65, 0.6];
  }
  if (fire && recipe.modelOriginOffset) {
    // Most furnace X values already derive from the translated mechanism; fixed ones do not.
    if ([23, 24, 34].includes(definition.id)) fire[0] += recipe.modelOriginOffset[0];
    fire[1] += recipe.modelOriginOffset[1];
    fire[2] += recipe.modelOriginOffset[2];
  }
  return { fire, size, smoke };
};
