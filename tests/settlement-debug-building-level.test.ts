import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { BUILDING_LEVEL_STEPS, MAX_BUILDING_LEVEL } from "../src/shared/balance/building-levels";
import { STORAGE_BASE_CAPACITY } from "../src/shared/balance/economy";
import { workshopUpgradeLevels } from "../src/shared/settlement/building-level-benefits";
import { residenceLevel,residenceLimitBonus } from "../src/shared/settlement/residences";
import { unlockedSawmillRecipes } from "../src/shared/settlement/sawmill-recipes";
import { debugRaiseBuildingLevel } from "../src/shared/settlement/settlement-debug-building-level";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { storageContribution } from "../src/shared/settlement/storage-capacity";
import {
  isUpgradeableWorkshopType, maxWorkshopUpgradeLevel, militaryDoorFactor, requestWorkshopUpgrade, territoryRadius,
  validWorkshopUpgrade, workshopCycleFactor
} from "../src/shared/settlement/workshop-upgrades";

let nextUid = 1;
const building = (typeId: number, props: Partial<SettlementBuilding> = {}) => ({
  construction: 1, cycle: 0, incoming: {}, input: {}, inventory: {}, output: {}, typeId, uid: nextUid++, ...props
} as SettlementBuilding);
const island = (...buildings: SettlementBuilding[]) => ({ buildings } as SettlementContext);
const raise = (target: SettlementBuilding) => debugRaiseBuildingLevel(island(target), target.uid);

describe("development tool: raise building level", () => {
  it("raises a workshop one level for free, through the normal completion", () => {
    const smith = building(25, { input: { iron: 2 } });
    expect(raise(smith)).toEqual({ level: 2, ok: true, typeId: 25 });
    expect(smith.workshopUpgrade).toEqual({ level: 1 });
    expect(smith.input).toEqual({ iron: 2 });
    expect(workshopCycleFactor(smith)).toBeGreaterThan(1);
    expect(validWorkshopUpgrade(smith)).toBe(true);
  });

  it("stops at the maximum level 5", () => {
    const smith = building(25);
    for (let click = 0; click < 4; click++) raise(smith);
    expect(raise(smith)).toEqual({ ok: false, reason: "already at its maximum level 5", typeId: 25 });
    expect(smith.workshopUpgrade).toEqual({ level: 4 });
    expect(workshopCycleFactor(smith)).toBeCloseTo(1.4, 9);
  });

  it("raises every upgradeable building type to level 5", () => {
    const types = BUILDING_CATALOG.map(entry => entry.id).filter(typeId => typeId !== 38 && isUpgradeableWorkshopType(typeId));
    expect(types.length).toBe(BUILDING_CATALOG.length - 1); // Monument has no levels
    for (const typeId of types) {
      const target = building(typeId);
      const levels = [1, 2, 3, 4].map(() => raise(target));
      expect(levels.map(result => result.ok && result.level), `type ${typeId}`).toEqual([2, 3, 4, 5]);
      expect(raise(target).ok).toBe(false);
      expect(validWorkshopUpgrade(target), `type ${typeId}`).toBe(true);
    }
  });

  it.each([
    ["workshop", 25], ["storage", 29], ["harbour", 39], ["military", 4], ["residence", 57], ["sawmill", 33]
  ])("raises a %s one level per click up to its real maximum level", (_kind, typeId) => {
    const target = building(typeId);
    const maxLevel = maxWorkshopUpgradeLevel(typeId);
    const levels = Array.from({ length: maxLevel }, () => raise(target));
    expect(levels).toEqual(Array.from({ length: maxLevel }, (_, index) => ({ level: index + 2, ok: true, typeId })));
    expect(levels.length + 1).toBe(MAX_BUILDING_LEVEL);
    expect(levels.length + 1).toBe(Math.max(...workshopUpgradeLevels(typeId).map(entry => entry.level)));
    expect(raise(target)).toMatchObject({ ok: false, reason: `already at its maximum level ${maxLevel + 1}` });
    expect(validWorkshopUpgrade(target)).toBe(true);
  });

  it("walks the sawmill through every level and unlocks its recipes", () => {
    const sawmill = building(33);
    const levels = [1, 2, 3, 4].map(() => raise(sawmill));
    expect(levels.map(result => result.ok && result.level)).toEqual([2, 3, 4, 5]);
    expect(unlockedSawmillRecipes(sawmill)).toHaveLength(5);
    expect(raise(sawmill).ok).toBe(false);
    expect(validWorkshopUpgrade(sawmill)).toBe(true);
  });

  it("raises storage capacity, residence limit and military door and territory", () => {
    const storehouse = building(29), residence = building(57), tower = building(4);
    const radius = territoryRadius(tower)!;
    for (const target of [storehouse, residence, tower]) expect(raise(target).ok).toBe(true);
    expect(storageContribution(storehouse)).toBe(STORAGE_BASE_CAPACITY[29]! * (1 + BUILDING_LEVEL_STEPS.storage));
    for (let click = 0; click < 3; click++) raise(storehouse);
    expect(storageContribution(storehouse)).toBe(STORAGE_BASE_CAPACITY[29]! * (1 + 4 * BUILDING_LEVEL_STEPS.storage));
    expect(residenceLevel(residence)).toBe(1);
    expect(residenceLimitBonus(57, residenceLevel(residence))).toBeGreaterThan(residenceLimitBonus(57, 0));
    expect(militaryDoorFactor(tower)).toBeGreaterThan(1);
    expect(territoryRadius(tower)!).toBeGreaterThan(radius);
  });

  it("keeps the storage stock untouched", () => {
    const storehouse = building(29, { inventory: { planks: 3, stone: 3 } });
    raise(storehouse);
    expect(storehouse.inventory).toEqual({ planks: 3, stone: 3 });
  });

  it("refuses buildings without levels, unfinished, enemy and pending ones", () => {
    const pending = building(25, { output: {} });
    requestWorkshopUpgrade(pending);
    const cases: Array<[SettlementBuilding, string]> = [
      [building(7), "this building has no levels"],
      [building(25, { construction: .5 }), "only finished buildings you own can be raised"],
      [building(4, { militaryFaction: 1 }), "only finished buildings you own can be raised"],
      [pending, "finish or cancel its pending upgrade first"]
    ];
    for (const [target, reason] of cases) expect(raise(target)).toMatchObject({ ok: false, reason });
    expect(pending.workshopUpgrade?.requested).toBe(true);
    expect(debugRaiseBuildingLevel(island(), 999)).toEqual({ ok: false, reason: "no building there" });
  });
});
