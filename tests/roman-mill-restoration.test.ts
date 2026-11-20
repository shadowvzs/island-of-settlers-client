import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { DEFAULT_ROMAN_DOOR } from "../src/render-common/buildings/roman-door-profile";
import { ROMAN_MILL_HUB_HEIGHT,ROMAN_MILL_ROTOR_RADIUS } from "../src/render-common/buildings/roman-mill-dimensions";
import { WORKER_HEIGHT } from "../src/render-common/workers/worker-dimensions";

it.each([true, false])("preserves the reduced tapered mill body, roof and axle at detail %s", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(31), detailed);
  const masonry = recipe.parts.filter(part => part.surface === "stone" && part.stage === 1);
  const lowerRear = masonry.find(part => Math.abs(part.size[0] - 1.16 * .9) < 1e-8 && part.size[1] === 1.18);
  expect(lowerRear).toBeDefined();
  expect(masonry.some(part => part.size[1] === 1.18 && Math.abs(part.size[2] - .85 * .9) < 1e-8)).toBe(true);
  expect(Math.max(...masonry.map(part => part.position[1] + part.size[1] / 2))).toBeCloseTo(2.86 * .8);
  const upper = masonry.filter(part => part.topScale);
  expect(upper).toHaveLength(4);
  expect(upper.some(part => part.topScale![0] === 0.64)).toBe(true);
  expect(upper.some(part => part.topScale![2] === 0.66)).toBe(true);
  expect(recipe.mechanism).toEqual([0, ROMAN_MILL_HUB_HEIGHT - .18, .85 * .9 * .66 / 2 + .22]);
  expect(recipe.doorDimensions).toEqual(DEFAULT_ROMAN_DOOR);
  const roof = recipe.parts.find(part => part.shape === "gable" && part.surface === "stone");
  expect(roof).toBeDefined();
  expect(roof!.position[1] - roof!.size[1] / 2).toBeCloseTo(2.86 * .8 + .27 - .18);
});

it("fits the reduced mill uniformly around unchanged workers and its rotating sail envelope", () => {
  const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(31));
  expect(sizing.scale).toBeCloseTo((WORKER_HEIGHT + 0.0575) / DEFAULT_ROMAN_DOOR.spring);
  expect(sizing.cells).toEqual([5, 4]);
  expect(sizing.overhead).toBeDefined();
  expect(sizing.recipe.mechanism[1] * sizing.scale - ROMAN_MILL_ROTOR_RADIUS * sizing.scale).toBeGreaterThan(WORKER_HEIGHT);
});

it("lowers the maximum mill silhouette twenty percent while retaining shoulder cargo clearance",()=>{
 const sizing=getRomanBuildingWorldSizing(getBuildingDefinition(31));
 const top=sizing.recipe.mechanism[1]+ROMAN_MILL_ROTOR_RADIUS;
 expect(top/(3.15+2.01-.18)).toBeCloseTo(.8,8);
 expect((sizing.recipe.mechanism[1]-ROMAN_MILL_ROTOR_RADIUS)*sizing.scale).toBeCloseTo(1.70,8);
});
