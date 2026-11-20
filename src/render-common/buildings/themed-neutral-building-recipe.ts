import { createBanditMilitaryRecipe } from "./bandit-building-kit";
import { createBanditCampRecipe } from "./bandit-camp-recipe";
import type { BuildingDefinition } from "./building-catalog";
import { type BuildingRecipe,createRomanBuildingRecipe } from "./building-recipe";
import { createNeutralBuildingRecipe } from "./neutral-building-recipe";
import { enemyBuildingDesign, type EnemyBuildingStyle } from "./themed-neutral-building-style";

const THEMED_ENEMY_BUILDING_IDS = [2, 4, 9] as const;
/** Independent outlaw structures retain the established operational anchors and stock. */
export const createThemedNeutralBuildingRecipe = (
  definition: BuildingDefinition,
  style: EnemyBuildingStyle,
  detailed = true
): BuildingRecipe => {
  if (style.bandit) return createBanditCampRecipe(style.bandit, style, detailed);
  if (!THEMED_ENEMY_BUILDING_IDS.some((id) => id === definition.id))
    return createNeutralBuildingRecipe(definition, detailed);
  const original = createRomanBuildingRecipe(definition, detailed, false);
  return createBanditMilitaryRecipe(
    definition,
    original,
    enemyBuildingDesign(style),
    detailed,
    style.model
  );
};
