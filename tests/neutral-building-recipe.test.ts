import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNeutralBuildingRecipe, NEUTRAL_BUILDING_IDS } from "../src/render-common/buildings/neutral-building-recipe";
import { neutralBuildingTriangleLimit } from "./helpers/neutral-building-budgets";

it.each(NEUTRAL_BUILDING_IDS)("keeps enemy type %i operational contracts and original footprint in both LODs", id => {
  const definition = getBuildingDefinition(id);
  for (const detailed of [true, false]) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createNeutralBuildingRecipe(definition, detailed);
    const { parts: beforeParts, ...beforeAnchors } = original;
    const { hideFlag, parts, ...anchors } = recipe;
    expect(hideFlag).toBe(true);
    expect(anchors).toEqual(beforeAnchors);
    expect(parts.filter(part => part.stock)).toEqual(beforeParts.filter(part => part.stock));
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX).toBeLessThanOrEqual(before.extentX + 1e-5);
    expect(after.extentZ).toBeLessThanOrEqual(before.extentZ + 1e-5);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
    expect(parts).not.toEqual(beforeParts);
    const center = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
    const front = recipe.door[2] - .016;
    const blocked = parts.filter(part => {
      if (part.shape === "stone-arc") return false;
      const { max, min } = getRomanPartBounds(part);
      return min[0] < center + .31 && max[0] > center - .31 && min[1] < .82 && max[1] > .025 &&
        min[2] < front + .95 && max[2] > front + .19;
    });
    expect(blocked).toEqual([]);
  }
});

it("keeps the actual neutral meshes within their High and Minimal triangle budgets", async () => {
  const { MeshStandardMaterial } = await import("three");
  const { createNeutralBuilding } = await import("../src/renderers/three/buildings/neutral-building");
  const material = new MeshStandardMaterial();
  const materials = new Proxy({}, { get: () => material }) as
    Record<import("../src/render-common/buildings/building-recipe").BuildingSurface, typeof material>;
  try {
    for (const detailed of [true, false]) for (const id of NEUTRAL_BUILDING_IDS) {
      const model = createNeutralBuilding(getBuildingDefinition(id), materials, detailed);
      model.update(0, { construction: 1, door: 1, working: false });
      const triangles = model.triangles(false);
      expect(triangles, `${id}/${detailed}`).toBeLessThanOrEqual(neutralBuildingTriangleLimit(id, detailed));
      model.dispose();
    }
  } finally { material.dispose(); }
});
