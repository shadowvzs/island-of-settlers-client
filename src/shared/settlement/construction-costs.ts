import { buildingConstruction } from "@shared/catalog/building-data/construction";

import type { WorkerNation } from "../../render-common/workers/worker-unit";

export interface ConstructionMaterials {
  [ware: string]: number;
  planks: number;
  stone: number;
}

/**
 * The wares a building costs (construction sidecar): the nation's authored receipt (the pre-CAT7 national costs,
 * incl. the Indigenous cloth receipts), else the shared base receipt; a building without authored receipts pays
 * the unified rule's cost. A fresh copy, so callers may count it down.
 */
export const getConstructionCost = (typeId: number, nation?: WorkerNation): ConstructionMaterials => {
  const construction = buildingConstruction(typeId);
  if (!construction) throw new Error(`Unknown building ID: ${typeId}`);
  const cost = (nation && construction.nations?.[nation]) || construction.cost;
  return { ...cost } as ConstructionMaterials;
};
