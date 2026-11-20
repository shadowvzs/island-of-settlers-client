import type { MeshStandardMaterial, Texture } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { createBanditSurfaceTextures } from "./bandit-surface-textures";

/** Original outlaw salvage maps, separately owned from every national material pack. */
export const createNeutralBuildingMaterials = (
  base: Record<BuildingSurface, MeshStandardMaterial>
) => {
  const materials = { ...base };
  const owned: MeshStandardMaterial[] = [];
  const textures: Texture[] = [];
  const detailed = Boolean(base.stone.normalMap || base.stone.bumpMap);
  const tints: Partial<Record<BuildingSurface, number>> = {
    cloth: 0xb7a58b,
    iron: 0x655e54,
    planks: 0xd2c0a3,
    roof: 0xa6967c,
    stone: 0xcbc5b3,
    wood: 0xa89985,
    bark: 0x8e806a,
    rope: 0xb4a47f,
    plaster: 0xd4b987,
    "roof-thatch": 0xc6b88c,
    "roof-shingles": 0x8b8170
  };
  for (const [surface, tint] of Object.entries(tints)) {
    if (tint === undefined) continue;
    const material = base[surface as BuildingSurface].clone();
    const maps = createBanditSurfaceTextures(surface as BuildingSurface, detailed);
    textures.push(...maps);
    material.map = maps[0];
    material.normalMap = null;
    material.roughnessMap = null;
    material.bumpMap = detailed ? maps[1] : null;
    material.bumpScale = 0.006;
    material.color.setHex(tint);
    material.roughness = surface === "iron" ? 0.75 : 0.95;
    materials[surface as BuildingSurface] = material;
    owned.push(material);
  }
  return {
    materials,
    dispose: () => {
      owned.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    }
  };
};
