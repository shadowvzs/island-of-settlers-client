import { Group, type IUniform } from "three";

import { type FellingFrame,LEAF_CAPACITY } from "../../render-common/felling/felling-simulation";
import { getMatureMeshId } from "../../render-common/growth/stage-meshes";
import { getStumpScale } from "../../render-common/props/island-trees";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import { getMeshKind, getMeshVariant } from "../../render-common/props/prop-meshes";
import { createStumpMeshes } from "../../render-common/props/stump-meshes";
import type { TreeLookup, TreeSlot } from "../../render-common/props/tree-lookup";
import { getWinterPropMesh } from "../../render-common/seasonal-appearance/winter-props";
import { createSeasonalPropMaterials } from "./seasonal-prop-materials";
import { createDynamicPropLayer, type DynamicPropLayer } from "./three-dynamic-props";
import { createLeafParticleMesh } from "./three-leaf-particles";
import { createPropMaterial } from "./three-prop-materials";

/** Trees of one mesh falling at the same time; more simply wait their turn. */
const FALLING_CAPACITY = 24;
const STUMP_CAPACITY = 512;

export interface FellingTargets {
  hideStatic: (sourceIndex: number) => void;
  meshes: PropMesh[];
  treeKinds: Set<number>;
  /** World and editor placed trees (placed ones leave their own layer by themselves). */
  trees: TreeLookup;
  visualWinter?: boolean;
}

/**
 * Felling in 3D: once chopping starts, a tree leaves the static chunk meshes and impostors and is
 * drawn by a small chop-enabled layer of its mesh (shake, topple, sink, shadows included); a
 * stump of its kind and the falling leaves are drawn alongside.
 */
export const createThreeFelling = (uniforms: Record<string, IUniform>, targets: FellingTargets) => {
  const { trees } = targets;
  const group = new Group();
  const casters = new Group();
  const falling = new Map<number, DynamicPropLayer>();
  const fallingMaterials = createSeasonalPropMaterials(uniforms, true);
  for (const [meshId, mesh] of targets.meshes.entries()) {
    const kind = getMeshKind(meshId);
    if (!targets.treeKinds.has(kind)) continue;
    const { depth, main } = fallingMaterials.forKind(kind);
    falling.set(meshId, createDynamicPropLayer(mesh, FALLING_CAPACITY, main, depth));
  }
  const stumpMaterial = createPropMaterial(uniforms, false);
  const stumps = new Map(
    [...createStumpMeshes(41)].map(([line, mesh]) => [
      line,
      createDynamicPropLayer(targets.visualWinter ? getWinterPropMesh(mesh) : mesh,
        STUMP_CAPACITY, stumpMaterial, null)
    ])
  );
  for (const layer of [...falling.values(), ...stumps.values()]) {
    group.add(layer.mesh);
    if (layer.caster) casters.add(layer.caster);
  }
  const leaves = createLeafParticleMesh(LEAF_CAPACITY, uniforms, targets.visualWinter);
  group.add(leaves.mesh);
  const hidden = new Set<number>();

  const update = (felling: FellingFrame, fullDetail = true) => {
    const counts = new Map<DynamicPropLayer, number>();
    const add = (layer: DynamicPropLayer | undefined, tree: TreeSlot, chop: number[], size = 1) => {
      if (!layer) return;
      const slot = counts.get(layer) ?? 0;
      layer.write(slot, tree.instances, tree.index, chop, size);
      counts.set(layer, slot + 1);
    };
    for (const id of felling.felledIds()) {
      const tree = trees.find(id);
      if (!tree) continue;
      if (!hidden.has(id) && !tree.placed) targets.hideStatic(id);
      hidden.add(id);
      const { index, instances } = tree;
      const state = felling.getState(id);
      const meshId = instances.meshIds[index]!;
      if (state.showTree) add(falling.get(meshId), tree, state.chop);
      if (!state.showStump) continue;
      const stump = stumps.get(getMatureMeshId(meshId));
      add(stump, tree, [0, 0, 0, 0], getStumpScale(getMeshKind(meshId), getMeshVariant(meshId)));
    }
    for (const layer of [...falling.values(), ...stumps.values()]) {
      layer.setDetail(fullDetail);
      layer.commit(counts.get(layer) ?? 0);
    }
    leaves.update(felling.leaves);
  };

  return { casters, group, update };
};
