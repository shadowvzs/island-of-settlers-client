import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getAuthoredBuildingPlot } from "../src/render-common/buildings/building-plot-profile";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import {
  applyRoofReviewPrototype, ROOF_REVIEW_EXCLUDED_TYPES, ROOF_REVIEW_FUNCTIONS, ROOF_REVIEW_VOCABULARY,
  roofReviewSelection
} from "../src/render-common/buildings/roof-review-prototype";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";

const nations: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese",
  "maya", "persian", "chinese", "indigenous"];
const candidates = [8, 17, 18, 20, 22, 33, 61, 32];

describe("national roof form/material families", () => {
  it("covers every nation and function with a finite national vocabulary", () => {
    expect(Object.keys(ROOF_REVIEW_FUNCTIONS).sort()).toEqual([...nations].sort());
    for (const nation of nations) {
      const vocabulary = ROOF_REVIEW_VOCABULARY[nation];
      expect(Object.keys(ROOF_REVIEW_FUNCTIONS[nation]).sort()).toEqual([
        "bakery", "civic", "farm", "hall", "nursery", "storage", "textile", "timber", "tower", "woodland"
      ]);
      for (const family of Object.values(ROOF_REVIEW_FUNCTIONS[nation]))
        expect(Object.keys(vocabulary)).toContain(family);
    }
    expect(Object.keys(ROOF_REVIEW_VOCABULARY.maya)).toEqual([
      "existing-thatch-hip", "existing-stone-flat", "vented-thatch-half-hip"
    ]);
  });

  it("preserves originals, physical anchors and national function families in both LODs and all levels", () => {
    for (const nation of nations) for (const id of candidates) {
      const selection = roofReviewSelection(id, nation)!;
      const plot = getAuthoredBuildingPlot(id)!;
      for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
        const original = leveledBuildingRecipe(getBuildingDefinition(id), nation, detailed, level);
        const saved = JSON.stringify(original);
        const result = applyRoofReviewPrototype(original, id, nation, detailed);
        expect(JSON.stringify(original)).toBe(saved);
        expect(result.recipe.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
        expect({ ...result.recipe, parts: [] }).toEqual({ ...original, parts: [] });
        expect(result.selection).toEqual(selection);
        if (selection.form === "flat" || result.recipe === original)
          expect(result.supports, `${nation}/${id}/${detailed}/${level}`).toHaveLength(0);
        else expect(result.supports.length).toBeGreaterThan(0);
        const originals = new Set(original.parts);
        for (const part of result.recipe.parts.filter(part => !originals.has(part))) {
          expect(part.stock).toBeUndefined();
          expect(part.architecture).toBe(true);
          expect(part.size.every(value => value > 0)).toBe(true);
          const bounds = getRomanPartBounds(part);
          expect([...bounds.max, ...bounds.min].every(Number.isFinite)).toBe(true);
          for (const axis of [0, 2] as const) {
            const half = plot.reservedCells[axis === 0 ? 0 : 1] / 2;
            expect(bounds.min[axis] * plot.structureScale).toBeGreaterThanOrEqual(-half);
            expect(bounds.max[axis] * plot.structureScale).toBeLessThanOrEqual(half);
          }
        }
        // Complete replacement rafters support the weather cover; this is not an appended cowl.
        for (const { bottom, top } of result.supports) expect(top[1]).toBeGreaterThan(bottom[1]);
        expect(applyRoofReviewPrototype(original, id, nation, detailed)).toEqual(result);
      }
    }
  });

  it("keeps all other buildings byte-identical, including mill, Tannery and excluded art", () => {
    for (const nation of nations) for (const definition of BUILDING_CATALOG) {
      if (candidates.includes(definition.id)) continue;
      const recipe = leveledBuildingRecipe(definition, nation, false, 1);
      expect(applyRoofReviewPrototype(recipe, definition.id, nation, false).recipe).toBe(recipe);
      expect(roofReviewSelection(definition.id, nation)).toBeUndefined();
    }
    for (const id of ROOF_REVIEW_EXCLUDED_TYPES) expect(roofReviewSelection(id, "roman")).toBeUndefined();
  });
});
