import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import { getRoadPlant } from "./road-plant-catalog";
import { createRoadPlantRecipe, createStandalonePlantRecipe } from "./road-plant-recipes";

/** The exact canonical ornamental mesh recipe, never a copy or forestry/resource entity. */
export const createPlantDecorationRecipe = (definition: RoadDecorationDefinition, detailed: boolean) => {
  const asset = definition.plant, species = asset && getRoadPlant(asset.species);
  if (!asset || !species || asset.harvestable !== false) throw new Error("Unknown ornamental plant decoration");
  return asset.form === "standalone" ? createStandalonePlantRecipe(species, detailed, asset.variant)
    : createRoadPlantRecipe(species, detailed, asset.variant, asset.potted);
};
