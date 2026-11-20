import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { catalogBotanicalClearance } from "./catalog-orchard-bounds";
import { createCatalogOrchardGraph } from "./catalog-orchard-graph";

const clearanceCache = new Map<string, ReturnType<typeof catalogBotanicalClearance>>();

export const catalogOrchardClearance = (asset: PlantDecorationAsset) => {
  const key = `${asset.species}:${asset.variant}:${asset.form}`;
  const cached = clearanceCache.get(key);
  if (cached) return cached;
  const bounds = catalogBotanicalClearance([0, 1, 2].map(detail =>
    createCatalogOrchardGraph(asset.species, asset.variant, detail, asset.form === "standalone")));
  clearanceCache.set(key, bounds);
  return bounds;
};
