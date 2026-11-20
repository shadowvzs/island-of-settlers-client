import { createIslandTreeStageMesh } from "../../src/render-common/props/island-trees";
import type { PropMesh } from "../../src/render-common/props/mesh-builder";
import { PROP_MESH_SEED } from "../../src/render-common/props/prop-mesh-seed";
import { createPropMesh } from "../../src/render-common/props/prop-meshes";
import type { GrowthStage } from "../../src/render-common/trees/tree-model";
import { PROP } from "../../src/shared/world/world-data";

/**
 * Height and triangle budgets (full / core) of the broadleaf foliage props and young trees.
 * prop-meshes imports GLB urls, so run it with a loader that stubs asset imports, e.g.
 * `npx tsx --import <register stubbing .glb/.png/?url> tools/bench/foliage-budget.ts`.
 */
const STAGE_SEED = 4049;

const describe = (mesh: PropMesh) => {
  const full = mesh.indices.length / 3;
  const core = (mesh.coreIndexCount ?? mesh.indices.length) / 3;
  return `h${mesh.height.toFixed(2)} ${full}/${core}`;
};

const propRows = (name: string, kind: number, variants: number[]) =>
  variants.map((variant): [string, () => PropMesh] =>
    [`${name} v${variant}`, () => createPropMesh(PROP_MESH_SEED, kind, variant)]);

const stageRows = (name: string, kind: number, stages: GrowthStage[]) =>
  stages.map((stage): [string, () => PropMesh] =>
    [`${name} stage ${stage}`, () => createIslandTreeStageMesh(kind, stage, 0, STAGE_SEED)]);

const rows = [
  ...propRows("sapling", PROP.sapling, [0, 1, 2]),
  ...propRows("bush", PROP.bush, [0, 1]),
  ...propRows("berryBush", PROP.berryBush, [0, 1]),
  ...propRows("broadleafShrub", PROP.broadleafShrub, [0, 1]),
  ...propRows("fieldShrub", PROP.fieldShrub, [0, 1]),
  ...propRows("riverShrub", PROP.riverShrub, [0, 1]),
  ...propRows("birchTree", PROP.birchTree, [0, 1, 2, 3, 4]),
  ...stageRows("oak", PROP.broadleafTree, [1, 2, 3, 5]),
  ...stageRows("birch young", PROP.birchTree, [1, 2, 5])
];
for (const [label, build] of rows) console.log(label.padEnd(24), describe(build()));
