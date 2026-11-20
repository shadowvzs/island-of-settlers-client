import { DoubleSide, MeshStandardMaterial } from "three";

import { createOrnamentalLeafTextures } from "./ornamental-leaf-textures";
import { createPeachBarkTextures } from "./peach-bark-textures";
import type { PeachTreeMaterials } from "./peach-tree-model";

/** Peach owns its age-specific warm reddish/grey bark; no pine/bonsai wood material is borrowed. */
export const createPeachTreeMaterials = () => {
  const barkTextures = createPeachBarkTextures(), leafTextures = createOrnamentalLeafTextures();
  const bark = new MeshStandardMaterial({ color: "#ffffff", map: barkTextures.map,
    normalMap: barkTextures.normalMap, roughnessMap: barkTextures.roughnessMap, roughness: 1, vertexColors: true });
  bark.normalScale.set(.85, .85);
  const barkYoung = new MeshStandardMaterial({ color: "#ffffff", map: barkTextures.youngMap,
    normalMap: barkTextures.youngNormalMap, roughnessMap: barkTextures.youngRoughnessMap, roughness: 1, vertexColors: true });
  barkYoung.normalScale.set(.45, .45);
  const foliage = new MeshStandardMaterial({ color: "#47703b", map: leafTextures.map,
    normalMap: leafTextures.normalMap, roughness: .78, side: DoubleSide, vertexColors: true });
  foliage.normalScale.set(.55, .55);
  const unused = new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: .85, side: DoubleSide });
  const materials: PeachTreeMaterials = { bark, barkYoung, foliage, blossom: unused, ceramic: unused, soil: unused };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; bark.dispose(); barkYoung.dispose(); foliage.dispose(); unused.dispose();
    barkTextures.dispose(); leafTextures.dispose();
  };
  return { materials, dispose };
};
