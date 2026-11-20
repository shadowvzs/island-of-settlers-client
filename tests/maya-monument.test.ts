import { expect, it } from "vitest";

import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { mayaMonumentRecipe } from "../src/render-common/buildings/maya-monument";
import { monumentRecipe } from "../src/render-common/buildings/monument-definition";

it.each([true, false])("builds a compact backed square sanctuary with a clear portal (%s)", detailed => {
  const recipe = mayaMonumentRecipe(detailed), original = monumentRecipe();
  expect(recipe.parts.filter(part => part.surface === "dark")).toHaveLength(1);
  const { parts: _parts, ...anchors } = recipe;
  const { parts: _originalParts, ...originalAnchors } = original;
  expect(anchors).toEqual(originalAnchors);
  const summit = recipe.parts.filter(part => getRomanPartBounds(part).min[1] >= 4.15 - .00001);
  expect(summit.every(part => part.shape !== "occupation-roof")).toBe(true);
  const roof = summit.filter(part => part.size[0] > 2.5 && part.size[1] <= .16);
  expect(roof).toHaveLength(3);
  expect(Math.max(...summit.map(part => getRomanPartBounds(part).max[1]))).toBeCloseTo(5.71);
  // A horizontal ray through the portal must first enter the real recess and stop at its back.
  const centreline = summit.filter(part => {
    const { max, min } = getRomanPartBounds(part);
    return min[0] < 0 && max[0] > 0 && min[1] < 4.7 && max[1] > 4.7;
  });
  expect(centreline.length).toBeGreaterThan(0);
  expect(centreline.every(part => getRomanPartBounds(part).max[2] < -.89)).toBe(true);
  for (const side of [-1, 1]) expect(summit.some(part => {
    const { max, min } = getRomanPartBounds(part);
    return min[0] < side * .85 && max[0] > side * .85 && min[1] < 4.7
      && max[1] > 4.7 && min[2] < -.9 && max[2] > .95;
  })).toBe(true);
});
