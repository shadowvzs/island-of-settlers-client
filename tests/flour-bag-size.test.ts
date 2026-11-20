import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingPart,createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { addRomanStockBag } from "../src/render-common/buildings/roman-workshop-stock";
import { getWareCarryAction } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";

const dimensions = (parts: BuildingPart[]) => {
  const bounds = parts.map(part => getRomanPartBounds(part));
  return [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)) -
    Math.min(...bounds.map(bound => bound.min[axis]!)));
};

describe("original flour bags at one small physical size", () => {
  for (const detailed of [true, false]) {
    it(`uniformly reduces the original sack 20% at ${detailed ? "High" : "Minimal"}`, () => {
      const original: BuildingPart[] = [];
      addRomanStockBag((surface, position, size, stage, shape = "box", rotation, tint) =>
        original.push({ surface, position, size, stage: stage ?? 3, shape, rotation, tint }), 0, 0, detailed);
      const oldSize = dimensions(original);
      dimensions(createWareRecipe("flour", detailed).parts).forEach((value, axis) =>
        expect(value).toBeCloseTo(oldSize[axis]! * .8, 8));
    });
    for (const typeId of [31, 32]) it(`${typeId} stock equals the small carrier bag in both LODs (${detailed})`, () => {
      const definition = getBuildingDefinition(typeId);
      const stock = createRomanBuildingRecipe(definition, detailed).parts.filter(part =>
        part.stock?.ware === "flour" && part.stock.slot === 0);
      const scale = getRomanBuildingWorldSizing(definition).scale;
      const carried = dimensions(createWareRecipe("flour", detailed).parts);
      dimensions(stock).forEach((value, axis) => expect(value * scale).toBeCloseTo(carried[axis]! * WORKER_SCALE, 8));
    });
  }
  it("preserves back carrying and matching transfers in all four rotations", () => {
    expect(getWareCarryAction("flour")).toBe("carry_back");
    for (const typeId of [31, 32]) for (const turns of [0, 1, 2, 3]) {
      const contact = getBuildingStockContact(typeId, typeId === 31 ? "output" : "input", "flour", 0, 40, 50, turns)!;
      contact.wareScale.forEach(value => expect(value).toBeCloseTo(WORKER_SCALE, 8));
    }
  });
});
