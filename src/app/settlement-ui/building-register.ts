import { BUILDING_MENU } from "../../render-common/buildings/building-menu";
import { getNationBuildingDefinition } from "../../render-common/buildings/nation-building-text";
import type { SettlementBuildingSummary } from "./types";

/** Own buildings only; plans are never counted as completed; type order follows the build menu. */
export const getSettlementBuildingRegister = (
  buildings: readonly SettlementBuildingSummary[] = [], nation?: string, buildableTypes?: readonly number[]
) => {
  const completed = new Map<number, string[]>(), sites = new Map<number, number>();
  for (const building of buildings) {
    if (building.hostile) continue;
    if (building.completed) {
      const matches = completed.get(building.type) ?? [];
      matches.push(building.id);
      completed.set(building.type, matches);
    } else sites.set(building.type, (sites.get(building.type) ?? 0) + 1);
  }
  const allowed = buildableTypes && new Set(buildableTypes);
  return BUILDING_MENU.flatMap(group => group.buildings
    .filter(building => !allowed || allowed.has(building.id) || completed.has(building.id) || sites.has(building.id))
    .map(building => ({
    id: building.id, name: getNationBuildingDefinition(building.id, nation).name,
    completed: completed.get(building.id) ?? [],
    sites: sites.get(building.id) ?? 0,
    size: group.size
  })));
};
