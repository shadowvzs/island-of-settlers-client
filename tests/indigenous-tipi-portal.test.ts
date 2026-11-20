import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { createClothPanelGeometry } from "../src/renderers/three/buildings/cloth-panel-geometry";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

describe("sewn sloping council-tent entrance", () => {
  it.each([true, false])("joins thin fabric sides/roof without moving the real door or stock (detailed=%s)", detailed => {
    const definition = getBuildingDefinition(0), original = createRomanBuildingRecipe(definition, detailed);
    const recipe = createNationBuildingRecipe(definition, "indigenous", detailed);
    for (const key of ["door", "mechanism", "workPoint", "workerExit"] as const)
      expect(recipe[key]).toEqual(original[key]);
    expect(recipe.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
    const panels = recipe.parts.filter(part => part.shape === "cloth-panel");
    expect(panels).toHaveLength(3);
    for (const part of panels) {
      const geometry = createClothPanelGeometry(part.clothPanelCorners!, part.size, detailed);
      expect(geometry.index!.count / 3).toBe(detailed ? 32 : 8);
      for (const axis of ["x", "y", "z"] as const) {
        expect(geometry.boundingBox!.min[axis]).toBeGreaterThanOrEqual(-.500001);
        expect(geometry.boundingBox!.max[axis]).toBeLessThanOrEqual(.500001);
      }
      expect(Array.from(geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      geometry.dispose();
    }
    expect(panels.filter(part => part.size[0] < .02)).toHaveLength(2);
    const roof = panels.find(part => part.size[0] > .1)!;
    const topHeights = roof.clothPanelCorners!.map(point => point[1] * roof.size[1] + roof.position[1]);
    expect(Math.max(...topHeights) - Math.min(...topHeights)).toBeGreaterThan(.1);
    const materials = createPlainBuildingMaterials();
    const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
    expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget("indigenous", 0)[detailed ? 0 : 1]);
    model.dispose(); Object.values(materials).forEach(material => material.dispose());
  });
});
