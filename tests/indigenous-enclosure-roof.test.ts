import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getBuildingNavigationProfile } from "../src/render-common/buildings/building-navigation-profile";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

describe("complete Indigenous workshop lodges", () => {
  it.each([32, 61])("retains the bakery/weaver %i enclosure instead of replacing it with a ground-level roof", id => {
    for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "indigenous", detailed, level);
      const skin = recipe.parts.find(part => part.shape === "indigenous-roof" && part.indigenousEntrance);
      expect(skin, `${id}/${detailed}/${level}: complete enclosed skin`).toBeDefined();
      const bounds = getRomanPartBounds(skin!);
      expect(bounds.min[1]).toBeCloseTo(0);
      expect(bounds.max[1]).toBeGreaterThan(1.1);
      expect(skin!.indigenousRoof).toBe("earth");
      expect(getBuildingNavigationProfile(id, "indigenous", level).interiors.length).toBeGreaterThan(0);
      stubPaintCanvas();
      const materials = createPlainBuildingMaterials();
      const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed, recipe, "indigenous");
      try {
        expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget("indigenous", id)[detailed ? 0 : 1]);
      } finally { model.dispose(); Object.values(materials).forEach(material => material.dispose()); }
    }
  });
});
