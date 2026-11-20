import type { RoadDecorationItemDefinition } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantModel,   type OrnamentalPlantTier,ornamentalPlantUsesCanonicalIcon } from "../../../../island-of-settlers-shared/src/road-plant-models";
import type { RoadDecorationDefinition } from "../../shared/settlement/road-decoration-catalog";
import type { DecorationMaterialsFor } from "./road-decoration-asset-loader";
import { loadDecorationModule } from "./road-decoration-module-loader";

/** Independent premium meshes are lazy; their templates retain exact botanical or mineral ownership. */
export const createPremiumDecorationLoader = (materialsFor: DecorationMaterialsFor, detailed: boolean) => {
  const column = async (sku: RoadDecorationItemDefinition, definition: RoadDecorationDefinition,
    key: string, active: () => boolean, tier: "near" | "far") => {
    if (sku.finish !== "limestone" && sku.finish !== "marble") throw new Error("Unsupported Roman column finish");
    const models = await loadDecorationModule(() => import("./roman-column-decoration"), "createRomanColumnDecoration");
    if (!active()) return undefined;
    return { ...models.createRomanColumnDecoration(definition.variant as 0 | 1, detailed, sku.finish, tier), key };
  };
  const gardenTree = async (sku: RoadDecorationItemDefinition, species: "willow-tree" | "cypress-tree",
    key: string, active: () => boolean, tier: "near" | "far") => {
    const models = await loadDecorationModule(() => import("./plants/roman-garden-tree-model"), "createRomanGardenTreeModel");
    if (!active()) return undefined;
    const materials = models.createRomanGardenTreeMaterials(species);
    try {
      const model = models.createRomanGardenTreeModel(materials, species, detailed, sku.plant!.variant, tier);
      let disposed = false;
      return { ...model, key, dispose: () => {
        if (disposed) return;
        disposed = true; model.dispose(); materials.dispose();
      } };
    } catch (error) { materials.dispose(); throw error; }
  };
  const woodenLantern = async (definition: RoadDecorationDefinition, key: string,
    active: () => boolean, tier: "near" | "far") => {
    const nation = definition.nation;
    if (nation !== "japanese" && nation !== "chinese") throw new Error("Unknown wooden-lantern nation");
    const models = await loadDecorationModule(() => import("./road-decoration-wood-lantern"), "createWoodenRoadLanternModel");
    if (!active()) return undefined;
    return { ...models.createWoodenRoadLanternModel(nation, detailed && tier === "near", materialsFor(nation)), key };
  };
  return (sku: RoadDecorationItemDefinition, definition: RoadDecorationDefinition, key: string,
    active: () => boolean, tier: OrnamentalPlantTier) => {
    if (tier === "overview" || ornamentalPlantUsesCanonicalIcon(sku.plant, tier)) return undefined;
    if (definition.family === "roman-column") return column(sku, definition, key, active, tier);
    const species = sku.plant && ornamentalPlantModel(sku.plant);
    if (species === "willow-tree" || species === "cypress-tree") return gardenTree(sku, species, key, active, tier);
    if (definition.family === "wooden-lantern") return woodenLantern(definition, key, active, tier);
    return undefined;
  };
};
