import { beforeEach, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

beforeEach(stubPaintCanvas);

it.each([["chinese", true], ["chinese", false], ["maya", true], ["maya", false],
  ["persian", true], ["persian", false]] as const)(
  "keeps the revised %s roster within its mesh caps (High=%s)", (nation, detailed) => {
  const materials = createPlainBuildingMaterials();
  const overBudget: unknown[] = [];
  try {
    for (const definition of BUILDING_CATALOG) {
      const recipe = leveledBuildingRecipe(definition, nation, detailed, 1);
      const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
      try {
        const count = model.triangles(false), cap = nationTriangleBudget(nation, definition.id)[detailed ? 0 : 1];
        if (count > cap) {
          const byShape: Record<string, number> = {};
          for (const part of recipe.parts) {
            const geometry = createRomanPartGeometry(part, detailed);
            byShape[part.shape] = (byShape[part.shape] ?? 0) + (geometry.index?.count ??
              geometry.getAttribute("position").count) / 3;
            geometry.dispose();
          }
          console.info(definition.id, definition.name, byShape);
          overBudget.push({ id: definition.id, count, cap });
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
  expect(overBudget).toEqual([]);
});
