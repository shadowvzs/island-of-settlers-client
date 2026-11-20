import type { Group, MeshStandardMaterial } from "three";

import { getRoadDecorationItem, type RoadDecorationFinish,
  type RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantModel,   type OrnamentalPlantTier,ornamentalPlantUsesCanonicalIcon } from "../../../../island-of-settlers-shared/src/road-plant-models";
import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import { decorationModel } from "../../render-common/content/decoration-model-recipes";
import type { RoadPlantColour } from "../../render-common/road-plant-catalog";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { createBotanicalDecorationLoader } from "./plants/botanical-decoration-loader";
import type { DecorationFoliageSource } from "./plants/decoration-foliage-source";
import { ornamentalDecorationProfile } from "./plants/ornamental-decoration-profile";
import { createPremiumDecorationLoader } from "./premium-decoration-loader";
import { loadDecorationModule } from "./road-decoration-module-loader";

export interface RoadDecorationTemplate {
  root: Group;
  triangles: number;
  key: string;
  flowerColour?: RoadPlantColour;
  dispose(): void;
}
export type DecorationMaterialsFor = (nation: WorkerNation) => Record<BuildingSurface, MeshStandardMaterial>;
export type DecorationAssetLoader = (id: string, key: string, active: () => boolean, tier?: OrnamentalPlantTier) =>
  Promise<RoadDecorationTemplate | undefined>;
const stoneFamilyFor = (finish: RoadDecorationFinish) => finish === "native" ? undefined : finish;

const climberFoliage = (foliage: DecorationFoliageSource | undefined) => foliage?.acquire() ??
  Promise.reject(new Error("Climber decorations need the layer's foliage material source"));

/**
 * Neither inventory metadata nor an empty map imports the Three geometry builders. `foliage` is
 * the owning layer's shared leaf/petal material source (borrowed; the layer disposes it).
 */
