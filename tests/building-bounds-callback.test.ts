import { expect, it } from "vitest";

import type { BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createDecorativeWeaponRack, withNationDecorativeRacks } from "../src/render-common/buildings/national-decorative-weapons";
import { redesignOccupationRoof } from "../src/render-common/buildings/occupation-roof-redesign";

it("keeps a replacement national rack within its actual source bay without interpreting indices as yaw", () => {
  const parts = createDecorativeWeaponRack("japanese", 2, [1.1, 0, .2], true);
  const recipe = { parts } as BuildingRecipe;
  const original = parts.map(part => getRomanPartBounds(part));
  const changed = withNationDecorativeRacks(recipe, "viking", true).parts.map(part => getRomanPartBounds(part));
  expect(Math.min(...changed.map(bounds => bounds.min[0]))).toBeCloseTo(Math.min(...original.map(bounds => bounds.min[0])), 10);
  expect(Math.max(...changed.map(bounds => bounds.max[0]))).toBeCloseTo(Math.max(...original.map(bounds => bounds.max[0])), 10);
});

it("replaces paired roof sheets using only their authored rotations", () => {
  const parts: BuildingRecipe["parts"] = [-1, 1].map(side => ({ shape: "box", surface: "roof",
    position: [0, 1.5, side * .35], rotation: [side * .3, 0, 0], size: [2.4, .06, 1.4], stage: 3 }));
  const before = parts.map(part => getRomanPartBounds(part));
  const result = redesignOccupationRoof({ parts } as BuildingRecipe, "roman",
    { buildingFunction: "timber", form: "gable", material: "roof", support: "wood" }, true);
  const roof = result.recipe.parts.find(part => part.shape === "occupation-roof")!;
  const bounds = getRomanPartBounds(roof);
  for (const axis of [0, 2] as const) {
    expect(bounds.min[axis]).toBeCloseTo(Math.min(...before.map(box => box.min[axis])), 10);
    expect(bounds.max[axis]).toBeCloseTo(Math.max(...before.map(box => box.max[axis])), 10);
  }
});
