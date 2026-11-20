import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { createCatalogPalmGraph } from "../../../render-common/plants/catalog-palm-graph";
import { type CatalogBotanicalMaterials,createCatalogBotanicalMaterials } from "./catalog-orchard-materials";
import { createCatalogBotanicalModel } from "./catalog-orchard-model";
import { definePlantCompletionFamily, type PlantCompletionTier } from "./plant-completion-contract";

export const palmCompletionAdapter = definePlantCompletionFamily({
  id: "catalog-palm",
  species: ["date-palm", "fan-palm", "dwarf-coconut"] as const,
  createMaterials: createCatalogBotanicalMaterials,
  createModel: (pack: CatalogBotanicalMaterials, asset: PlantDecorationAsset, detailed: boolean,
    tier: PlantCompletionTier) => {
    let detail = detailed ? 2 : 1;
    if (tier === "far") detail = 0;
    return createCatalogBotanicalModel(pack, createCatalogPalmGraph(asset.species, asset.variant, detail, asset.form === "standalone"), detail);
  }
});
