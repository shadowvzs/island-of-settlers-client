import type { Group, Material } from "three";

import type { RoadPlantId } from "../../../../../island-of-settlers-shared/src/road-plant-catalog";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";

export type PlantCompletionTier = "near" | "far";
/** One pooled actual-species/quality/pot/palette owner; every variant and near/far model borrows it. */
export interface PlantCompletionMaterials {
  readonly materials: Readonly<Record<string, Material>>;
  dispose(): void;
}
/** Models own geometry only. Material maps/resources remain owned by the pooled material pack. */
export interface PlantCompletionModel {
  readonly root: Group;
  readonly triangles: number;
  dispose(): void;
}
export interface PlantCompletionDefinition<Pack extends PlantCompletionMaterials> {
  readonly id: string;
  readonly species: readonly RoadPlantId[];
  createMaterials(asset: PlantDecorationAsset, detailed: boolean): Pack;
  createModel(pack: Pack, asset: PlantDecorationAsset, detailed: boolean, tier: PlantCompletionTier): PlantCompletionModel;
}
export interface PlantCompletionOwner {
  create(asset: PlantDecorationAsset, tier: PlantCompletionTier): PlantCompletionModel;
  dispose(): void;
}
export interface PlantCompletionFamily {
  readonly id: string;
  readonly species: readonly RoadPlantId[];
  createOwner(asset: PlantDecorationAsset, detailed: boolean): PlantCompletionOwner;
}

/** Preserve each family's typed optional metadata through a closure, without casting heterogeneous packs. */
export const definePlantCompletionFamily = <Pack extends PlantCompletionMaterials>(
  definition: PlantCompletionDefinition<Pack>
): PlantCompletionFamily => ({
  id: definition.id,
  species: definition.species,
  createOwner: (asset, detailed) => {
    const pack = definition.createMaterials(asset, detailed);
    let disposed = false;
    return {
      create: (variant, tier) => {
        if (disposed) throw new Error("Plant material owner is disposed");
        if (variant.species !== asset.species || variant.potted !== asset.potted || variant.palette !== asset.palette)
          throw new Error("Plant model cannot borrow another species/pot/palette material owner");
        return definition.createModel(pack, variant, detailed, tier);
      },
      dispose: () => { if (!disposed) { disposed = true; pack.dispose(); } }
    };
  }
});
