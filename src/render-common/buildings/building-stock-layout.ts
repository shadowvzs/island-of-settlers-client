import type { WorkerNation } from "../workers/worker-nation";
import { getBuildingDefinition } from "./building-catalog";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import { type BuildingLevel, buildingLevelOf } from "./levels/building-level";
import { leveledBuildingRecipe } from "./levels/leveled-building-recipe";

export interface BuildingStockStyle { nation?: WorkerNation; level?: BuildingLevel }
export const stockStyleFor = (nation: WorkerNation | undefined,
  building: { workshopUpgrade?: { level: number } }): BuildingStockStyle => ({
  nation, level: buildingLevelOf(building.workshopUpgrade?.level)
});
const cache = new Map<string, ReturnType<typeof getRomanBuildingWorldSizing>>();
/** Physical stock uses the same national/level recipe as the visible model, with bounded CPU caching. */
export const getBuildingStockLayout = (typeId: number, style: BuildingStockStyle = {}) => {
  const definition = getBuildingDefinition(typeId), base = getRomanBuildingWorldSizing(definition);
  const nation = style.nation ?? "roman", level = style.level ?? 1;
  if (nation === "roman" && level === 1) return base;
  const key = `${typeId}:${nation}:${level}`, existing = cache.get(key);
  if (existing) return existing;
  const layout = { ...base, recipe: leveledBuildingRecipe(definition, nation, true, level) };
  if (cache.size >= 96) cache.delete(cache.keys().next().value!);
  cache.set(key, layout);
  return layout;
};
