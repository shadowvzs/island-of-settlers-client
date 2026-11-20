import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";

const dimensions = (parts: ReturnType<typeof createWareRecipe>["parts"]) => {
  const bounds = parts.map(part => getRomanPartBounds(part));
  return [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)) -
    Math.min(...bounds.map(bound => bound.min[axis]!)));
};

describe("small original mill wheat bundles", () => {
  for (const detailed of [true, false]) it(`matches the carrier recipe at ${detailed ? "High" : "Minimal"}`, () => {
    const definition = getBuildingDefinition(31);
    const stock = createRomanBuildingRecipe(definition, detailed).parts.filter(part => part.stock?.ware === "grain");
    const scale = getRomanBuildingWorldSizing(definition).scale;
    const carried = dimensions(createWareRecipe("grain", detailed).parts);
    dimensions(stock).forEach((value, axis) => expect(value * scale).toBeCloseTo(carried[axis]! * WORKER_SCALE, 8));
    expect(stock.some(part => part.shape === "wheat-stalk")).toBe(true);
  });
  it("keeps Miller and Carrier transfer scales identical in every rotation", () => {
    for (const turns of [0, 1, 2, 3]) {
      const contact = getBuildingStockContact(31, "input", "grain", 0, 40, 50, turns)!;
      contact.wareScale.forEach(value => expect(value).toBeCloseTo(WORKER_SCALE, 8));
    }
  });
});
