import { beforeEach, describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { BUILDING_LEVELS } from "../src/render-common/buildings/levels/building-level";
import { WORKER_NATIONS } from "../src/render-common/workers/worker-appearance";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";
import { checkTriangleBudget } from "../tools/bench/triangle-budget";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

const materials = createPlainBuildingMaterials();
const VARIANTS = WORKER_NATIONS.flatMap(nation => BUILDING_LEVELS.map(level => ({ level, nation })));

/** The asset export's budget audit for every level: up to 15 % over warns, beyond fails. */
describe("building triangle budgets at levels 1-5", () => {
  beforeEach(stubPaintCanvas);
  it.each(VARIANTS)("$nation level $level stays within the tolerance on High and Minimal", ({ level, nation }) => {
    const failures: string[] = [], warnings: string[] = [];
    for (const definition of BUILDING_CATALOG) for (const [index, detailed] of [true, false].entries()) {
      const model = createNationBuilding(definition, materials, nation, detailed, level);
      const triangles = model.triangles(false), budget = nationTriangleBudget(nation, definition.id)[index]!;
      model.dispose();
      const result = checkTriangleBudget(triangles, budget);
      const label = `${definition.id}/${detailed ? "high" : "minimal"}: ${triangles}/${budget}`;
      if (result === "fail") failures.push(label);
      if (result === "warn") warnings.push(label);
    }
    if (warnings.length) console.warn(`${nation} level ${level} budget warnings: ${warnings.join(", ")}`);
    expect(failures, failures.join(", ")).toEqual([]);
  }, 30_000);
});
