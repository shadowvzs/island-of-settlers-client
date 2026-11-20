import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { type CatalogColumnarSpecies,createCatalogColumnarGraph } from "../../../render-common/plants/catalog-columnar-graph";
import {   type CatalogWillowColumnarMaterials,createCatalogWillowColumnarMaterials, createCatalogWillowColumnarModel } from "./catalog-willow-columnar-geometry";
import { definePlantCompletionFamily, type PlantCompletionTier } from "./plant-completion-contract";

export const columnarCompletionAdapter = {
  id: "catalog-columnar",
  species: ["columnar-cypress", "italian-poplar", "juniper-spire"] as const,
  createMaterials: (asset: PlantDecorationAsset, detailed: boolean) =>
    createCatalogWillowColumnarMaterials(asset.species, detailed, asset.potted),
  createModel: (pack: CatalogWillowColumnarMaterials, asset: PlantDecorationAsset,
    detailed: boolean, tier: PlantCompletionTier) => {
    const graph = createCatalogColumnarGraph(asset.species as CatalogColumnarSpecies, asset.variant,
      asset.potted, detailed && tier === "near", tier === "far");
    return createCatalogWillowColumnarModel(pack, graph, asset.species, asset.variant, asset.potted, detailed, tier);
  }
};

export const columnarCompletionFamily = definePlantCompletionFamily(columnarCompletionAdapter);
