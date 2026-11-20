import { DoubleSide, MeshStandardMaterial } from "three";

import { createRoadsideShrubTextures } from "./roadside-shrub-textures";

/** Shared neutral detail, per-palette material ownership, no texture allocation per leaf or pot. */
export const createRoadsideShrubMaterials = (foliage = "#57813d", ceramic = "#526e70",
  borrowedTextures?: ReturnType<typeof createRoadsideShrubTextures>) => {
  const textures = borrowedTextures ?? createRoadsideShrubTextures(), detail = textures.maps;
  const materials = {
    bark: new MeshStandardMaterial({ color: "#686044", roughness: .96, vertexColors: true }),
    ceramic: new MeshStandardMaterial({ color: ceramic, roughness: .44, metalness: .025,
      map: detail.ceramic, normalMap: detail.ceramicNormal, roughnessMap: detail.ceramicRoughness, vertexColors: true }),
    foliage: new MeshStandardMaterial({ color: foliage, roughness: .63,
      map: detail.leaf, normalMap: detail.leafNormal,
      emissive: foliage, emissiveIntensity: .085, side: DoubleSide, vertexColors: true }),
    flowers: new MeshStandardMaterial({ color: "#fff8df", roughness: .73, side: DoubleSide, vertexColors: true }),
    soil: new MeshStandardMaterial({ color: "#ffffff", roughness: 1, map: detail.soil,
      normalMap: detail.soilNormal, vertexColors: true })
  };
  materials.ceramic.normalScale.set(.42, .42);
  materials.foliage.normalScale.set(.42, .42); materials.soil.normalScale.set(.62, .62);
  let disposed = false;
  return { materials, texturePack: textures,
    maps: { ...detail, map: detail.leaf, normalMap: detail.leafNormal }, dispose: () => {
    if (disposed) return;
    disposed = true; Object.values(materials).forEach(material => material.dispose());
    if (!borrowedTextures) textures.dispose();
  } };
};
