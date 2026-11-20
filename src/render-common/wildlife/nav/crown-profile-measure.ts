import { createIslandTreePropMesh } from "../../props/island-trees";
import { PROP_MESH_SEED, propMeshRandom, treeModelSeed } from "../../props/prop-mesh-seed";
import type { IslandTreeMeshOptions } from "../../trees/island-tree-mesh";
import { CROWN_BIN, CROWN_BINS } from "./crown-profile";

/**
 * The drawn mesh minus the render-only broadleaf card turn (sprays keep their place and size): a
 * single turned card tip would otherwise decide whether rabbits fit between dense stand trees.
 */
const CROWN_BAKE_MESH: IslandTreeMeshOptions = { cardFacing: false };

/**
 * Lowest height of a tree variant's mesh (trunk flare, limbs, needles, fronds) in rings around the
 * trunk axis: bin b covers b x CROWN_BIN .. (b + 1) x CROWN_BIN, Infinity where nothing is.
 * Builds the drawn mesh (dense for hardwoods) with its cards unturned (CROWN_BAKE_MESH): only the
 * bake tool and its test call it.
 */
export const measureCrownProfile = (kind: number, variant: number) => {
  // The variant the renderers draw (PERF-02): animals keep clear of the visible crown.
  const seed = treeModelSeed(propMeshRandom(PROP_MESH_SEED, kind, variant));
  const mesh = createIslandTreePropMesh(kind, variant, seed, CROWN_BAKE_MESH);
  const lowest = new Float32Array(CROWN_BINS).fill(Infinity);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    const x = mesh.positions[vertex * 3]!;
    const z = mesh.positions[vertex * 3 + 2]!;
    const bin = Math.floor(Math.hypot(x, z) / CROWN_BIN);
    if (bin >= CROWN_BINS) continue;
    lowest[bin] = Math.min(lowest[bin]!, mesh.positions[vertex * 3 + 1]!);
  }
  return lowest;
};
