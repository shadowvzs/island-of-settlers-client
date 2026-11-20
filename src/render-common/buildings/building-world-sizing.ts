import { advancedMaterialBaseDefinition, withAdvancedMaterialStocks } from "./advanced-material-buildings";
import type { BuildingDefinition } from "./building-catalog";
import { getAuthoredBuildingPlot } from "./building-plot-profile";
import { getRomanEffectEnvelopes, getRomanEntranceClearances, getRomanRotorClearances, getRomanStaticRecipeBounds } from "./building-placement-envelope";
import { createRomanBuildingRecipe } from "./building-recipe";
import { getRomanRecipeBounds, getRomanRecipeFitScale } from "./building-recipe-fit";
import { MONUMENT_PLOT, MONUMENT_TYPE_ID } from "./monument-definition";
import { getRomanBuildingPlotPolicy } from "./roman-building-plot-policy";

export const BUILDING_PLOT_MARGIN = 0.12;
const calculate = (definition: BuildingDefinition) => {
  // Occupation roof revisions retain the original plot, fit scale and door clearance.
  const recipe = createRomanBuildingRecipe(definition, true, false);
  let scale = definition.id === MONUMENT_TYPE_ID ? 1 : getRomanRecipeFitScale(definition, recipe);
  const highBounds = getRomanRecipeBounds(definition, recipe);
  const minimalRecipe = createRomanBuildingRecipe(definition, false, false);
  const minimalBounds = getRomanRecipeBounds(definition, minimalRecipe);
  const extentX = Math.max(highBounds.extentX, minimalBounds.extentX);
  const extentZ = Math.max(highBounds.extentZ, minimalBounds.extentZ);
  const bounds = { extentX, extentZ, width: extentX * 2, depth: extentZ * 2 };
  const staticHigh = getRomanStaticRecipeBounds(recipe), staticMinimal = getRomanStaticRecipeBounds(minimalRecipe);
  const solidHigh = getRomanRecipeBounds(definition, recipe, false);
  const solidMinimal = getRomanRecipeBounds(definition, minimalRecipe, false);
  const groundBounds = [1, 20, 31].includes(definition.id) ? {
    extentX: Math.max(staticHigh.extentX, staticMinimal.extentX),
    extentZ: Math.max(staticHigh.extentZ, staticMinimal.extentZ),
    width: Math.max(staticHigh.width, staticMinimal.width),
    depth: Math.max(staticHigh.depth, staticMinimal.depth)
  } : { extentX: Math.max(solidHigh.extentX, solidMinimal.extentX),
    extentZ: Math.max(solidHigh.extentZ, solidMinimal.extentZ),
    width: Math.max(solidHigh.width, solidMinimal.width), depth: Math.max(solidHigh.depth, solidMinimal.depth) };
  const policy = getRomanBuildingPlotPolicy(definition.id);
  if (policy.fillLargeModel && definition.id !== MONUMENT_TYPE_ID)
    scale = Math.max(scale, (6 - BUILDING_PLOT_MARGIN) / Math.max(groundBounds.width, groundBounds.depth));
  const commonCells: readonly [number, number] = definition.style === "well" ? [2, 2] : [
    Math.max(policy.minimum[0], Math.ceil(groundBounds.width * scale + BUILDING_PLOT_MARGIN - 1e-9)),
    Math.max(policy.minimum[1], Math.ceil(groundBounds.depth * scale + BUILDING_PLOT_MARGIN - 1e-9))
  ];
  const authored = getAuthoredBuildingPlot(definition.id);
  if (authored) scale = authored.structureScale;
  return { recipe, scale, bounds, groundBounds, overhead: getRomanRotorClearances(definition.id, recipe),
    entrance: getRomanEntranceClearances(definition.id, recipe),
    effects: getRomanEffectEnvelopes(definition, recipe), policy, cells: authored?.reservedCells ?? (definition.id === MONUMENT_TYPE_ID ? MONUMENT_PLOT : commonCells) };
};
const cache = new WeakMap<BuildingDefinition, ReturnType<typeof calculate>>();

/** Both LODs share one uniform scale. Sail sweeps and the barracks entrance remain explicitly reserved. */
export const getRomanBuildingWorldSizing = (definition: BuildingDefinition) => {
  let result = cache.get(definition);
  if (!result) {
    const base = advancedMaterialBaseDefinition(definition);
    result = calculate(base);
    if (base !== definition) result = { ...result, recipe: withAdvancedMaterialStocks(result.recipe, definition.id) };
    cache.set(definition, result);
  }
  return result;
};
