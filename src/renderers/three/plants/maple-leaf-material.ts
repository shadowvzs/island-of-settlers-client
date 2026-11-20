import { DoubleSide, MeshStandardMaterial, Vector2 } from "three";

import { createMapleLeafTextures } from "./maple-leaf-textures";

export const MAPLE_LEAF_PALETTES = Object.freeze({ yellow: 0xffce31, orange: 0xf77c24, red: 0xe44332 });
export type MapleLeafPalette = keyof typeof MAPLE_LEAF_PALETTES;

/** One neutral texture pair serves all palettes and tree structures owned by this shared pack. */
export const createMapleLeafMaterials = (detailed = true) => {
  const textures = createMapleLeafTextures(), materials = new Map<MapleLeafPalette, MeshStandardMaterial>();
  let disposed = false;
  const material = (palette: MapleLeafPalette) => {
    if (disposed) throw new Error("Maple leaf material owner disposed");
    const existing = materials.get(palette);
    if (existing) return existing;
    const created = new MeshStandardMaterial({ color: MAPLE_LEAF_PALETTES[palette],
      emissive: MAPLE_LEAF_PALETTES[palette], emissiveIntensity: .13,
      map: textures.map, normalMap: textures.normalMap, normalScale: new Vector2(.42, .42),
      metalness: 0, roughness: .78, side: DoubleSide, vertexColors: true });
    created.name = `maple_leaf_${palette}`;
    created.shadowSide = DoubleSide;
    if (!detailed) created.normalScale.set(.24, .24);
    materials.set(palette, created); return created;
  };
  return { material, map: textures.map, normalMap: textures.normalMap, dispose: () => {
    if (disposed) return;
    disposed = true;
    for (const owned of materials.values()) owned.dispose();
    materials.clear(); textures.dispose();
  } };
};
