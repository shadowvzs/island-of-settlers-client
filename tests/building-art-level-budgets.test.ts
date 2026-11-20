import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("keeps the revised plant roofs and side canopies within their upgrade budgets (%s)", detailed => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const nation of ["maya", "persian"] as const) for (const id of [3, 5, 6, 17, 29, 58, 61])
      for (const level of [3, 5] as const) {
        const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, nation, detailed, level);
        const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
        try {
          expect(model.triangles(false), `${nation}/${id}/${level}/${detailed}`)
            .toBeLessThanOrEqual(nationTriangleBudget(nation, id)[detailed ? 0 : 1]);
        } finally { model.dispose(); }
      }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
