import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { getRomanWareStockPresentationParts } from "../src/render-common/buildings/roman-ware-stock";

it.each([true, false])("hardwood sawmill bundles touch their supports (detailed=%s)", detailed => {
  const { recipe, scale } = getRomanBuildingWorldSizing(getBuildingDefinition(44));
  const parts = getRomanWareStockPresentationParts(recipe, scale, detailed)
    .filter(part => part.stock?.ware === "hardwoodLogs");
  const bounds = [0, 1, 2, 3, 4].map(slot => {
    const pieces = parts.filter(part => part.stock!.slot === slot).map(part => getRomanPartBounds(part));
    expect(pieces.length).toBeGreaterThan(0);
    return {
      bottom: Math.min(...pieces.map(piece => piece.min[1])),
      top: Math.max(...pieces.map(piece => piece.max[1]))
    };
  });
  for (const slot of [0, 1, 2]) expect(bounds[slot]!.bottom).toBeCloseTo(0, 7);
  for (const slot of [3, 4]) expect(bounds[slot]!.bottom).toBeCloseTo(bounds[slot - 3]!.top, 7);
});
