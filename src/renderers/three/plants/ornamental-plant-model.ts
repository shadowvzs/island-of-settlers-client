import { type PlantCompletionModelFamily,plantCompletionModelFamily } from "../../../../../island-of-settlers-shared/src/road-plant-completion";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { type OrnamentalModelSpecies, ornamentalPlantModel,
  type OrnamentalPlantTier } from "../../../../../island-of-settlers-shared/src/road-plant-models";
import { createBonsaiElmMaterials, createBonsaiElmModel } from "./bonsai-model";
import { createMapleTreeMaterials, createMapleTreeTemplate } from "./maple-tree-model";
import { createRoadsideShrubFarMaterials, createRoadsideShrubFarModel } from "./roadside-shrub-far";
import { createRoadsideShrubMaterials } from "./roadside-shrub-materials";
import { createDenseRoadsideShrubModel } from "./roadside-shrub-model";
import { createRomanGardenTreeMaterials, createRomanGardenTreeModel } from "./roman-garden-tree-model";

type SynchronousSpecies = Exclude<OrnamentalModelSpecies, "flowering-peach" | PlantCompletionModelFamily>;
const createSpeciesMaterials = (species: SynchronousSpecies, detailed: boolean) => {
  if (species === "bonsai-elm") return { species, pack: createBonsaiElmMaterials() };
  if (species === "maple-tree") return { species, pack: createMapleTreeMaterials(detailed) };
  if (species === "willow-tree") return { species, pack: createRomanGardenTreeMaterials(species) };
  if (species === "cypress-tree") return { species, pack: createRomanGardenTreeMaterials(species) };
  return { species, pack: createRoadsideShrubMaterials(),
    far: undefined as ReturnType<typeof createRoadsideShrubFarMaterials> | undefined };
};
type SpeciesMaterials = ReturnType<typeof createSpeciesMaterials>;

const buildModel = (owner: SpeciesMaterials, asset: PlantDecorationAsset,
  detailed: boolean, tier: Exclude<OrnamentalPlantTier, "overview">) => {
  if (owner.species === "bonsai-elm")
    return createBonsaiElmModel(owner.pack.materials, detailed && tier === "near", asset.variant, tier === "far");
  if (owner.species === "willow-tree" || owner.species === "cypress-tree")
    return createRomanGardenTreeModel(owner.pack, owner.species, detailed, asset.variant, tier);
  if (owner.species === "roadside-shrub") {
    if (tier === "far") {
      owner.far ??= createRoadsideShrubFarMaterials(owner.pack.materials);
      return createRoadsideShrubFarModel(owner.far.materials, asset.variant, asset.potted);
    }
    return createDenseRoadsideShrubModel(owner.pack.materials, detailed, asset.variant, asset.potted);
  }
  const template = createMapleTreeTemplate(owner.pack, detailed, asset.variant, tier);
  const instance = template.create(asset.palette === "default" ? "red" : asset.palette);
  return { root: instance.root, triangles: template.triangles,
    dispose: () => { instance.dispose(); template.dispose(); } };
};

/** One map/quality owns the pool; all structural variants and near/far tiers borrow species maps. */
export const createOrnamentalPlantModels = (detailed: boolean) => {
  const materials = new Map<SynchronousSpecies, { owner: SpeciesMaterials; users: number }>();
  const create = (asset: PlantDecorationAsset, tier: OrnamentalPlantTier = "near") => {
    if (tier === "overview") throw new Error("Overview icons require the asynchronous canonical template loader");
    if (plantCompletionModelFamily(asset)) throw new Error("Catalog plants require the dedicated completion factory");
    const species = ornamentalPlantModel(asset);
    if (species && species !== "bonsai-elm" && species !== "maple-tree" && species !== "roadside-shrub" &&
      species !== "willow-tree" && species !== "cypress-tree" && species !== "flowering-peach")
      throw new Error("Catalog plant cannot use legacy material ownership");
    if (!species) throw new Error("No accepted ornamental botanical model for this plant form");
    if (species === "flowering-peach") throw new Error("Peach models require asynchronous canonical atlas ownership");
    let entry = materials.get(species);
    if (!entry) {
      entry = { owner: createSpeciesMaterials(species, detailed), users: 0 };
      materials.set(species, entry);
    }
    const borrowed = entry;
    borrowed.users++;
    const release = () => {
      if (--borrowed.users > 0) return;
      if (borrowed.owner.species === "roadside-shrub") borrowed.owner.far?.dispose();
      borrowed.owner.pack.dispose(); materials.delete(species);
    };
    try {
      const model = buildModel(borrowed.owner, asset, detailed, tier);
      let disposed = false;
      return { root: model.root, triangles: model.triangles, dispose: () => {
        if (disposed) return;
        disposed = true; model.dispose(); release();
      } };
    } catch (error) { release(); throw error; }
  };
  return { create };
};

/** Standalone previews own their pack; runtime maps use the shared factory above. */
export const createOrnamentalPlantModel = (asset: PlantDecorationAsset, detailed: boolean,
  tier: OrnamentalPlantTier = "near") => createOrnamentalPlantModels(detailed).create(asset, tier);
