import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { type CatalogWillowSpecies,createCatalogWillowGraph } from "../../../render-common/plants/catalog-willow-graph";
import {   type CatalogWillowColumnarMaterials,createCatalogWillowColumnarMaterials, createCatalogWillowColumnarModel } from "./catalog-willow-columnar-geometry";
import { definePlantCompletionFamily, type PlantCompletionTier } from "./plant-completion-contract";

export const willowCompletionAdapter = {
  id: "catalog-willow",
  species: ["compact-willow", "silver-willow", "golden-willow", "narrow-willow"] as const,
  createMaterials: (asset: PlantDecorationAsset, detailed: boolean) =>
    createCatalogWillowColumnarMaterials(asset.species, detailed),
  createModel: (pack: CatalogWillowColumnarMaterials, asset: PlantDecorationAsset,
    detailed: boolean, tier: PlantCompletionTier) => {
    const graph = createCatalogWillowGraph(asset.species as CatalogWillowSpecies, asset.variant,
      asset.form === "roadside", detailed && tier === "near", tier === "far");
    return createCatalogWillowColumnarModel(pack, graph, asset.species, asset.variant, false, detailed, tier);
  }
};

export const willowCompletionFamily = definePlantCompletionFamily(willowCompletionAdapter);
