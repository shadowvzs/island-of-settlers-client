import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createIndigenousFloorHideMaterial } from "../src/renderers/three/buildings/indigenous-floor-hide-material";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("measures genuine before/after triangle counts for every rug-affected building at all five levels and both LODs", () => {
  const materials = createPlainBuildingMaterials();
  const high = createIndigenousFloorHideMaterial(true), minimal = createIndigenousFloorHideMaterial(false);
  const rows: { id: number; level: number; detailed: boolean; baseline: number; current: number;
    delta: number; budget: number; hides: number }[] = [];
  const affected = new Set<number>();
  try {
    for (const definition of BUILDING_CATALOG) for (const detailed of [true, false])
      for (const level of [1, 2, 3, 4, 5] as const) {
        const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
        const hides = recipe.parts.filter(part => part.shape === "indigenous-floor-hide").length;
        if (!hides) continue;
        affected.add(definition.id);
        const before = createRomanBuilding(definition, materials, detailed, { ...recipe,
          parts: recipe.parts.filter(part => part.shape !== "indigenous-floor-hide") }, "indigenous");
        const after = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
        try {
          const baseline = before.triangles(false), current = after.triangles(false);
          const budget = nationTriangleBudget("indigenous", definition.id)[detailed ? 0 : 1];
          rows.push({ id: definition.id, level, detailed, baseline, current,
            delta: current - baseline, budget, hides });
          expect.soft(current, `${definition.id}/${level}/${detailed} ${baseline}→${current}/${budget}`)
            .toBeLessThanOrEqual(budget);
        } finally {before.dispose(); after.dispose();}
      }
    expect(affected.size).toBe(52);
    expect(rows).toHaveLength(520);
    const reportPath = process.env.FLOOR_HIDE_AUDIT_REPORT;
    if (reportPath) writeFileSync(resolve(reportPath), JSON.stringify({ affected: [...affected], rows,
      violations: rows.filter(row => row.current > row.budget) }, null, 2));
  } finally {
    high.dispose(); minimal.dispose(); Object.values(materials).forEach(material => material.dispose());
  }
}, 60000);
