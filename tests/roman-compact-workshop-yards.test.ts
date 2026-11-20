import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";

it.each([21, 25, 32, 36])("workshop %s keeps visible input/output categories within a maximum6×6plot", id => {
  const definition = getBuildingDefinition(id);
  const sizing = getRomanBuildingWorldSizing(definition);
  expect(sizing.cells[0]).toBeLessThanOrEqual(6);
  expect(sizing.cells[1]).toBeLessThanOrEqual(6);
  for (const detailed of [true, false]) {
    const recipe = createRomanBuildingRecipe(definition, detailed);
    for (const ware of PRODUCTION_RULES[id]!.inputs)
      expect(recipe.parts.some(part => part.stock?.kind === "input" && part.stock.ware === ware), ware).toBe(true);
    for (const ware of PRODUCTION_RULES[id]!.outputs) {
      const slots = new Set(recipe.parts.filter(part => part.stock &&
        (part.stock.kind ?? "output") === "output" &&
        (part.stock.ware === ware || part.stock.wares?.includes(ware))).map(part => part.stock!.slot));
      expect([...slots].sort((a, b) => a - b), ware).toEqual([0, 1, 2, 3, 4, 5]);
    }
  }
});

it.each([true, false])("shipyard detailed=%s has six grounded boats with clear space between their full hull/tray bounds", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(36), detailed);
  const boats = Array.from({ length: 6 }, (_, slot) => {
    const bounds = recipe.parts.filter(part => part.stock?.ware === "boat" && part.stock.slot === slot)
      .map(part => getRomanPartBounds(part));
    expect(bounds.length).toBeGreaterThan(0);
    return { minX: Math.min(...bounds.map(bound => bound.min[0])),
      maxX: Math.max(...bounds.map(bound => bound.max[0])),
      minZ: Math.min(...bounds.map(bound => bound.min[2])),
      maxZ: Math.max(...bounds.map(bound => bound.max[2])) };
  });
  for (let first = 0; first < boats.length; first++) for (let second = first + 1; second < boats.length; second++) {
    const a = boats[first]!, b = boats[second]!;
    const gap = Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minZ - a.maxZ, a.minZ - b.maxZ);
    expect(gap).toBeGreaterThanOrEqual(.03 - 1e-8);
  }
});

it.each([true, false])("metalworks detailed=%s uses its existing yard stocks instead of duplicate remote bays", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(25), detailed);
  const boards = recipe.parts.filter(part => part.stock?.kind === "input" && part.stock.ware === "planks");
  expect(boards).toHaveLength(6);
  expect(new Set(boards.map(part => part.stock!.slot)).size).toBe(6);
  const coal = recipe.parts.filter(part => part.stock?.kind === "input" && part.stock.ware === "coal");
  expect(coal.filter(part => part.shape === "open-sack")).toHaveLength(1);
});
