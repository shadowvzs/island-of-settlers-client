import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { getOccupationRoofHeight } from "../src/render-common/buildings/occupation-roof-height";
import { createRomanOccupationRoof } from "../src/renderers/three/buildings/roman-occupation-roof";

it.each(["roof", "roof-slate"] as const)("gives Chinese %s roofs raised ceramic rolls on High", surface => {
  const part: BuildingPart = { occupationRoof: "gable", position: [0, 0, 0], roofSweep: .24,
    shape: "occupation-roof", size: [1, 1, 1], stage: 3, surface };
  for (const detailed of [true, false]) {
    const geometry = createRomanOccupationRoof(part, detailed);
    const vertices = geometry.getAttribute("position");
    let raised = 0;
    for (let index = 0; index < vertices.count; index++) {
      const x = vertices.getX(index), z = vertices.getZ(index);
      const lift = vertices.getY(index) - getOccupationRoofHeight("gable", x, z, part.roofSweep);
      if (lift > .05) raised++;
    }
    expect(raised > 100).toBe(detailed);
    geometry.dispose();
  }
});

it("retains one complete annex roof when Chinese and Maya main halls rise on upgrades", () => {
  for (const nation of ["chinese", "maya"] as const) for (const id of [6, 24])
    for (const detailed of [true, false]) {
      const definition = getBuildingDefinition(id);
      const count = (level: 1 | 3 | 4 | 5) => createNationBuildingRecipe(definition, nation, detailed, level)
        .parts.filter(part => part.shape === "occupation-roof").length;
      const baseline = count(1);
      for (const level of [3, 4, 5] as const) expect(count(level), `${nation}/${id}/${level}`).toBe(baseline);
    }
});
