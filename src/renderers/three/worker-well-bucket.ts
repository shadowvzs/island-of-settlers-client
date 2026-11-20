import { Group, MeshStandardMaterial } from "three";

import type { WorkerNation } from "../../render-common/workers/worker-nation";
import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import { createRomanDrawBucket } from "./buildings/roman-draw-bucket";

/** Carries the actual round drawing bucket, with its existing iron handle and visible water. */
export const createWorkerWellBucket = (
  materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean, compactStock = false, nation: WorkerNation = "roman"
) => {
  const water = materials.paint.clone();
  water.color.setRGB(.045, .24, .3);
  water.roughness = .2;
  water.metalness = .08;
  const bucket = createRomanDrawBucket(materials, water, detailed, compactStock, nation).root;
  bucket.name = "ware_geometry";
  const root = new Group();
  root.name = "ware_water_well";
  root.userData.sharedWareMaterials = true;
  root.userData.disposeOwnedMaterials = () => water.dispose();
  root.add(bucket);
  return root;
};
