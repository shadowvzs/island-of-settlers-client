import { DoubleSide, MeshStandardMaterial } from "three";

import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { createCatalogBonsaiBark } from "./catalog-bonsai-bark";
import { createCatalogBonsaiSurface } from "./catalog-bonsai-surfaces";
import type { PlantCompletionMaterials } from "./plant-completion-contract";

export interface CatalogBonsaiMaterials extends PlantCompletionMaterials {
  materials: Record<"bark" | "ceramic" | "foliage" | "flower" | "soil", MeshStandardMaterial>;
}

/** Opaque dimensional foliage batches avoid alpha overdraw and retain the authored rich green. */
export const createCatalogBonsaiMaterials = (asset: PlantDecorationAsset): CatalogBonsaiMaterials => {
  const foliage: Record<string, string> = {
    "bonsai-pine": "#54a333", "bonsai-juniper": "#469e84",
    "bonsai-azalea": "#5ca936", "bonsai-maple": "#8bcd43"
  };
  const bark = createCatalogBonsaiBark(asset.species === "bonsai-juniper");
  const leaf = asset.species === "bonsai-pine" ? undefined : createCatalogBonsaiSurface("leaf");
  const soil = createCatalogBonsaiSurface("soil"), glaze = createCatalogBonsaiSurface("glaze");
  const materials = {
    bark: new MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: .94, vertexColors: true }),
    ceramic: new MeshStandardMaterial({ color: "#357e85", map: glaze.map, normalMap: glaze.normalMap, roughness: .33, metalness: .03 }),
    foliage: new MeshStandardMaterial({ color: foliage[asset.species], map: leaf?.map ?? null, normalMap: leaf?.normalMap ?? null, roughness: .82,
      side: DoubleSide, vertexColors: true }),
    flower: new MeshStandardMaterial({ color: "#ff72ad", roughness: .74, side: DoubleSide, vertexColors: true }),
    soil: new MeshStandardMaterial({ color: "#b69a71", map: soil.map, normalMap: soil.normalMap, roughness: 1 })
  };
  materials.bark.normalScale.set(.24, .24);
  materials.foliage.normalScale.set(.38, .38);
  materials.soil.normalScale.set(.7, .7);
  materials.ceramic.normalScale.set(.16, .16);
  let disposed = false;
  return { materials, dispose: () => {
    if (disposed) return;
    disposed = true; Object.values(materials).forEach(material => material.dispose()); bark.dispose(); leaf?.dispose(); soil.dispose(); glaze.dispose();
  } };
};
