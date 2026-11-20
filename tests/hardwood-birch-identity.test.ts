import { describe, expect, it } from "vitest";

import {
  createIslandTreeStageMesh, getIslandStumpLook, getTreeVariants
} from "../src/render-common/props/island-trees";
import { createHardwoodIslandMesh } from "../src/render-common/trees/hardwood-island-mesh";
import { NATIVE_TREE_CLEARANCE_BOUNDS } from "../src/render-common/trees/tree-clearance-bounds";
import {
  BIRCH, HARDWOOD, HARDWOOD_SOURCE, hardwoodBirchForm
} from "../src/shared/world/tree-forms";
import { PROP } from "../src/shared/world/world-data";

describe("birch appearances retain hardwood resource and saved model identity", () => {
  it("preserves all original source IDs and appends five native birch forms", () => {
    expect(Object.values(HARDWOOD_SOURCE)).toEqual([0, 1, 2, 3]);
    expect(Object.values(HARDWOOD)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getTreeVariants(PROP.hardwoodTree).slice(0, 12)).toEqual(
      getTreeVariants(PROP.mahoganyTree));
    expect(getTreeVariants(PROP.hardwoodTree)).toHaveLength(27);
    expect(getTreeVariants(PROP.mahoganyTree)).toHaveLength(12);
    expect(getTreeVariants(PROP.walnutTree)).toHaveLength(12);
    for (const form of Object.values(HARDWOOD_SOURCE)) expect(hardwoodBirchForm(form)).toBeUndefined();
    expect(Object.values(BIRCH).map(form => hardwoodBirchForm(form + 4))).toEqual(Object.values(BIRCH));
  });
  it.each(Object.values(BIRCH))("reuses the exact native birch model and stump for hardwood form %i", form => {
    const hardwoodForm = form + 4;
    for (const stage of [1, 3, 5] as const) {
      const mesh = createIslandTreeStageMesh(PROP.hardwoodTree, stage, hardwoodForm, 71);
      const native = createIslandTreeStageMesh(PROP.birchTree, stage, form, 71);
      expect(mesh).toEqual(native);
    }
    expect(getIslandStumpLook(PROP.hardwoodTree, hardwoodForm))
      .toEqual(getIslandStumpLook(PROP.birchTree, form));
    expect(PROP.hardwoodTree).not.toBe(PROP.birchTree);
  });
  // Builds every hardwood form's full mesh (~1.7 s alone); allow headroom under full-suite load.
  it("keeps original source meshes untouched and provides native collision bounds for every appended variant", () => {
    for (const form of Object.values(HARDWOOD_SOURCE))
      expect(createIslandTreeStageMesh(PROP.hardwoodTree, 5, form, 71))
        .toEqual(createHardwoodIslandMesh(form, 5));
    expect(NATIVE_TREE_CLEARANCE_BOUNDS[PROP.hardwoodTree]).toHaveLength(27);
    expect(NATIVE_TREE_CLEARANCE_BOUNDS[PROP.mahoganyTree]).toHaveLength(12);
    for (const bounds of NATIVE_TREE_CLEARANCE_BOUNDS[PROP.hardwoodTree]!) {
      expect(bounds.every(Number.isFinite)).toBe(true);
      expect(bounds[0]).toBeGreaterThan(0); expect(bounds[1]).toBeGreaterThan(0);
    }
  }, 15_000);
});
