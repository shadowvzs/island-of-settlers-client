import { Group, type IUniform } from "three";

import type { FellingFrame } from "../../render-common/felling/felling-simulation";
import { getMatureMeshId } from "../../render-common/growth/stage-meshes";
import type { GrowthFrame } from "../../render-common/growth/tree-growth";
import { getTreeSpecies } from "../../render-common/props/island-trees";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getMeshKind } from "../../render-common/props/prop-meshes";
import { createDynamicPropLayer, type DynamicPropLayer,NO_CHOP } from "./three-dynamic-props";
import { createPropDepthMaterial, createPropMaterial } from "./three-prop-materials";

/** Instance count per mesh a placed set may draw: its own mesh and the mature one it grows to. */
const countMeshSlots = (instances: PropInstances) => {
  const counts = new Map<number, number>();
  for (let index = 0; index < instances.count; index += 1) {
    const meshId = instances.meshIds[index]!;
    const isTree = getTreeSpecies(getMeshKind(meshId)) !== undefined;
    const meshIds = new Set([meshId, isTree ? getMatureMeshId(meshId) : meshId]);
    for (const id of meshIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

/**
 * Props placed with the map editor in 3D: the same prop meshes and materials as the world's
 * trees (wind, sun shadows), small instanced layers per mesh written every frame from the trees'
 * state: standing ones as placed or grown mature; felled and growing ones are left to the felling
 * and growth layers. Rebuilt when the placed set changes. They stay full meshes at every zoom
 * (no impostor, a few hundred at most).
 */
export const createThreePlacedProps = (meshes: PropMesh[], uniforms: Record<string, IUniform>) => {
  const group = new Group();
  const casters = new Group();
  const materials = {
    depth: createPropDepthMaterial(uniforms, true),
    main: createPropMaterial(uniforms, false, true)
  };
  let layers = new Map<number, DynamicPropLayer>();
  let current: PropInstances | null = null;

  const setInstances = (instances: PropInstances) => {
    for (const layer of layers.values()) layer.dispose();
    current = instances;
    layers = new Map(
      [...countMeshSlots(instances)].map(([meshId, capacity]) => {
        const layer = createDynamicPropLayer(
          meshes[meshId]!,
          capacity,
          materials.main,
          materials.depth
        );
        group.add(layer.mesh);
        if (layer.caster) casters.add(layer.caster);
        return [meshId, layer];
      })
    );
  };

  const update = (felling: FellingFrame, growth: GrowthFrame) => {
    if (!current) return;
    const counts = new Map<DynamicPropLayer, number>();
    for (let index = 0; index < current.count; index += 1) {
      const id = current.sourceIndex[index]!;
      if (growth.isGrowing(id) || felling.getState(id).phase !== "standing") continue;
      const meshId = current.meshIds[index]!;
      const layer = layers.get(growth.isGrown(id) ? getMatureMeshId(meshId) : meshId);
      if (!layer) continue;
      const slot = counts.get(layer) ?? 0;
      layer.write(slot, current, index, NO_CHOP);
      counts.set(layer, slot + 1);
    }
    for (const layer of layers.values()) layer.commit(counts.get(layer) ?? 0);
  };

  const refreshHeights = (heights: ReadonlyMap<number, number>) => {
    if (!current) return;
    for (let index = 0; index < current.count; index++) {
      const height = heights.get(current.sourceIndex[index]!);
      if (height !== undefined) current.y[index] = height;
    }
  };
  return { casters, group, refreshHeights, setInstances, update };
};
