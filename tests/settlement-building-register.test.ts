import { describe, expect, it } from "vitest";

import { getSettlementBuildingRegister } from "../src/app/settlement-ui/building-register";
import { selectBuildingRegister } from "../src/app/settlement-ui/building-register/helpers";
import { getSettlementInventoryEntries } from "../src/app/settlement-ui/inventory";
import type { SettlementBuildingSummary } from "../src/app/settlement-ui/types";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { BUILDING_MENU } from "../src/render-common/buildings/building-menu";

describe("building overview counts", () => {
  it("includes each implemented building exactly once even with no buildings placed", () => {
    const entries = getSettlementBuildingRegister();
    expect(new Set(entries.map(entry => entry.id)).size).toBe(BUILDING_CATALOG.length);
    expect(entries).toHaveLength(BUILDING_CATALOG.length);
    expect(entries.every(entry => !entry.completed.length && entry.sites === 0)).toBe(true);
  });

  it("keeps built totals distinct from construction sites and cycles only finished matches", () => {
    const buildings: SettlementBuildingSummary[] = [
      { id: "hq", type: 0, completed: true },
      { id: "cut-a", type: 17, completed: true },
      { id: "cut-b", type: 17, completed: true },
      { id: "cut-site", type: 17, completed: false },
      { id: "mill-site", type: 31, completed: false }
    ];
    const register = getSettlementBuildingRegister(buildings);
    expect(register.find(entry => entry.id === 17)).toMatchObject({
      completed: ["cut-a", "cut-b"], sites: 1
    });
    expect(register.find(entry => entry.id === 31)).toMatchObject({ completed: [], sites: 1 });
    buildings[3]!.completed = true;
    expect(getSettlementBuildingRegister(buildings).find(entry => entry.id === 17)).toMatchObject({
      completed: ["cut-a", "cut-b", "cut-site"], sites: 0
    });
  });

  it("uses current island eligibility and canonical category order while preserving own existing entries", () => {
    const allowed = [37, 1, 19, 10, 33];
    const buildings: SettlementBuildingSummary[] = [
      { completed: true, id: "existing", type: 17 },
      { completed: false, id: "site", type: 31 },
      { completed: true, hostile: true, id: "hostile", type: 12 }
    ];
    const entries = selectBuildingRegister({ buildableTypes: allowed, buildings });
    const included = new Set([...allowed, 17, 31]);
    expect(entries.map(entry => entry.id)).toEqual(BUILDING_MENU.flatMap(group =>
      group.buildings.filter(building => included.has(building.id)).map(building => building.id)));
    expect(entries).toHaveLength(included.size);
    expect(entries.find(entry => entry.id === 17)?.completed).toEqual(["existing"]);
    expect(entries.find(entry => entry.id === 31)?.sites).toBe(1);
    expect(entries.find(entry => entry.id === 12)).toBeUndefined();
    expect(selectBuildingRegister({ buildableTypes: [43, 44], buildings: [] }).map(entry => entry.id))
      .toEqual(BUILDING_MENU.flatMap(group => group.buildings.filter(building => [43, 44].includes(building.id))
        .map(building => building.id)));
    expect(selectBuildingRegister({ buildableTypes: [], buildings: [] })).toEqual([]);
  });

  it("never lists a hostile building as the player's", () => {
    const register = getSettlementBuildingRegister([
      { completed: true, id: "own", type: 1 }, { completed: true, hostile: true, id: "enemy", type: 1 }
    ]);
    expect(register.find(entry => entry.id === 1)).toMatchObject({ completed: ["own"], sites: 0 });
  });
});

describe("warehouse inventory", () => {
  it("shows exact local amounts including empty stock types rather than realm totals", () => {
    const headquarters = { planks: 4, axe: 0, ironOre: 2 };
    const storehouse = { planks: 19, axe: 1 };
    const headquartersEntries = getSettlementInventoryEntries(headquarters);
    expect(headquartersEntries).toEqual([
      { ware: "planks", count: 4, name: "Softwood planks" },
      { ware: "ironOre", count: 2, name: "Iron ore" },
      { ware: "axe", count: 0, name: "Axe" }
    ]);
    expect(getSettlementInventoryEntries(storehouse)[0]!.count).toBe(19);
    expect(headquarters).toEqual({ planks: 4, axe: 0, ironOre: 2 });
  });

  it("keeps unavailable inventory empty without inventing a resource total", () => {
    expect(getSettlementInventoryEntries()).toEqual([]);
  });
});
