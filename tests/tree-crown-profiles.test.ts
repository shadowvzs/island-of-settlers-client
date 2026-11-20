import { expect, it } from "vitest";

import { getTreeVariants, TREE_KINDS } from "../src/render-common/props/island-trees";
import { NATIVE_TREE_CROWN_PROFILES } from "../src/render-common/trees/tree-crown-profiles";
import { getCrownProfile } from "../src/render-common/wildlife/nav/crown-profile";
import { measureCrownProfile } from "../src/render-common/wildlife/nav/crown-profile-measure";

it("bakes exactly the crown profile of every current native tree variant", () => {
  expect(Object.keys(NATIVE_TREE_CROWN_PROFILES).map(Number)).toEqual(TREE_KINDS);
  for (const kind of TREE_KINDS) {
    expect(NATIVE_TREE_CROWN_PROFILES[kind]).toHaveLength(getTreeVariants(kind).length);
    // One comparison per variant: per-bin expect calls would dominate the run.
    for (const [variant] of getTreeVariants(kind).entries())
      expect(getCrownProfile(kind, variant)).toEqual(measureCrownProfile(kind, variant));
  }
});
