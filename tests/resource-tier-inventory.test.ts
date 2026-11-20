import { BUILDING_MATERIAL_ORDER, RESOURCE_TIERS } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { getSettlementInventoryEntries } from "../src/app/settlement-ui/inventory";

it("includes base softwood/stone as tier zero before the four advanced pairs", () => {
  expect(RESOURCE_TIERS.map(pair => pair.tier)).toEqual([0, 1, 2, 3, 4]);
  expect(RESOURCE_TIERS[0]).toMatchObject({ wood: "softwood", stone: "stone", logs: "logs", planks: "planks" });
  expect(BUILDING_MATERIAL_ORDER).toEqual([
    "logs", "planks", "stone", "hardwoodLogs", "hardwoodPlanks", "marble",
    "cedarLogs", "cedarPlanks", "limestone", "walnutLogs", "walnutPlanks", "basalt",
    "mahoganyLogs", "mahoganyPlanks", "granite"
  ]);
});

it("sorts every store's goods in catalog order, unknown save ids last, without dropping or changing them", () => {
  const inventory = Object.fromEntries(["fish", "unknownSavedWare", ...[...BUILDING_MATERIAL_ORDER].reverse()]
    .map((ware, index) => [ware, index + 1]));
  const entries = getSettlementInventoryEntries(inventory);
  // Owner decision 2026-11-11: the inventory grid follows the catalog wares order, not the old material order.
  expect(entries.map(entry => entry.ware)).toEqual([
    "logs", "planks", "stone", "hardwoodLogs", "hardwoodPlanks", "marble", "cedarLogs", "cedarPlanks",
    "walnutLogs", "walnutPlanks", "mahoganyLogs", "mahoganyPlanks", "limestone", "basalt", "granite",
    "fish", "unknownSavedWare"
  ]);
  expect(Object.fromEntries(entries.map(({ count, ware }) => [ware, count]))).toEqual(inventory);
});
