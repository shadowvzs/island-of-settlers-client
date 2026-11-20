import { type ColorRepresentation } from "three";

import type { OrnamentalBlossom } from "../../../render-common/plants/ornamental-tree-graph";
import { createPeachBlossomFarGeometries, createPeachBlossomGeometries } from "./peach-blossom-geometry";
import { createPeachBlossomMaterials } from "./peach-blossom-materials";

/** Explicit private template owner. All tree structures/palettes may borrow these unit-radius buffers. */
export const createPeachBlossomTreeTemplates = (detailed: boolean, colour: ColorRepresentation = "#ed9bb5") => {
  const flower: OrnamentalBlossom = { position: [0, 0, 0], yaw: 0, pitch: 0, radius: 1, seed: 0 };
  const hero = createPeachBlossomGeometries(flower, detailed);
  const canopy = createPeachBlossomGeometries(flower, detailed, true);
  const far = createPeachBlossomFarGeometries(flower);
  const pack = createPeachBlossomMaterials(colour);
  const cost = (surfaces: typeof hero) => Object.values(surfaces)
    .reduce((sum, geometry) => sum + geometry.index!.count / 3, 0);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of new Set([...Object.values(hero), ...Object.values(canopy), ...Object.values(far)])) geometry.dispose();
    pack.dispose();
  };
  return { hero, canopy, far, materials: pack.materials, heroCost: cost(hero), canopyCost: cost(canopy), farCost: cost(far), dispose };
};

export type PeachBlossomTreeTemplates = ReturnType<typeof createPeachBlossomTreeTemplates>;
