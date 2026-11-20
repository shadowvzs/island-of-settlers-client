import { createCatalogShrubMaterials } from "./catalog-shrub-materials";
import { createCatalogShrubModel } from "./catalog-shrub-model";
import { definePlantCompletionFamily } from "./plant-completion-contract";

export const CATALOG_FLOWER_ADAPTER = definePlantCompletionFamily({ id: "catalog-flower",
  species: ["azalea", "white-rose", "red-rose", "lavender", "rosemary", "hibiscus", "hydrangea", "marigold"],
  createMaterials: createCatalogShrubMaterials, createModel: createCatalogShrubModel });