export const createDecorationAssetLoader = (materialsFor: DecorationMaterialsFor, detailed: boolean,
  foliage?: DecorationFoliageSource): DecorationAssetLoader => {
  const loadPremium = createPremiumDecorationLoader(materialsFor, detailed);
  const loadBotanical = createBotanicalDecorationLoader(detailed);
  let wisteriaModels: ReturnType<typeof import("./wisteria-production-model").createWisteriaProductionModels> | undefined;
  let wisteriaTrees: ReturnType<typeof import("./plants/wisteria-tree-templates").createWisteriaTreeTemplates> | undefined;
  let peachModels: ReturnType<typeof import("./plants/peach-production-templates").createPeachProductionTemplates> | undefined;
  let bambooGroves: ReturnType<typeof import("./plants/bamboo-grove-templates")
    .createBambooGroveTemplates> | undefined;
  return async (id, key, active, tier = "near") => {
    if (!active()) return undefined;
    const sku = getRoadDecorationItem(id), definition = sku && decorationModel(sku.decoration);
    if (!sku || !definition) throw new Error(`Unknown decoration item: ${id}`);
    const premium = loadPremium(sku, definition, key, active, tier);
    if (premium) return premium;
    if (sku.plant && ornamentalPlantModel(sku.plant) === "flowering-peach") {
      const models = await loadDecorationModule(() => import("./plants/peach-production-templates"),
        "createPeachProductionTemplates");
      if (!active()) return undefined;
      peachModels ??= models.createPeachProductionTemplates(detailed);
      const model = await peachModels.create(sku.plant.variant, tier, active);
      if (!active()) { model?.dispose(); return undefined; }
      return model && { ...model, key };
    }
    if (ornamentalPlantUsesCanonicalIcon(sku.plant, tier) && ornamentalDecorationProfile(id, detailed)) {
      const overview = await loadDecorationModule(() => import("./plants/ornamental-plant-overview"),
        "createOrnamentalPlantOverview");
      if (!active()) return undefined;
      const model = await overview.createOrnamentalPlantOverview(sku.plant ?? id as RoadDecorationItemId, active);
      return model && { ...model, key };
    }
    if (definition.wisteriaTreeVariant !== undefined) {
      const trees = await loadDecorationModule(() => import("./plants/wisteria-tree-templates"),
        "createWisteriaTreeTemplates");
      if (!active()) return undefined;
      wisteriaTrees ??= trees.createWisteriaTreeTemplates(detailed);
      const model = await wisteriaTrees.create(definition.wisteriaTreeVariant, tier === "near" ? "near" : "far");
      if (!active()) { model.dispose(); return undefined; }
      return { ...model, key };
    }
    if (definition.bambooVariant !== undefined) {
      const groves = await loadDecorationModule(() => import("./plants/bamboo-grove-templates"),
        "createBambooGroveTemplates");
      if (!active()) return undefined;
      bambooGroves ??= groves.createBambooGroveTemplates(detailed, foliage?.uniforms);
      return { ...bambooGroves.create(definition.bambooVariant, tier === "near" ? "near" : "far"), key };
    }
    if (definition.climber) {
      const [climbers, models, leaves] = await Promise.all([
        loadDecorationModule(() => import("../../render-common/road-decoration-climbers"), "createClimberRoadRecipe"),
        loadDecorationModule(() => import("./road-decoration-model"), "createRoadDecorationModel"),
        climberFoliage(foliage)
      ]);
      if (!active()) return undefined;
      // The far tier is the Minimal recipe; it keeps this layer's (detail-level) foliage material.
      const high = detailed && tier === "near";
      return { ...models.createRoadDecorationModel({ definition, parts: climbers.createClimberRoadRecipe(
        definition.climber, high), wind: 0 }, materialsFor(sku.nation), high, leaves), key };
    }
    if (definition.hangingLanterns) {
      const nation = definition.nation;
      if (nation !== "japanese" && nation !== "chinese") throw new Error("Unknown hanging-lantern nation");
      const models = await loadDecorationModule(() => import("./road-decoration-hanging-lanterns"),
        "createHangingLanternRoadModel");
      if (!active()) return undefined;
      return { ...models.createHangingLanternRoadModel(nation, detailed, materialsFor(nation)), key };
    }
    if (definition.wisteriaFrame) {
      const models = await loadDecorationModule(() => import("./wisteria-production-model"),
        "createWisteriaProductionModels");
      if (!active()) return undefined;
      wisteriaModels ??= models.createWisteriaProductionModels(materialsFor("indigenous"), detailed);
      const model = await wisteriaModels.create(definition.wisteriaFrame, undefined, tier === "near" ? "near" : "far");
      if (!active()) { model.dispose(); return undefined; }
      return { ...model, key };
    }
    const botanical = loadBotanical(sku.plant, key, active, tier);
    if (botanical) return botanical;
    if (sku.plant) {
      const [recipes, plants, models] = await Promise.all([
        loadDecorationModule(() => import("../../render-common/road-decoration-plants"), "createPlantDecorationRecipe"),
        loadDecorationModule(() => import("./road-plant-model-core"), "createRoadPlantModelWithFactory"),
        loadDecorationModule(() => import("./road-decoration-model"), "createRoadDecorationModel")
      ]);
      if (!active()) return undefined;
      const recipe = recipes.createPlantDecorationRecipe(definition, detailed);
      const flowerColour = recipe.flowerColour;
      const model = plants.createRoadPlantModelWithFactory({ ...recipe, flowerColour: [1, 1, 1] },
        materialsFor("roman"), detailed, models.createRoadDecorationModel);
      return { ...model, key, flowerColour };
    }
    const [recipes, models] = await Promise.all([
      loadDecorationModule(() => import("../../render-common/road-decoration-models"), "createRoadDecorationRecipe"),
      loadDecorationModule(() => import("./road-decoration-model"), "createRoadDecorationModel")
    ]);
    if (!active()) return undefined;
    const recipe = recipes.createRoadDecorationRecipe(definition, detailed, stoneFamilyFor(sku.finish));
    return { ...models.createRoadDecorationModel(recipe, materialsFor(sku.nation), detailed), key };
  };
};
