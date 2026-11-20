import { plantCompletionModelFamily } from "../../../../../island-of-settlers-shared/src/road-plant-completion";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { ornamentalPlantModel, type OrnamentalPlantTier } from "../../../../../island-of-settlers-shared/src/road-plant-models";
import type { RoadDecorationTemplate } from "../road-decoration-asset-loader";
import { loadDecorationModule } from "../road-decoration-module-loader";

/** Each map lazily acquires only its botanical builder lane, keeping legacy models independent. */
export const createBotanicalDecorationLoader = (detailed: boolean) => {
  let completion: ReturnType<typeof import("./plant-completion-model").createPlantCompletionModels> | undefined;
  let legacy: ReturnType<typeof import("./ornamental-plant-model").createOrnamentalPlantModels> | undefined;
  return (asset: PlantDecorationAsset | undefined, key: string, active: () => boolean,
    tier: OrnamentalPlantTier): Promise<RoadDecorationTemplate | undefined> | undefined => {
    if (!asset || !ornamentalPlantModel(asset)) return undefined;
    return (async () => {
      if (plantCompletionModelFamily(asset)) {
        const models = await loadDecorationModule(() => import("./plant-completion-model"), "createPlantCompletionModels");
        if (!active()) return undefined;
        if (tier === "overview") throw new Error("Completion overview requires an accepted canonical icon");
        completion ??= models.createPlantCompletionModels(detailed);
        return { ...completion.create(asset, tier), key };
      }
      const models = await loadDecorationModule(() => import("./ornamental-plant-model"), "createOrnamentalPlantModels");
      if (!active()) return undefined;
      legacy ??= models.createOrnamentalPlantModels(detailed);
      return { ...legacy.create(asset, tier), key };
    })();
  };
};
