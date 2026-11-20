import { MeshStandardMaterial, SRGBColorSpace } from "three";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import type { RoadPlantRecipe } from "../../render-common/road-plant-recipes";
import type { createRoadDecorationModel } from "./road-decoration-model";

/** Reuse static surface batching and its explicit geometry/material disposal owner. */
export const createRoadPlantModelWithFactory = (recipe: RoadPlantRecipe,
  materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean, build: typeof createRoadDecorationModel) => {
  const leaf = new MeshStandardMaterial({ vertexColors: true, roughness: .78 });
  const flower = new MeshStandardMaterial({ vertexColors: true, roughness: .68 });
  if (recipe.flowerColour) flower.color.setRGB(...recipe.flowerColour, SRGBColorSpace);
  const pack = { ...materials, leaf, paint: flower };
  const model = build({ definition: { id: recipe.id }, parts: recipe.parts, wind: 0 }, pack, detailed);
  const dispose = () => { model.dispose(); leaf.dispose(); flower.dispose(); };
  return { ...model, dispose };
};
