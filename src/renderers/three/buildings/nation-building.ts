import type { MeshStandardMaterial } from "three";

import type { BuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { BuildingLevel } from "../../../render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../../../render-common/buildings/levels/leveled-building-recipe";
import { MONUMENT_ASSETS, MONUMENT_TYPE_ID } from "../../../render-common/buildings/monument-definition";
import { buildingModelRecipe } from "../../../render-common/content/building-model-recipes";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { createMonumentBuilding } from "./monument-building";
import { createRomanBuilding, type PreparedPartGroups } from "./roman-building";

/** The model the building's catalog entry names for the nation and level (`recipe:building.*`). */
export const createNationBuilding = (
  definition: BuildingDefinition, materials: Record<BuildingSurface, MeshStandardMaterial>,
  nation: WorkerNation, detailed = true, level: BuildingLevel = 1, prepared?: PreparedPartGroups
) => {
  const source = buildingModelRecipe(definition.id, nation, level);
  if (source.kind === "authored")
    return createMonumentBuilding(source.nation, detailed, nation === "japanese" ? materials.planks : undefined);
  const recipeLevel = source.level ?? level;
  const model = createRomanBuilding(definition, materials, detailed,
    leveledBuildingRecipe(definition, source.nation, detailed, recipeLevel), nation,
    detailed ? undefined : leveledBuildingRecipe(definition, source.nation, true, recipeLevel), prepared);
  model.root.name = `${nation}_${definition.id}`;
  model.root.userData.nation = nation;
  if (definition.id === MONUMENT_TYPE_ID) {
    Object.assign(model.root.userData, { authoredHeight: MONUMENT_ASSETS[nation].height, monument: true });
    model.root.animations = [];
  }
  return model;
};
