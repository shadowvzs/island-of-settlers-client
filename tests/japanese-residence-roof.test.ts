import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { japaneseSoffitHeight } from "../src/render-common/buildings/nation-roof-profile";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

const definition = getBuildingDefinition(57);
const levels: readonly BuildingLevel[] = [1, 2, 3, 4, 5];

describe("Japanese small residence coherent kawara roof", () => {
  it.each([true, false])("seats the tiled main roof on the existing walls at every level (detailed=%s)", detailed => {
    for (const level of levels) {
      const base = createNationBuildingRecipe(definition, "japanese", detailed, level);
      const recipe = leveledBuildingRecipe(definition, "japanese", detailed, level);
      expect(recipe.parts.some(part => part.surface === "roof-thatch"), `level ${level}`).toBe(false);
      const roofs = base.parts.filter(part => part.shape === "nation-roof" &&
        part.roofProfile === "japanese" && !part.roofLayer);
      expect(roofs).toHaveLength(1);
      const roof = roofs[0]!;
      const soffit = base.parts.find(part => part.roofLayer === "soffit");
      expect(soffit).toBeDefined();
      const walls = base.parts.filter(part => part.shape === "box" && part.surface === "plaster" &&
        part.stage === 1 && part.size[1] > .6);
      const wallTop = Math.max(...walls.map(part => part.position[1] + part.size[1] / 2));
      expect(soffit!.position[1] + soffit!.size[1] * japaneseSoffitHeight("japanese", 0, 0))
        .toBeCloseTo(wallTop, 10);
      expect(roof.surface).toBe("roof");
      expect(roof.tint).toEqual([1, 1, 1]);
      expect(recipe.door).toEqual(base.door);
      expect(recipe.workPoint).toEqual(base.workPoint);
      expect(recipe.workerExit).toEqual(base.workerExit);
    }
  });

  it("retains national roof geometry on all three residence sizes", () => {
    for (const type of [57, 58, 59]) for (const detailed of [true, false]) {
      const recipe = createNationBuildingRecipe(getBuildingDefinition(type), "japanese", detailed);
      expect(recipe.parts.some(part => part.shape === "nation-roof" && part.roofProfile === "japanese" &&
        part.surface === "roof" && !part.roofLayer)).toBe(true);
    }
  });

  it("keeps the actual model inside existing High and Minimal caps at every level", () => {
    stubPaintCanvas();
    const materials = createPlainBuildingMaterials();
    try {
      for (const level of levels) for (const detailed of [true, false]) {
        const model = createNationBuilding(definition, materials, "japanese", detailed, level);
        try {
          expect(model.triangles(false), `${level}/${detailed}`)
            .toBeLessThanOrEqual(nationTriangleBudget("japanese", definition.id)[detailed ? 0 : 1]);
        } finally { model.dispose(); }
      }
    } finally { Object.values(materials).forEach(material => material.dispose()); }
  });
});
