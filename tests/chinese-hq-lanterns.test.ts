import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { createChineseLanternMesh } from "../src/render-common/props/chinese-lantern";
import { CHINESE_LANTERN_CHARACTERS } from "../src/render-common/props/chinese-lantern-glyphs";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

describe("Chinese headquarters lanterns", () => {
  it.each([true, false])("has six distinct inscriptions and fits the actual model budget (detailed=%s)", detailed => {
    const definition = getBuildingDefinition(0), recipe = createNationBuildingRecipe(definition, "chinese", detailed);
    const lanterns = recipe.parts.filter(part => part.shape === "chinese-lantern");
    expect(lanterns).toHaveLength(6);
    expect(new Set(lanterns.map(part => CHINESE_LANTERN_CHARACTERS[part.decorVariant!])).size).toBe(6);
    expect(lanterns.filter(part => part.position[1] > 2)).toHaveLength(4);
    expect(lanterns.filter(part => part.position[1] < 2 && part.position[2] > 0)).toHaveLength(2);
    const materials = createPlainBuildingMaterials();
    const model = createRomanBuilding(definition, materials, detailed, recipe, "chinese");
    const triangles = model.triangles(false), budget = nationTriangleBudget("chinese", 0)[detailed ? 0 : 1];
    model.dispose();
    Object.values(materials).forEach(material => material.dispose());
    expect(triangles, `${triangles} / ${budget}`).toBeLessThanOrEqual(budget);
  });

  it("keeps the independent mesh rooted and its suspension exactly one unit up", () => {
    const mesh = createChineseLanternMesh(true, 0);
    expect(mesh.height).toBeCloseTo(1, 2);
    expect(Math.min(...mesh.positions.filter((_value, index) => index % 3 === 1))).toBeGreaterThanOrEqual(0);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
  });
});
