import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createLevelPlanRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { unsupportedParts } from "./helpers/recipe-supports";

it.each([true, false])("keeps all mill tiers' actual entrance, stock bays and operating anchors clear (%s)", detailed => {
  const definition = getBuildingDefinition(31);
  for (const level of [1, 2, 3, 4, 5] as BuildingLevel[]) {
    const recipe = leveledBuildingRecipe(definition, "persian", detailed, level);
    const original = createLevelPlanRecipe(definition, detailed, level).plan;
    for (const key of ["door", "doorDimensions", "workerExit", "workPoint", "mechanism"] as const)
      expect(recipe[key], `${level}/${key}`).toEqual(original[key]);
    expect(recipe.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ).toBeLessThanOrEqual(before.extentZ + .001);
    expect(unsupportedParts(recipe)).toEqual([]);
    const jars = recipe.parts.filter(part => !part.stock && part.shape === "clay-jar");
    expect(jars).toHaveLength(2);
    expect(jars.every(part => Math.abs(part.position[0]) < .8 && part.position[2] === -.25)).toBe(true);
    const rails = recipe.parts.filter(part => part.surface === "wood" && part.size[1] <= .045 &&
      part.position[1] <= .22 && (part.size[0] === 2.36 || part.size[2] === .8));
    expect(rails).toHaveLength(detailed ? 6 : 3);
    for (const part of rails) {
      const bounds = getRomanPartBounds(part);
      expect(bounds.max[2]).toBeLessThan(.18);
      expect(bounds.max[1]).toBeLessThan(.25);
    }
    // Sample the actual doorway-to-exit path, with a worker's full shoulder clearance.
    const path = Array.from({ length: 17 }, (_, index) => [0,
      recipe.door[2] + (recipe.workerExit[2] - recipe.door[2]) * index / 16]);
    path.push([recipe.workPoint[0], recipe.workPoint[2]]);
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5])
      for (const part of [...rails, ...jars]) for (const [x, z] of path) {
        const bounds = getRomanPartBounds(part, yaw);
        const px = x! * Math.cos(yaw) + z! * Math.sin(yaw);
        const pz = -x! * Math.sin(yaw) + z! * Math.cos(yaw);
        const dx = Math.max(bounds.min[0] - px, 0, px - bounds.max[0]);
        const dz = Math.max(bounds.min[2] - pz, 0, pz - bounds.max[2]);
        expect(Math.hypot(dx, dz), `${level}/${yaw}/${x}/${z}`).toBeGreaterThan(.31);
      }
  }
});

it.each([true, false])("keeps mesh caps while colouring existing monumental courses, not the main walls (%s)", detailed => {
  for (const id of [7, 31]) for (const level of [1, 2, 3, 4, 5] as BuildingLevel[]) {
    const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, "persian", detailed, level);
    const materials = createPlainBuildingMaterials();
    const model = createRomanBuilding(definition, materials, detailed, recipe, "persian");
    expect(model.triangles(false), `${id}/${level}`).toBeLessThanOrEqual(
      nationTriangleBudget("persian", id)[detailed ? 0 : 1]);
    model.dispose(); Object.values(materials).forEach(material => material.dispose());
    if (id !== 7) continue;
    expect(recipe.parts.filter(part => part.shape === "persian-dome")
      .every(part => part.surface === "plaster")).toBe(true);
    expect(recipe.parts.some(part => part.shape === "persian-transition" && part.surface === "paint" &&
      part.tint![2] > part.tint![0] * 4)).toBe(true);
    expect(recipe.parts.filter(part => part.shape === "arch-spandrel")
      .every(part => part.surface === "plaster")).toBe(true);
  }
});
