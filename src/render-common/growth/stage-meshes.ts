import { getFormArchetype } from "../../shared/world/tree-forms";
import {
  createIslandTreeStageMesh,
  findTreeVariant,
  getMatureVariant,
  getTreeVariants,
  TREE_KINDS
} from "../props/island-trees";
import type { PropMesh } from "../props/mesh-builder";
import { getMeshId, getMeshKind, getMeshVariant } from "../props/prop-meshes";
import type { GrowthStage } from "../trees/tree-model";

const SAPLING_STAGES: GrowthStage[] = [1, 2];
const GROWN_STAGES: GrowthStage[] = [3, 4, 5];

/** Mesh id of the mature tree of the same kind and form (where every grown tree ends). */
export const getMatureMeshId = (meshId: number) => {
  const kind = getMeshKind(meshId);
  return getMeshId(kind, getMatureVariant(kind, getMeshVariant(meshId)));
};

/**
 * Meshes of every growth stage per growth line (key: the mature mesh id, index = stage - 1):
 * the saplings are built here (per kind and archetype, shared by its competition forms), the
 * later stages are the island's tree variants of that form (same meshes as the grown forest).
 */
export const createTreeStageMeshes = (
  propMeshes: PropMesh[],
  seed: number,
  transformSapling?: (mesh: PropMesh) => PropMesh
) => {
  const lines = new Map<number, PropMesh[]>();
  const saplings = new Map<string, PropMesh>();
  const getSapling = (kind: number, form: number, stage: GrowthStage) => {
    const key = `${kind}:${form}:${stage}`;
    const cached = saplings.get(key);
    if (cached) return cached;
    const source = createIslandTreeStageMesh(kind, stage, form, seed + kind);
    const mesh = transformSapling ? transformSapling(source) : source;
    saplings.set(key, mesh);
    return mesh;
  };
  for (const kind of TREE_KINDS) {
    getTreeVariants(kind).forEach(({ form, stage }, variant) => {
      if (stage !== 5) return;
      const young = SAPLING_STAGES.map((sapling) =>
        getSapling(kind, getFormArchetype(form), sapling)
      );
      const grown = GROWN_STAGES.map(
        (grownStage) => propMeshes[getMeshId(kind, findTreeVariant(kind, form, grownStage))]!
      );
      lines.set(getMeshId(kind, variant), [...young, ...grown]);
    });
  }
  return lines;
};

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** A tree starts as a sprout this fraction of the sapling's size. */
const SPROUT_SCALE = 0.25;

/**
 * Instance scale of a growing tree: the stage mesh swells towards the next stage's height, so
 * the switch to the next mesh keeps the height continuous; stage 1 starts as a small sprout.
 */
export const getGrowthScale = (stageMeshes: PropMesh[], stage: GrowthStage, progress: number) => {
  const current = stageMeshes[stage - 1]!.height;
  const next = stageMeshes[stage]?.height ?? current;
  const start = stage === 1 ? SPROUT_SCALE : 1;
  return start + (next / current - start) * easeInOut(progress);
};
