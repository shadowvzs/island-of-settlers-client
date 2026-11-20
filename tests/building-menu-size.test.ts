import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { BUILDING_MENU } from "../src/render-common/buildings/building-menu";
import { getBuildingCategory } from "../src/render-common/buildings/building-menu-groups";

it("lists every building once in the building panel tab of its catalog category", () => {
  const entries = BUILDING_MENU.flatMap(group => group.buildings);
  expect(entries).toHaveLength(BUILDING_CATALOG.length);
  expect(new Set(entries.map(building => building.id)).size).toBe(BUILDING_CATALOG.length);
  for (const group of BUILDING_MENU)
    for (const building of group.buildings)
      expect(getBuildingCategory(building.id)).toBe(group.id);
});


it("keeps functional navigation independent of physical sizes", () => {
  expect(BUILDING_MENU.map(group => group.id)).toEqual([
    "materials", "settlement", "food-drink", "industry", "mines", "military"
  ]);
  expect(getBuildingCategory(0)).toBe("settlement");
  expect(getBuildingCategory(7)).toBe("settlement");
  expect(getBuildingCategory(16)).toBe("military");
  for (const id of [38, 44, 48, 52, 56, 63]) expect(getBuildingCategory(id)).toBeUndefined();
});


it("accounts for every retained building identity once", () => {
  const retained = Array.from({ length: 63 }, (_, id) => id)
    .filter(id => ![30, 38, 44, 48, 52, 56].includes(id));
  expect(BUILDING_MENU.flatMap(group => group.buildings.map(building => building.id))
    .sort((a, b) => a - b)).toEqual(retained);
});
