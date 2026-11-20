import type { PeachTreeGraph } from "../../../render-common/plants/flowering-peach-graph";
import { createPeachBlossomInstances } from "./peach-blossom-instances";
import type { PeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";
import { selectPeachCrownDetails } from "./peach-crown-layout";
import { createPeachStructureModel, type PeachTreeMaterials } from "./peach-tree-model";

/** Original branch-mass bake donor; chosen live wood/leaves/flowers are excluded rather than duplicated. */
export const createPeachCrownCapture = (graph: PeachTreeGraph, materials: PeachTreeMaterials,
  detailed: boolean, groupIndex: number, templates: PeachBlossomTreeTemplates) => {
  const group = graph.crownGroups[groupIndex];
  if (!group) throw new Error("Unknown peach crown mass");
  const selection = selectPeachCrownDetails(graph, detailed);
  const limbs = graph.limbs.flatMap((limb, index) => index >= group.limbStart && index < group.limbEnd &&
    !selection.wood.has(index) ? [{ ...limb, parent: null }] : []);
  const leaves = graph.leaves.filter((_, index) => index >= group.leafStart && index < group.leafEnd && !selection.leaves.has(index));
  const blossoms = graph.blossoms.filter((_, index) => index >= group.flowerStart && index < group.flowerEnd && !selection.flowers.has(index));
  const body = createPeachStructureModel({ ...graph, limbs, leaves, blossoms: [] }, materials, detailed);
  const flowers = createPeachBlossomInstances(blossoms, templates.far, templates.materials, detailed);
  body.root.add(flowers.root);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; flowers.dispose(); body.dispose();
  };
  return { root: body.root, representedFlowers: blossoms.length, dispose };
};
