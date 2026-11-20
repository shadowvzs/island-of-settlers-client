import { type MeshStandardMaterial, type Texture } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import {
  enemyBuildingDesign,
  type EnemyBuildingStyle
} from "../../../render-common/buildings/themed-neutral-building-style";
import { createBanditSurfaceTextures } from "./bandit-surface-textures";
import { createNeutralBuildingMaterials } from "./neutral-building-materials";

/** Each bounded theme pack owns its original salvage maps and material clones. */
export const createThemedNeutralBuildingMaterials = (
  base: Record<BuildingSurface, MeshStandardMaterial>,
  style: EnemyBuildingStyle,
  baseIsNeutral = false
) => {
  const neutral = baseIsNeutral ? undefined : createNeutralBuildingMaterials(base),
    materials = { ...(neutral?.materials ?? base) };
  const owned: MeshStandardMaterial[] = [],
    textures: Texture[] = [];
  const detailed = Boolean(base.stone.normalMap||base.stone.bumpMap),
    design = enemyBuildingDesign(style);
  const colours = {
    ...design.colours,
    bark: design.colours.wood ?? 0x8e806a,
    rope: 0xb4a47f,
    paint:0xffffff,
    "roof-shingles": design.colours["roof-shingles"] ?? 0x8b8170,
    "roof-thatch": design.colours["roof-thatch"] ?? 0xb6a273
  };
  for (const [name, tint] of Object.entries(colours)) {
    const surface = name as BuildingSurface,
      material = materials[surface].clone();
    const maps = createBanditSurfaceTextures(surface==="paint"?"cloth":surface, detailed);
    textures.push(...maps);
    material.map = maps[0];
    material.normalMap = null;
    material.roughnessMap = null;
    material.bumpMap = detailed ? maps[1] : null;
    material.bumpScale = 0.006;
    material.color.setHex(tint!);
    material.roughness = surface === "iron" ? 0.85 : 0.98;
    materials[surface] = material;
    owned.push(material);
  }
  return {
    materials,
    dispose: () => {
      owned.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      neutral?.dispose();
    }
  };
};
