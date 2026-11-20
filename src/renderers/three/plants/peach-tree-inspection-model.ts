import { Mesh } from "three";

import { createFloweringPeachGraph } from "../../../render-common/plants/flowering-peach-graph";
import { mergePeachBlossomSurface } from "./peach-blossom-merged";
import { createPeachBlossomTreeTemplates, type PeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";
import { createPeachStructureModel, type PeachTreeMaterials } from "./peach-tree-model";

/** Flat full3D inspection/export source. Runtime production uses the separately budgeted near/far factory. */
export const createPeachTreeInspectionModel = (materials: PeachTreeMaterials, detailed: boolean,
  variant = 0, borrowedTemplates?: PeachBlossomTreeTemplates) => {
  const graph = createFloweringPeachGraph(variant, true);
  const templates = borrowedTemplates ?? createPeachBlossomTreeTemplates(detailed);
  const body = createPeachStructureModel({ ...graph, blossoms: [] }, materials, detailed);
  body.root.name = `mature-peach-full3d-inspection-${variant}`;
  const geometries = (["petals", "calyx", "centre"] as const).map(surface => {
    const geometry = mergePeachBlossomSurface(graph.blossoms, templates.far[surface]);
    const mesh = new Mesh(geometry, templates.materials[surface]); mesh.name = `peach-${surface}`;
    mesh.castShadow = detailed; mesh.receiveShadow = detailed; body.root.add(mesh);
    return geometry;
  });
  const triangles = body.triangles + graph.blossoms.length * templates.farCost;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; body.dispose(); geometries.forEach(geometry => geometry.dispose());
    if (!borrowedTemplates) templates.dispose();
  };
  return { root: body.root, graph, triangles, individualFlowers: graph.blossoms.length,
    inspectionOnly: true, productionBudgetPassed: false, dispose };
};
