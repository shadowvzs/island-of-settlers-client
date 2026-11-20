import { Group, Mesh, type MeshBasicMaterial } from "three";

import { createFloweringPeachGraph } from "../../../render-common/plants/flowering-peach-graph";
import { createPeachBlossomTreeTemplates, type PeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";
import { createPeachTreeImpostorGeometry } from "./peach-tree-impostor";
import type { PeachTreeMaterials } from "./peach-tree-model";
import { createPeachTreeNearModel } from "./peach-tree-near-model";

export type PeachProductionTier = "near" | "far" | "overview";
export type PeachProductionMaterials = PeachTreeMaterials & { impostor?: MeshBasicMaterial; crowns?: MeshBasicMaterial };

/** Flat templates only: the runtime batches direct Mesh children and owns spatial near/far selection. */
export const createFloweringPeachProductionModel = (materials: PeachProductionMaterials, detailed: boolean,
  variant = 0, tier: PeachProductionTier = "far", borrowedTemplates?: PeachBlossomTreeTemplates) => {
  if (![0, 1, 2].includes(variant)) throw new Error("Unknown peach production variant");
  if (tier !== "near") {
    if (!materials.impostor) throw new Error("A canonical-rendered peach atlas is required for the distant production tier");
    const root = new Group(), geometry = createPeachTreeImpostorGeometry();
    root.name = `peach-production-far-${variant}`;
    const mesh = new Mesh(geometry, materials.impostor); mesh.name = "peach-canonical-impostor";
    mesh.customDepthMaterial = materials.impostor.userData.peachDepthMaterial;
    mesh.castShadow = detailed;
    root.add(mesh);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true; root.removeFromParent(); root.clear(); geometry.dispose();
    };
    return { root, triangles: 2, individualFlowers: 0, representedFlowers: 5376, realLeaves: 0, realWoodLimbs: 0, heroFlowers: 0,
      tier, budgetPassed: true, dispose };
  }
  if (!materials.crowns) throw new Error("Original branch-mass atlases are required for the near production tier");
  const graph = createFloweringPeachGraph(variant, true);
  const templates = borrowedTemplates ?? createPeachBlossomTreeTemplates(detailed);
  const near = createPeachTreeNearModel(graph, materials, detailed, templates, materials.crowns);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; near.dispose(); if (!borrowedTemplates) templates.dispose();
  };
  return { ...near, tier, dispose };
};
