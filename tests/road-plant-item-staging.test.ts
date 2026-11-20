import { expect, it } from "vitest";

import { roadDecorationItemsTagged } from "../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { ROAD_PLANTS } from "../src/render-common/road-plant-catalog";
import { createRoadPlantRecipe, createStandalonePlantRecipe } from "../src/render-common/road-plant-recipes";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { planRoadDecorationPlacement } from "../src/shared/settlement/road-decoration-placement";

it("stages222 legal references to canonical37 species, sold only through a release cohort, without duplicating identical non-tree forms", () => {
  const entries = Object.values(roadDecorationItemsTagged("plant"));
  expect(entries).toHaveLength(222); expect(new Set(entries.map(row => row.plant!.species)).size).toBe(37);
  for (const definition of entries) {
    const asset = definition.plant!, species = ROAD_PLANTS.find(row => row.id === asset.species)!;
    expect(species).toBeDefined();
    const recipe = asset.form === "standalone" ? createStandalonePlantRecipe(species, false, asset.variant)
      : createRoadPlantRecipe(species, false, asset.variant, asset.potted);
    expect(recipe.parts.length).toBeGreaterThan(0); expect(recipe.id).toBe(species.id);
    if (asset.form === "standalone") expect(["tree", "weeping", "palm"]).toContain(species.form);
    if (asset.potted) expect(["bush", "flower", "column", "bonsai", "topiary"]).toContain(species.form);
  }
  expect(entries.find(row => row.plant!.species === "columnar-cypress")?.category).toBe("trees");
  expect(entries.find(row => row.plant!.species === "bonsai-maple")?.category).toBe("plants");
});

it("gives every staged structural form finite shared-LOD solid bounds, bearing support and owned terrain placement", () => {
  const context = { nation: "roman" as const, roads: [], heightAt: () => 2,
    isOwned: () => true, isFree: () => true };
  for (const item of Object.values(roadDecorationItemsTagged("plant"))) {
    if (!item) throw new Error("Missing canonical staged plant definition");
    const definition = getRoadDecoration(item.decoration)!;
    expect(definition.plant?.harvestable).toBe(false);
    const physical = roadDecorationClearance(definition);
    expect(physical.supports.length).toBeGreaterThan(0);
    for (const box of [...physical.volumes, ...physical.supports]) {
      expect([...box.min, ...box.max].every(Number.isFinite)).toBe(true);
      for (const axis of [0, 1, 2]) expect(box.max[axis]!).toBeGreaterThanOrEqual(box.min[axis]!);
    }
    for (const support of physical.supports) {
      expect(support.min[1], item.decoration).toBeLessThanOrEqual(.06);
      expect(support.max[1], item.decoration).toBeGreaterThanOrEqual(0);
    }
    const request = { decoration: item.decoration, position: { x: 10, z: 10 }, yaw: Math.PI / 4 };
    expect(planRoadDecorationPlacement(request, context).ok).toBe(true);
    expect(planRoadDecorationPlacement(request, { ...context, isOwned: () => false }))
      .toEqual({ ok: false, reason: "not-owned" });
  }
});
