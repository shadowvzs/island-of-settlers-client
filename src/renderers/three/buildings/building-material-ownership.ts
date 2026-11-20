import type { Material, MeshStandardMaterial, Texture } from "three";

const TEXTURE_SLOTS = ["map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap",
  "lightMap", "metalnessMap", "normalMap", "roughnessMap"] as const;
const materialTextures = new WeakMap<Material, ReadonlySet<Texture>>();
const textureUsers = new WeakMap<Texture, number>();

/** Texture.dispose is separate from Material.dispose. Shared pack/cache maps remain borrowed. */
export const ownBuildingMaterial = (material: MeshStandardMaterial, source: MeshStandardMaterial | undefined,
  newTextures: boolean) => {
  const borrowed = new Set(TEXTURE_SLOTS.map(slot => source?.[slot]).filter(Boolean));
  const owned = new Set<Texture>();
  if (newTextures) for (const slot of TEXTURE_SLOTS) {
    const texture = material[slot];
    if (texture && !borrowed.has(texture)) owned.add(texture);
  }
  registerTextures(material, owned);
  return material;
};

const registerTextures = (material: Material, textures: ReadonlySet<Texture>) => {
  if (materialTextures.has(material)) throw new Error("Building material already has an ownership policy");
  materialTextures.set(material, textures);
  for (const texture of textures) textureUsers.set(texture, (textureUsers.get(texture) ?? 0) + 1);
  const release = () => {
    material.removeEventListener("dispose", release);
    materialTextures.delete(material);
    for (const texture of textures) {
      const remaining = (textureUsers.get(texture) ?? 1) - 1;
      if (remaining > 0) textureUsers.set(texture, remaining);
      else { textureUsers.delete(texture); texture.dispose(); }
    }
  };
  material.addEventListener("dispose", release);
};

/** A placement ghost takes over the same private maps before its original material is released. */
export const shareBuildingMaterialOwnership = (source: Material, copy: Material) => {
  const textures = materialTextures.get(source);
  if (textures) registerTextures(copy, textures);
};

export const hasBuildingMaterialOwnership = (material: Material) => materialTextures.has(material);
