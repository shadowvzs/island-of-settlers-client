import { expect, it } from "vitest";

import { activeInventoryTab, getInventoryTabs, inventoryForTab, inventoryItemTab } from "../src/app/player-inventory/categories";
import { inventoryMapKind, isInventoryItemVisible, visiblePlayerInventory } from "../src/app/player-inventory/map-context";
import type { PlayerInventory } from "../src/shared/progression/player-inventory";

const decoration = "roadDecoration:roman-rusticated-arch:limestone" as const;
const inventory: PlayerInventory = { chooseNation: 1, commanderRecovery: 1, [decoration]: 2 };
it("uses authoritative runtime expedition and authored map kind, independent of an HQ or capture status", () => {
  expect(inventoryMapKind({})).toBe("home");
  expect(inventoryMapKind({ scenarioKind: "colony" })).toBe("colony");
  expect(inventoryMapKind({ scenarioKind: "adventure" })).toBe("adventure");
  expect(inventoryMapKind({ colony: { conquered: true }, scenarioKind: "home" })).toBe("colony");
  expect(inventoryMapKind({ adventure: { completed: true }, scenarioKind: "home" })).toBe("adventure");
});
it("places recovery in Battle, every decoration in Decoration, and Choose nation in Misc", () => {
  expect(inventoryItemTab("commanderRecovery")).toBe("battle");
  expect(inventoryItemTab(decoration)).toBe("decoration");
  expect(inventoryItemTab("chooseNation")).toBe("misc");
  expect(inventoryForTab(inventory, "battle")).toEqual({ commanderRecovery: 1 });
  expect(inventoryForTab(inventory, "decoration")).toEqual({ [decoration]: 2 });
  expect(inventoryForTab(inventory, "misc")).toEqual({ chooseNation: 1 });
});
it("keeps all tabs visible but disables Decoration and Misc abroad, deriving a valid selection immediately", () => {
  for (const kind of ["adventure", "colony"] as const) {
    const active = activeInventoryTab("misc", kind);
    expect(active).toBe("battle");
    expect(getInventoryTabs(active, kind).map(tab => [tab.id, tab.disabled, tab.selected, tab.tabIndex]))
      .toEqual([["battle", false, true, 0], ["decoration", true, false, -1], ["misc", true, false, -1]]);
    expect(isInventoryItemVisible("chooseNation", kind)).toBe(false);
    expect(isInventoryItemVisible(decoration, kind)).toBe(false);
    expect(isInventoryItemVisible("commanderRecovery", kind)).toBe(true);
    expect(visiblePlayerInventory(inventory, kind)).toEqual({ commanderRecovery: 1 });
  }
  expect(activeInventoryTab("decoration", "home")).toBe("decoration");
  expect(getInventoryTabs("misc", "home").every(tab => !tab.disabled)).toBe(true);
  expect(visiblePlayerInventory(inventory, "home")).toBe(inventory);
  expect(inventory).toEqual({ chooseNation: 1, commanderRecovery: 1, [decoration]: 2 });
});
