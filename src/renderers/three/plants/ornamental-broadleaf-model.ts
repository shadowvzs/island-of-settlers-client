import type { ColorRepresentation } from "three";

import type { PeachTreeMaterials } from "./peach-tree-model";
import { createRoadsideShrubMaterials } from "./roadside-shrub-materials";
import { createDenseRoadsideShrubModel } from "./roadside-shrub-model";

export { createFloweringPeachModel } from "./peach-tree-model";
export type OrnamentalBroadleafMaterials = PeachTreeMaterials;

/** Legacy shrub-preview adapter; adult peach uses its own material/model module directly. */
export const createOrnamentalBroadleafMaterials = (blossom: ColorRepresentation = "#f9b6c6") => {
  const pack = createRoadsideShrubMaterials(); pack.materials.flowers.color.set(blossom);
  return { materials: { ...pack.materials, blossom: pack.materials.flowers }, dispose: pack.dispose };
};

export const createRoadsideShrubModel = (materials: OrnamentalBroadleafMaterials,
  detailed: boolean, variant = 0, potted = true) =>
  createDenseRoadsideShrubModel({ ...materials, flowers: materials.blossom }, detailed, variant, potted);
