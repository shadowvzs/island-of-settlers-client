import { Group, type IUniform } from "three";

import {
  createTreeStageMeshes,
  getGrowthScale,
  getMatureMeshId
} from "../../render-common/growth/stage-meshes";
import {
  createStaticTreeForms,
  type StaticTreeForm
} from "../../render-common/growth/static-tree-forms";
import type { GrowthFrame } from "../../render-common/growth/tree-growth";
import { getTreeSpecies } from "../../render-common/props/island-trees";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getMeshKind } from "../../render-common/props/prop-meshes";
import type { TreeLookup } from "../../render-common/props/tree-lookup";
import { getWinterPropMesh } from "../../render-common/seasonal-appearance/winter-props";
import { createSeasonalPropMaterials } from "./seasonal-prop-materials";
import { createDynamicPropLayer, type DynamicPropLayer,NO_CHOP } from "./three-dynamic-props";

/** Room for editor placed trees growing at the same time as the world's sprouts (per line). */
const PLACED_GROWTH_ROOM = 32;

export interface GrowthTargets {
  instances: PropInstances;
  meshes: PropMesh[];
  seed: number;
  /** Moves a world tree (instance index) to another static mesh, drawn visible. */
  setStaticMesh: (index: number, meshId: number) => void;
  /** World and editor placed trees (placed ones have no static instance to switch). */
  trees: TreeLookup;
  /** Shows / hides a world prop in the static meshes and impostors. */
  setStaticVisible: (sourceIndex: number, visible: boolean) => void;
  /** The grown mesh table is already seasonal; generate matching cached sapling stages. */
  visualWinter?: boolean;
}

const isTreeMesh = (meshId: number) => getTreeSpecies(getMeshKind(meshId)) !== undefined;

/** Growth line of a tree mesh: the mature mesh it grows into. */
const getLine = (meshId: number) => getMatureMeshId(meshId);

/** Instance index of every tree by world prop id, for the growth lines that exist. */
const createLineLookup = (instances: PropInstances, lines: Map<number, unknown>) => {
  const lookup = new Map<number, number>();
  for (let index = 0; index < instances.count; index += 1) {
    const meshId = instances.meshIds[index]!;
    if (isTreeMesh(meshId) && lines.has(getLine(meshId)))
      lookup.set(instances.sourceIndex[index]!, index);
  }
  return lookup;
};

/**
 * Room in the static mature tree meshes for every tree of their kind: with growth on, every tree
 * ends there.
 */
export const getMatureCapacities = (instances: PropInstances) => {
  const capacities = new Map<number, number>();
  for (let index = 0; index < instances.count; index += 1) {
    const meshId = instances.meshIds[index]!;
    if (!isTreeMesh(meshId)) continue;
    const mature = getMatureMeshId(meshId);
    capacities.set(mature, (capacities.get(mature) ?? 0) + 1);
  }
  return capacities;
};

/**
 * Growing trees in 3D: a growing tree leaves the static meshes and is drawn by the dynamic layer
 * of its current stage, swelling towards the next stage; once grown it moves to the static
 * mature mesh (same size as the last stage, so no pop) and back to its world variant when growth
 * is switched off.
 */
export const createThreeGrowth = (uniforms: Record<string, IUniform>, targets: GrowthTargets) => {
  const { instances } = targets;
  const group = new Group();
  const casters = new Group();
  const transformSapling = targets.visualWinter ? getWinterPropMesh : undefined;
  const stageMeshes = createTreeStageMeshes(targets.meshes, targets.seed, transformSapling);
  const lookup = createLineLookup(instances, stageMeshes);
  const worldMeshIds = Uint16Array.from(instances.meshIds);
  const perLine = new Map<number, number>();
  for (const index of lookup.values()) {
    const line = getLine(instances.meshIds[index]!);
    perLine.set(line, (perLine.get(line) ?? 0) + 1);
  }
  const materials = createSeasonalPropMaterials(uniforms, true);
  const layers = new Map<number, DynamicPropLayer[]>();
  /** Stage layers of a growth line, created when its first tree grows (room for placed ones). */
  const getLayers = (line: number) => {
    const known = layers.get(line);
    const meshes = stageMeshes.get(line);
    if (known || !meshes) return known;
    const capacity = (perLine.get(line) ?? 0) + PLACED_GROWTH_ROOM;
    const { depth, main } = materials.forKind(getMeshKind(line));
    const list = meshes.map((mesh) => createDynamicPropLayer(mesh, capacity, main, depth));
    for (const layer of list) {
      group.add(layer.mesh);
      if (layer.caster) casters.add(layer.caster);
    }
    layers.set(line, list);
    return list;
  };

  const applyForm = (id: number, form: StaticTreeForm) => {
    const index = lookup.get(id);
    if (index === undefined) return;
    if (form === "hidden") {
      targets.setStaticVisible(id, false);
      return;
    }
    const world = worldMeshIds[index]!;
    const meshId = form === "mature" ? getMatureMeshId(world) : world;
    if (instances.meshIds[index] === meshId) targets.setStaticVisible(id, true);
    else targets.setStaticMesh(index, meshId);
  };
  const forms = createStaticTreeForms(applyForm);

  const update = (growth: GrowthFrame, fullDetail = true) => {
    forms.sync(growth);
    const counts = new Map<DynamicPropLayer, number>();
    for (const tree of growth.growing()) {
      const slotOf = targets.trees.find(tree.id);
      if (!slotOf) continue;
      const line = getLine(slotOf.instances.meshIds[slotOf.index]!);
      const layer = getLayers(line)?.[tree.stage - 1];
      if (!layer) continue;
      const slot = counts.get(layer) ?? 0;
      const size = getGrowthScale(stageMeshes.get(line)!, tree.stage, tree.progress);
      layer.write(slot, slotOf.instances, slotOf.index, NO_CHOP, size);
      counts.set(layer, slot + 1);
    }
    for (const list of layers.values())
      for (const layer of list) {
        layer.setDetail(fullDetail);
        layer.commit(counts.get(layer) ?? 0);
      }
  };

  return { casters, group, update };
};
