import { expect, it } from "vitest";

import { getWareCarryAction, resolveWareId } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { wareDisplayName, wareNameForCount } from "../src/shared/settlement/ware-names";

it.each([true, false])("keeps advanced materials identifiable at detailed=%s", detailed => {
  const logs = createWareRecipe("hardwoodLogs", detailed).parts;
  expect(logs.filter(part => part.surface === "endgrain").length).toBeGreaterThanOrEqual(4);
  expect(logs.filter(part => part.surface === "bark" && part.rotation?.[0] === Math.PI / 2)).toHaveLength(2);
  const boards = createWareRecipe("hardwoodPlanks", detailed).parts;
  expect(boards.filter(part => part.surface === "wood")).toHaveLength(4);
  expect(boards.some(part => part.surface === "iron" || part.surface === "rope")).toBe(false);
  const marble = createWareRecipe("marble", detailed).parts;
  expect(marble[0]!.size).toEqual([.36, .23, .27]);
  expect(marble.filter(part => part.size[1] < .002).length).toBeGreaterThanOrEqual(4);
  expect(marble.filter(part => part.size[2] < .002).length).toBeGreaterThanOrEqual(2);
  expect(marble).not.toEqual(createWareRecipe("stone", detailed).parts);
});

it.each(["hardwoodLogs", "hardwoodPlanks", "marble"])("routes %s through standard inventory and carry", id => {
  expect(resolveWareId(id)).toBe(id);
  expect(getWareCarryAction(id)).toBe("carry_shoulder");
  expect(wareNameForCount(id, 5)).toBe(wareDisplayName(id));
});

it("keeps paired hardwood trunks while simplifying buried cut faces in Minimal stock piles", () => {
  const stock = createWareRecipe("hardwoodLogs", false, true).parts;
  expect(stock.filter(part => part.surface === "bark")).toHaveLength(2);
  expect(stock.filter(part => part.surface === "endgrain")).toHaveLength(2);
  const carried = createWareRecipe("hardwoodLogs", false).parts;
  expect(carried.filter(part => part.surface === "endgrain")).toHaveLength(4);
});

it("keeps loose boards without transport bindings in Minimal hardwood stock", () => {
  const stock = createWareRecipe("hardwoodPlanks", false, true).parts;
  expect(stock.filter(part => part.surface === "wood")).toHaveLength(3);
  expect(stock.filter(part => part.surface === "iron")).toHaveLength(0);
  expect(createWareRecipe("hardwoodPlanks", false).parts.filter(part => part.surface === "iron")).toHaveLength(0);
});

it.each([true, false])("routes each quarry product to its own silhouette at detailed=%s", detailed => {
  const ids = ["marble", "limestone", "granite", "basalt"];
  const silhouettes = ids.map(id => JSON.stringify(createWareRecipe(id, detailed).parts.map(part => ({
    position: part.position, rotation: part.rotation, shape: part.shape, size: part.size
  }))));
  expect(new Set(silhouettes).size).toBe(ids.length);
});
