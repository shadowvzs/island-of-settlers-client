import { DoubleSide, MeshStandardMaterial } from "three";

import { createBonsaiElmBarkTextures } from "./bonsai-elm-bark-textures";
import { configureBonsaiElmLeafLighting } from "./bonsai-elm-leaf-lighting";
import { createBonsaiElmLeafTextures } from "./bonsai-elm-leaf-textures";

export interface BonsaiElmAppearance { foliage: string; barkLightness: number }
/** Owner-requested colour correction; High/Minimal close, gameplay and night native proof passed. */
export const VIVID_BONSAI_ELM_APPEARANCE: BonsaiElmAppearance = { foliage: "#87cf43", barkLightness: 1.25 };

/** Elm owns distinct botanical textures; variants/palettes may borrow the same within-species packs. */
export const createBonsaiElmMaterials = (borrowedLeaves?: ReturnType<typeof createBonsaiElmLeafTextures>,
  borrowedBark?: ReturnType<typeof createBonsaiElmBarkTextures>, appearance = VIVID_BONSAI_ELM_APPEARANCE) => {
  const leaves = borrowedLeaves ?? createBonsaiElmLeafTextures();
  const bark = borrowedBark ?? createBonsaiElmBarkTextures(appearance.barkLightness);
  const materials = {
    bark: new MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: .94, vertexColors: true }),
    ceramic: new MeshStandardMaterial({ color: "#344d48", roughness: .43, metalness: .02, vertexColors: true }),
    foliage: new MeshStandardMaterial({ color: appearance.foliage, map: leaves.map, normalMap: leaves.normalMap,
      roughness: .74, side: DoubleSide, alphaTest: .5, vertexColors: true }),
    soil: new MeshStandardMaterial({ color: "#514333", roughness: 1, vertexColors: true })
  };
  materials.bark.normalScale.set(.28, .28); materials.foliage.normalScale.set(.35, .35);
  configureBonsaiElmLeafLighting(materials.foliage);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; Object.values(materials).forEach(material => material.dispose());
    if (!borrowedLeaves) leaves.dispose();
    if (!borrowedBark) bark.dispose();
  };
  return { materials, dispose };
};
