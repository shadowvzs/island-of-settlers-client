import { getRoadDecorationItem } from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { MAPLE_MODEL_TRIANGLE_COST, ornamentalPlantArtReady,
  ornamentalPlantModel } from "../../../../../island-of-settlers-shared/src/road-plant-models";
import { decorationModel } from "../../../render-common/content/decoration-model-recipes";
import { bambooBudget } from "../../../render-common/plants/bamboo-grove-species";
import { CLIMBER_TRIANGLE_BUDGET } from "../../../render-common/road-decoration-climbers";
import { plantCompletionProfile } from "./plant-completion-profile";

/** Per-instance source costs; the selector applies a single shared budget across plants and structures. */
export const ornamentalDecorationProfile = (id: string, detailed: boolean) => {
  const item = getRoadDecorationItem(id);
  if (!item) return undefined;
  const definition = decorationModel(item.decoration);
  if (definition?.family === "roman-column") return { large: true, cost: detailed ? 6500 : 1800,
    farCost: 700, overview: true };
  if (definition?.family === "wooden-lantern") return { large: false, cost: detailed ? 3500 : 1000,
    farCost: 1000, overview: true };
  if (definition?.climber) {
    const budget = CLIMBER_TRIANGLE_BUDGET[definition.climber];
    return { large: true, cost: detailed ? budget.high : budget.minimal, farCost: budget.minimal, overview: true };
  }
  if (definition?.wisteriaFrame) return { large: true, cost: detailed ? 23716 : 2032,
    farCost: detailed ? 3440 : 2032, overview: true };
  if (definition?.wisteriaTreeVariant !== undefined) return { large: true, cost: detailed ? 29378 : 5596,
    farCost: 2140, overview: true };
  if (definition?.buildingBamboo) return { large: false, cost: detailed ? 3500 : 1000, farCost: 1000, overview: true };
  if (definition?.bambooVariant !== undefined) {
    const budget = bambooBudget(definition.bambooVariant);
    return { large: true, cost: detailed ? budget.high : budget.minimal, farCost: budget.far, overview: true };
  }
  if (definition?.hangingLanterns) return { large: true, cost: detailed ? 24000 : 6000,
    farCost: detailed ? 24000 : 6000, overview: true };
  const asset = item.plant, species = asset && ornamentalPlantModel(asset);
  if (!species) return undefined;
  const overview = ornamentalPlantArtReady(asset!);
  const completion = plantCompletionProfile(asset!, detailed, overview);
  if (completion) return completion;
  if (species === "willow-tree") return { large: true,
    cost: detailed ? 24000 : 6000, farCost: 2, overview: true };
  if (species === "cypress-tree") return { large: true,
    cost: detailed ? 24000 : 6000, farCost: 1800, overview: true };
  if (species === "bonsai-elm") return { large: false, cost: detailed ? 10000 : 5000, farCost: 1800, overview };
  if (species === "maple-tree") return { large: true,
    cost: detailed ? MAPLE_MODEL_TRIANGLE_COST.high : MAPLE_MODEL_TRIANGLE_COST.minimal,
    farCost: MAPLE_MODEL_TRIANGLE_COST.far, overview };
  if (species === "flowering-peach") return { large: true, cost: detailed ? 22124 : 5912, farCost: 2, overview };
  return { large: false, cost: detailed ? 12000 : 6000, farCost: 779, overview };
};
