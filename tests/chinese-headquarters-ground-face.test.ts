import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { checkTriangleBudget } from "../tools/bench/triangle-budget";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("omits only the Chinese HQ Minimal floor's ground-contact underside and preserves High floor geometry exactly", () => {
  const definition = getBuildingDefinition(0), materials = createPlainBuildingMaterials();
  try {for (const level of [1, 2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(definition, "chinese", false, level);
    const floors = recipe.parts.filter(part => part.omitGroundBottom);
    expect(floors).toHaveLength(1);
    const floor = floors[0]!;
    expect(floor.position[1] - floor.size[1] / 2).toBeCloseTo(0, 8);
    expect(floor.stage).toBe(0);
    expect(floor.rotation).toBeUndefined();
    for (const detailed of [true, false]) {
      const current = createRomanPartGeometry(floor, detailed);
      const original = createRomanPartGeometry({ ...floor, omitGroundBottom: undefined }, detailed);
      try {
        expect(current.getAttribute("position").array).toEqual(original.getAttribute("position").array);
        expect(current.getAttribute("normal").array).toEqual(original.getAttribute("normal").array);
        expect(current.getAttribute("uv").array).toEqual(original.getAttribute("uv").array);
        expect(original.index!.count - current.index!.count).toBe(detailed ? 0 : 6);
        if (detailed) expect(current.index!.array).toEqual(original.index!.array);
        const normal = current.getAttribute("normal");
        if (!detailed) for (let at = 0; at < current.index!.count; at++)
          expect(normal.getY(current.index!.getX(at))).toBeGreaterThan(-.999);
      } finally { current.dispose(); original.dispose(); }
    }
    const model = createRomanBuilding(definition, materials, false, recipe, "chinese");
    try {
      const triangles = model.triangles(false), budget = nationTriangleBudget("chinese", 0)[1];
      if (level === 1) expect(triangles).toBeLessThanOrEqual(budget);
      else expect(checkTriangleBudget(triangles, budget), `HQ Minimal level${level}`).not.toBe("fail");
    }
    finally {model.dispose();}
    expect(leveledBuildingRecipe(definition, "chinese", true, level).parts.some(part => part.omitGroundBottom))
      .toBe(false);
  }} finally {Object.values(materials).forEach(material => material.dispose());}
});
