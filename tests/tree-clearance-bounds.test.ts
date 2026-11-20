import { expect, it } from "vitest";

import { createIslandTreePropMesh, getTreeVariants, TREE_KINDS }
  from "../src/render-common/props/island-trees";
import { PROP_MESH_SEED } from "../src/render-common/props/prop-mesh-seed";
import { NATIVE_TREE_CLEARANCE_BOUNDS } from "../src/render-common/trees/tree-clearance-bounds";
import { createRandom } from "../src/shared/world/rng";

it("keeps baked placement bounds large enough for every current native tree and wind weight", () => {
  for (const kind of TREE_KINDS) for (const [variant] of getTreeVariants(kind).entries()) {
    const seed = Math.floor(createRandom(PROP_MESH_SEED + kind * 977 + variant * 131)() * 1_000_000);
    const mesh = createIslandTreePropMesh(kind, variant, seed);
    const bounds = NATIVE_TREE_CLEARANCE_BOUNDS[kind]![variant]!;
    expect(bounds[0]).toBeGreaterThanOrEqual(mesh.height);
    expect(bounds[1]).toBeGreaterThanOrEqual(mesh.radius);
    expect(bounds[0]! - mesh.height).toBeLessThan(.000002);
    expect(bounds[1]! - mesh.radius).toBeLessThan(.000002);
    // One assertion per bound: per-vertex expect calls dominated the run (hardwood meshes are dense).
    let sway = 0, flutter = 0;
    for (let vertex = 0; vertex < mesh.wind.length; vertex += 2) {
      sway = Math.max(sway, mesh.wind[vertex]!);
      flutter = Math.max(flutter, mesh.wind[vertex + 1]!);
    }
    expect(bounds[2]).toBeGreaterThanOrEqual(sway);
    expect(bounds[3]).toBeGreaterThanOrEqual(flutter);
  }
});
