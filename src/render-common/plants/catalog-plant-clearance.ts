import { plantCompletionModelFamily } from "../../../../island-of-settlers-shared/src/road-plant-completion";
import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { catalogBonsaiClearance } from "./catalog-bonsai-graph";
import { catalogColumnarClearance } from "./catalog-columnar-graph";
import { catalogFloweringClearance } from "./catalog-flowering-clearance";
import { catalogOrchardClearance } from "./catalog-orchard-clearance";
import { catalogPalmClearance } from "./catalog-palm-clearance";
import { catalogFlowerClearance,catalogShrubClearance } from "./catalog-shrub-clearance";
import { catalogWillowClearance } from "./catalog-willow-graph";

/** The same authored graph union governs both visual qualities and all LODs. */
export const catalogPlantClearance = (asset: PlantDecorationAsset) => {
  switch (plantCompletionModelFamily(asset)) {
    case "catalog-bonsai": return catalogBonsaiClearance(asset);
    case "catalog-columnar": return catalogColumnarClearance(asset);
    case "catalog-flowering": return catalogFloweringClearance(asset);
    case "catalog-orchard": return catalogOrchardClearance(asset);
    case "catalog-palm": return catalogPalmClearance(asset);
    case "catalog-shrub": return catalogShrubClearance(asset);
    case "catalog-flower": return catalogFlowerClearance(asset);
    case "catalog-willow": return catalogWillowClearance(asset);
    default: return undefined;
  }
};
