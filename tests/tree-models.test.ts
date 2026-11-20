import { describe, expect, it } from "vitest";

import { getTreeInstanceScale, getTreeVariant } from "../src/render-common/props/island-trees";
import { createPropMeshes, getMeshId } from "../src/render-common/props/prop-meshes";
import { BARK_UV_LIMIT } from "../src/render-common/trees/bark-uv";
import { createTreeModel } from "../src/render-common/trees/tree-factory";
import { type GrowthStage,TREE_SPECIES } from "../src/render-common/trees/tree-model";
import { PROP } from "../src/shared/world/world-data";

const STAGES: GrowthStage[] = [1, 2, 3, 4, 5];

describe("tree models", () => {
  it("are deterministic per seed and differ between seeds", () => {
    const first = createTreeModel("oak", 4, 9);
    expect(createTreeModel("oak", 4, 9)).toEqual(first);
    expect(createTreeModel("oak", 4, 10).foliage.length).not.toBe(0);
    expect(createTreeModel("oak", 4, 10).wood[1]!.points).not.toEqual(first.wood[1]!.points);
  });

  it("grow structurally with every stage, not by scaling", () => {
    for (const species of TREE_SPECIES) {
      const models = STAGES.map((stage) => createTreeModel(species, stage, 3));
      for (let stage = 1; stage < models.length; stage += 1) {
        expect(models[stage]!.bounds.height).toBeGreaterThan(models[stage - 1]!.bounds.height);
        expect(models[stage]!.bounds.radius).toBeGreaterThan(models[stage - 1]!.bounds.radius);
      }
      expect(models[4]!.wood[0]!.radii[1]).toBeGreaterThan(models[0]!.wood[0]!.radii[1]! * 4);
    }
  });

  it("leave only a stump when chopped and nothing when invisible", () => {
    for (const species of TREE_SPECIES) {
      const stump = createTreeModel(species, "chopped", 5);
      expect(stump.stump).not.toBeNull();
      expect(stump.foliage.length + stump.fronds.length + stump.wood.length).toBe(0);
      expect(stump.bounds.height).toBeLessThan(1);
      const empty = createTreeModel(species, 0, 5);
      expect(empty.foliage.length + empty.fronds.length + empty.wood.length).toBe(0);
    }
  });
});

describe("island trees", () => {
  it("pick the growth stage by age and stay within a light triangle budget", () => {
    const ages = [0.75, 0.95, 1.3].map((scale) => getTreeVariant(PROP.broadleafTree, scale));
    expect(ages).toEqual([0, 1, 2]);
    expect(getTreeInstanceScale(PROP.broadleafTree, 1.3, 2)).toBeLessThanOrEqual(1.12);
    const meshes = createPropMeshes(2024);
    for (const kind of [PROP.broadleafTree, PROP.coniferTree, PROP.palmTree, PROP.birchTree]) {
      const heights = [0, 1, 2].map((variant) => meshes[getMeshId(kind, variant)]!.height);
      expect(heights[2]!).toBeGreaterThan(heights[0]!);
      for (let variant = 0; variant < 3; variant += 1) {
        expect(meshes[getMeshId(kind, variant)]!.indices.length / 3).toBeLessThan(2500);
      }
    }
  });
});

describe("island oaks", () => {
  const meshes = createPropMeshes(2024);
  const oaks = [0, 1, 2].map((variant) => meshes[getMeshId(PROP.broadleafTree, variant)]!);

  it("draw lighter core triangles far out and their branches as LOD detail close up", () => {
    for (const oak of oaks) {
      expect(oak.coreIndexCount).toBeDefined();
      expect(oak.coreIndexCount!).toBeLessThan(oak.indices.length);
      expect(oak.coreIndexCount! / 3).toBeLessThan(1500);
    }
  });

  it("carry bark coordinates on the wood that the untextured paths ignore (u < 0)", () => {
    const barkVertices = oaks[2]!.uvs.filter(
      (value, index) => index % 2 === 0 && value < BARK_UV_LIMIT
    );
    expect(barkVertices.length).toBeGreaterThan(100);
    expect(Math.max(...barkVertices)).toBeLessThan(0);
  });

  it("grow buttress roots, a few heavy primary limbs and sprays in sub-crown clumps", () => {
    const model = createTreeModel("oak", 5, 4);
    const roots = model.wood.filter((limb) => limb.root);
    const primaries = model.wood.filter((limb) => limb.depth === 1 && !limb.root);
    expect(roots.length).toBeGreaterThanOrEqual(4);
    expect(primaries.length).toBeLessThanOrEqual(6);
    const boleRadius = model.wood[0]!.radii[1]!;
    const heaviest = Math.max(...primaries.map((limb) => limb.radii[0]!));
    expect(heaviest).toBeGreaterThan(boleRadius * 0.4);
    const shades = model.foliage.map((spray) => spray.shade);
    expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(0.5);
  });
});
