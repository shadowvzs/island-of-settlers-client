import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTreeVariants, TREE_KINDS } from "../../src/render-common/props/island-trees";
import { measureCrownProfile } from "../../src/render-common/wildlife/nav/crown-profile-measure";
import { installHardwoodMeshPayloadFromDisk } from "./hardwood-mesh-payload-file";

installHardwoodMeshPayloadFromDisk();

// Bake only the animals' crown clearance rings from the native variants, never model assets.
// Nine significant digits restore every float32 exactly; null marks an empty ring (Infinity).
const exactFloat32 = (lowest: number) => Number.isFinite(lowest) ? Number(lowest.toPrecision(9)) : null;
const lines = TREE_KINDS.map((kind) => {
  const variants = getTreeVariants(kind).map((_, variant) =>
    `    ${JSON.stringify(Array.from(measureCrownProfile(kind, variant), exactFloat32))}`);
  return `  "${kind}": [\n${variants.join(",\n")}\n  ]`;
});
const header = "/** Native variant crown profiles: lowest mesh height per 0.1-unit ring around the trunk\n" +
  " * (crown-profile.ts), exact float32 values, null where a ring is empty.\n" +
  " * Regenerate with: npx tsx tools/assets/tree-crown-profiles.ts\n" +
  " * Checked against freshly measured meshes by tree-crown-profiles.test.ts. */\n";
const content = header +
  "export const NATIVE_TREE_CROWN_PROFILES: Readonly<Record<number, readonly (readonly (number | null)[])[]>> = {\n" +
  lines.join(",\n") + "\n};\n";
writeFileSync(resolve(import.meta.dirname, "../../src/render-common/trees/tree-crown-profiles.ts"), content);
