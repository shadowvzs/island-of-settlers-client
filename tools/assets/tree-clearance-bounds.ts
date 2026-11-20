import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createIslandTreePropMesh, getTreeVariants, TREE_KINDS } from "../../src/render-common/props/island-trees";
import { PROP_MESH_SEED } from "../../src/render-common/props/prop-mesh-seed";
import { createRandom } from "../../src/shared/world/rng";
import { installHardwoodMeshPayloadFromDisk } from "./hardwood-mesh-payload-file";

installHardwoodMeshPayloadFromDisk();

// Bake only collision metadata from the exact native variants, never image or model assets.
const rows: Record<number, number[][]> = {};
// Scaling by 1e6 can lose the last bit (1.7550000000000001 -> 1.755); step once more when it does.
const roundUp = (value: number) => {
  const micro = Math.ceil(value * 1_000_000);
  return micro / 1_000_000 >= value ? micro / 1_000_000 : (micro + 1) / 1_000_000;
};
for (const kind of TREE_KINDS) {
  rows[kind] = getTreeVariants(kind).map((_, variant) => {
    const seed = Math.floor(createRandom(PROP_MESH_SEED + kind * 977 + variant * 131)() * 1_000_000);
    const mesh = createIslandTreePropMesh(kind, variant, seed);
    let sway = 0, flutter = 0;
    for (let vertex = 0; vertex < mesh.wind.length; vertex += 2) {
      sway = Math.max(sway, mesh.wind[vertex]!);
      flutter = Math.max(flutter, mesh.wind[vertex + 1]!);
    }
    return [mesh.height, mesh.radius, sway, flutter].map(roundUp);
  });
}
const header = "/** Native variant bounds: [height, radius, maxSway, maxFlutter], rounded upwards.\n" +
  " * Regenerate with: npx tsx tools/assets/tree-clearance-bounds.ts\n" +
  " * Checked against both renderer variants and storm wind by tree-clearance-bounds.test.ts. */\n";
const content = header + "export const NATIVE_TREE_CLEARANCE_BOUNDS: Readonly<Record<number, readonly (readonly number[])[]>> = " +
  JSON.stringify(rows, null, 2) + ";\n";
writeFileSync(resolve(import.meta.dirname, "../../src/render-common/trees/tree-clearance-bounds.ts"), content);
