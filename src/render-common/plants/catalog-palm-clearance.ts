import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { catalogBotanicalClearance } from "./catalog-orchard-bounds";
import { createCatalogPalmGraph } from "./catalog-palm-graph";

const clearanceCache = new Map<string, ReturnType<typeof catalogBotanicalClearance>>();

export const catalogPalmClearance = (asset: PlantDecorationAsset) => {
  const key = `${asset.species}:${asset.variant}:${asset.form}`;
  const cached = clearanceCache.get(key);
  if (cached) return cached;
  const bounds = catalogBotanicalClearance([0, 1, 2].map(detail =>
    createCatalogPalmGraph(asset.species, asset.variant, detail, asset.form === "standalone")));
  clearanceCache.set(key, bounds);
  return bounds;
};
