import type { RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { Archipelago } from "./archipelago";
import type { GameSaveV1 } from "./game-save";

/** Acquisition-only count. Travel archives are traversed on a purchase, never in the simulation/render loop. */
export const countOwnedPlacedRoadDecorations = (item: RoadDecorationItemId,
  placed: readonly { item: string }[], returns: readonly { item: string }[], group?: Archipelago) => {
  let units = placed.filter(row => row.item === item).length + returns.filter(row => row.item === item).length;
  const seen = new Set<string>();
  for (const row of group?.closedRoadDecorations ?? []) { units += row.items[item] ?? 0; seen.add(row.island); }
  const add = (key: string, save?: GameSaveV1) => {
    if (!save || seen.has(key)) return;
    seen.add(key);
    const state = save.settlement.roadDecorations;
    units += (state?.placed.filter(row => row.item === item).length ?? 0) + (state?.returns.filter(row => row.item === item).length ?? 0);
  };
  if (group?.active !== null) add("home", group?.home);
  for (const colony of group?.colonies ?? []) if (colony.expeditionId !== group?.active) add(`colony-${colony.expeditionId}`, colony.save);
  for (const adventure of group?.adventures ?? []) if (adventure.expeditionId !== group?.active) add(`adventure-${adventure.expeditionId}`, adventure.save);
  return units;
};
