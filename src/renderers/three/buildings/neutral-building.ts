import type { MeshStandardMaterial } from "three";

import { banditCampPlan, banditSiteName } from "../../../render-common/buildings/bandit-camp-plan";
import type { BuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { createHostileCatapultRecipe } from "../../../render-common/buildings/hostile-catapult-recipe";
import { createNeutralBuildingRecipe } from "../../../render-common/buildings/neutral-building-recipe";
import { createThemedNeutralBuildingRecipe } from "../../../render-common/buildings/themed-neutral-building-recipe";
import { type EnemyBuildingStyle,enemyBuildingStyleKey } from "../../../render-common/buildings/themed-neutral-building-style";
import { borrowHostileCatapultMaterials } from "./hostile-catapult-materials";
import { createRomanBuilding } from "./roman-building";

const recipeFor = (definition: BuildingDefinition, detailed: boolean, style?: EnemyBuildingStyle) => {
  if (definition.id === 16 && style?.variant) return createHostileCatapultRecipe(style.variant, detailed);
  if (style) return createThemedNeutralBuildingRecipe(definition, style, detailed);
  return createNeutralBuildingRecipe(definition, detailed);
};

export const createNeutralBuilding = (
  definition: BuildingDefinition, materials: Record<BuildingSurface, MeshStandardMaterial>, detailed = true, style?: EnemyBuildingStyle
) => {
  const owner = definition.id === 16 && style?.variant
    ? borrowHostileCatapultMaterials(materials, style.variant, detailed) : undefined;
  const model = createRomanBuilding(definition, owner?.materials ?? materials, detailed,
    recipeFor(definition, detailed, style));
  if (owner) {
    const dispose = model.dispose;
    let disposed = false;
    model.dispose = () => {
      if (disposed) return;
      disposed = true; dispose(); owner.release();
    };
  }
  model.root.name = `neutral_${definition.id}`;
  model.root.userData.buildingStyle = "neutral";
  if (style) model.root.userData.enemyBuildingStyle = enemyBuildingStyleKey(style);
  if (style?.bandit) {
    const plan = banditCampPlan(style.bandit);
    const data=model.root.userData;
    data.name = banditSiteName(style.bandit, style.enclosure); data.role=`${plan.tier} neutral ${plan.kind}`;
    data.garrisonCapacity=plan.capacity;data.archerPositions=model.recipe.archerPositions??[];
    data.gridFootprint=plan.cells;data.modelScale=1;
    data.gridPlacement={...data.gridPlacement,scale:1,cells:plan.cells,
      doorHinge:model.recipe.door,workerExit:model.recipe.workerExit};
    data.groundBounds={extentX:plan.cells[0]/2,extentZ:plan.cells[1]/2,width:plan.cells[0],depth:plan.cells[1]};
  }
  return model;
};
