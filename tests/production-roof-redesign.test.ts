import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const nations: WorkerNation[] = ["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"];
it.each([true, false])("preserves owner-scoped national roofs, removes base monitors and keeps existing caps (%s)", detailed => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const nation of nations) for (const id of [4, 9, 8, 17, 18, 20, 22, 32, 33, 41, 42, 57, 61] as const) {
      const definition = getBuildingDefinition(id);
      const base = leveledBuildingRecipe(definition, nation, detailed, 1);
      if (nation === "roman" && [17, 20].includes(id))
        expect(base.parts.some(part => part.shape === "occupation-roof" && part.surface === "planks"),
          `${nation}/${id} approved timber cover`).toBe(true);
      if (nation === "persian" && id === 20)
        expect(base.parts.some(part => part.shape === "dome"), "restored Persian dome").toBe(true);
      if (nation === "chinese" && id === 20)
        expect(base.parts.some(part => part.shape === "occupation-roof" && part.roofCurve === .62),
          "restored national Chinese cover").toBe(true);
      if (nation === "japanese" && id === 20)
        expect(base.parts.some(part => part.shape === "architectural-bamboo" && part.bambooSection === "split"),
          "explicitly approved Japanese20 bamboo cover").toBe(true);
      expect(base.parts.filter(part => part.stage === 4 && part.surface === "dark" &&
        part.size[1] > .2 && part.size[0] > .4 && part.size[2] > .2), `${nation}/${id} no loft backing`).toEqual([]);
      for (const level of [1, 4, 5] as const) {
        const model = createRomanBuilding(definition, materials, detailed,
          leveledBuildingRecipe(definition, nation, detailed, level), nation);
        try { expect.soft(model.triangles(false), `${nation}/${id}/${level}/${detailed}`)
          .toBeLessThanOrEqual(nationTriangleBudget(nation, id)[detailed ? 0 : 1]); }
        finally { model.dispose(); }
      }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
}, 20000);
