import { type PlantCompletionModelFamily, plantCompletionModelFamily } from "../../../../../island-of-settlers-shared/src/road-plant-completion";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { ornamentalPlantUsesCanonicalIcon } from "../../../../../island-of-settlers-shared/src/road-plant-models";
import { catalogBonsaiFamily } from "./catalog-bonsai-model";
import { columnarCompletionFamily } from "./catalog-columnar-completion";
import { CATALOG_FLOWER_ADAPTER } from "./catalog-flower-model";
import { catalogFloweringFamily } from "./catalog-flowering-pack";
import { orchardCompletionAdapter } from "./catalog-orchard-model";
import { palmCompletionAdapter } from "./catalog-palm-model";
import { CATALOG_SHRUB_ADAPTER } from "./catalog-shrub-model";
import { willowCompletionFamily } from "./catalog-willow-completion";
import type { PlantCompletionFamily, PlantCompletionOwner, PlantCompletionTier } from "./plant-completion-contract";

const families: Readonly<Record<PlantCompletionModelFamily, PlantCompletionFamily>> = {
  "catalog-bonsai": catalogBonsaiFamily, "catalog-columnar": columnarCompletionFamily,
  "catalog-flower": CATALOG_FLOWER_ADAPTER, "catalog-flowering": catalogFloweringFamily,
  "catalog-orchard": orchardCompletionAdapter, "catalog-palm": palmCompletionAdapter,
  "catalog-shrub": CATALOG_SHRUB_ADAPTER, "catalog-willow": willowCompletionFamily
};

/** Loaded only for the explicit completion cohort; accepted legacy species retain their lazy path. */
export const createPlantCompletionModels = (detailed: boolean) => {
  const owners = new Map<string, { owner: PlantCompletionOwner; users: number }>();
  return { create: (asset: PlantDecorationAsset, tier: PlantCompletionTier = "near") => {
    const familyId = plantCompletionModelFamily(asset);
    if (!familyId) throw new Error("Plant is outside the explicit completion cohort");
    if (ornamentalPlantUsesCanonicalIcon(asset, tier))
      throw new Error("Plant far models require the asynchronous canonical icon loader");
    const family = families[familyId];
    if (!family.species.includes(asset.species)) throw new Error(`Wrong botanical family for ${asset.species}`);
    const key = `${familyId}:${asset.species}:${asset.potted}:${asset.palette}`;
    let entry = owners.get(key);
    if (!entry) { entry = { owner: family.createOwner(asset, detailed), users: 0 }; owners.set(key, entry); }
    const borrowed = entry;
    borrowed.users++;
    const release = () => {
      if (--borrowed.users > 0) return;
      owners.delete(key); borrowed.owner.dispose();
    };
    try {
      const model = borrowed.owner.create(asset, tier);
      let disposed = false;
      return { root: model.root, triangles: model.triangles, dispose: () => {
        if (disposed) return;
        disposed = true;
        try { model.dispose(); } finally { release(); }
      } };
    } catch (error) { release(); throw error; }
  } };
};
