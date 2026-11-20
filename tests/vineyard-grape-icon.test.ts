import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createBuildingOccupationSymbolSvg } from "../src/render-common/buildings/building-occupation-symbol";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";

const countParts = (detailed: boolean, shape: string) => createRomanBuildingRecipe(getBuildingDefinition(5), detailed)
  .parts.filter(part => part.shape === shape && part.size[0] < .03 && part.tint![2] > .45).length;

it("paints a tapered grape bunch with a vine leaf, highlights only on High", () => {
  expect(countParts(false, "paint-ellipse")).toBeGreaterThanOrEqual(15);
  expect(countParts(true, "paint-triangle")).toBe(15);
  expect(countParts(false, "paint-triangle")).toBe(0);
  const parts = createRomanBuildingRecipe(getBuildingDefinition(5), false).parts;
  expect(parts.filter(part => part.shape === "paint-triangle").length).toBeGreaterThanOrEqual(10);
  const svg = createBuildingOccupationSymbolSvg(getBuildingDefinition(5));
  expect(svg.match(/<ellipse/g)!.length).toBeGreaterThan(30);
  expect(svg.match(/<polygon/g)!.length).toBeGreaterThan(20);
  expect(svg).toContain("<polygon");
});

it("hangs one shaded grape-bunch per vine on both detail levels", () => {
  for (const detailed of [true, false]) {
    const parts = createRomanBuildingRecipe(getBuildingDefinition(5), detailed).parts;
    const vines = parts.filter(part => part.shape === "vine-foliage").length;
    expect(parts.filter(part => part.shape === "grape-bunch")).toHaveLength(vines);
  }
});
