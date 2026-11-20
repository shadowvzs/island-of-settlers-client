import { Color, DoubleSide, MeshStandardMaterial, SRGBColorSpace } from "three";

import { getRoadPlant } from "../../../../../island-of-settlers-shared/src/road-plant-catalog";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { createCatalogShrubTextures } from "./catalog-shrub-textures";

export const createCatalogShrubMaterials = (asset: PlantDecorationAsset, detailed: boolean) => {
  const definition = getRoadPlant(asset.species);
  if (!definition) throw new Error(`Unknown shrub ${asset.species}`);
  const textures = createCatalogShrubTextures(detailed), maps = textures.maps;
  const foliage = new Color().setRGB(...definition.foliage, SRGBColorSpace);
  const blossom = new Color().setRGB(...(definition.blossom ?? [1, .95, .81]), SRGBColorSpace);
  const materials = {
    stems: new MeshStandardMaterial({ color: "#846044", roughness: .91, vertexColors: true, map: maps.bark }),
    green: new MeshStandardMaterial({ color: foliage, roughness: .70, map: maps.leaf, normalMap: maps.leafNormal,
      side: DoubleSide, vertexColors: true, emissive: foliage, emissiveIntensity: .055 }),
    petals: new MeshStandardMaterial({ color: blossom, roughness: .67, map: maps.petal,
      side: DoubleSide, vertexColors: true, emissive: blossom, emissiveIntensity: .045 }),
    pollen: new MeshStandardMaterial({ color: "#f4c85b", roughness: .75, side: DoubleSide, vertexColors: true }),
    pot: new MeshStandardMaterial({ color: asset.species === "hydrangea" ? "#708e9a" : "#bc724c",
      roughness: .61, map: maps.clay, normalMap: maps.clayNormal, vertexColors: false, side: DoubleSide }),
    soil: new MeshStandardMaterial({ color: "#574331", roughness: 1, map: maps.soil, normalMap: maps.soilNormal, vertexColors: false })
  };
  materials.green.normalScale.set(.35, .35); materials.pot.normalScale.set(.25, .25);
  materials.soil.normalScale.set(.65, .65);
  let disposed = false;
  return { materials, dispose: () => {
    if (disposed) return;
    disposed = true; Object.values(materials).forEach(material => material.dispose());
    textures.dispose();
  } };
};
