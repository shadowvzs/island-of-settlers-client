import { SAWMILL_RECIPES } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { BUILDING_LEVEL_STEPS, MAX_BUILDING_LEVEL } from "../src/shared/balance/building-levels";
import { buildingLevelBenefits } from "../src/shared/settlement/building-level-benefits";
import { buildingLevelCost, buildingLevelEffects, buildingLevelFamily } from "../src/shared/settlement/building-levels";
import { residenceEffect } from "../src/shared/settlement/residences";
import { sawmillProductionRule, unlockedSawmillRecipes } from "../src/shared/settlement/sawmill-recipes";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { dockPorterSpeedFactor } from "../src/shared/settlement/ship-cargo-handling";
import { storageContribution } from "../src/shared/settlement/storage-capacity";
import {
  cancelWorkshopUpgrade, finishWorkshopUpgrade, lookoutSightFactor, militaryDoorFactor, productionCycleRate,
  requestWorkshopUpgrade, tavernTrainingFactor, territoryRadius, updateWorkshopUpgrade, validWorkshopUpgrade,
  workshopCycleFactor, workshopUpgradeCost
} from "../src/shared/settlement/workshop-upgrades";

const LEVELS = [0, 1, 2, 3, 4] as const;
type SavedLevel = (typeof LEVELS)[number];
const building = (typeId: number, extra: Partial<SettlementBuilding> = {}) => ({
  construction: 1, incoming: {}, input: {}, inventory: {}, output: {}, typeId, uid: 1, ...extra
}) as SettlementBuilding;
/** The linear factor 1 + step × level at every saved level. */
const linear = (step: number) => LEVELS.map(level => 1 + step * level);
const expectFactors = (actual: readonly number[], step: number) =>
  linear(step).forEach((factor, level) => expect(actual[level]).toBeCloseTo(factor, 9));
const atLevel = (typeId: number, level: SavedLevel) =>
  building(typeId, level ? { workshopUpgrade: { level } } : {});
/** The escrow refund lands in a storage's own inventory, else in the workshop's output. */
const refundStock = (target: SettlementBuilding) =>
  buildingLevelFamily(target.typeId) === "storage" || buildingLevelFamily(target.typeId) === "harbour"
    ? target.inventory : target.output;

describe("building level costs", () => {
  it("costs the next tier's planks and stone, one more of each per level, keeping level 2", () => {
    expect(LEVELS.map(level => buildingLevelCost(25, level))).toEqual([
      { hardwoodPlanks: 4, marble: 2 }, { cedarPlanks: 5, limestone: 3 }, { walnutPlanks: 6, basalt: 4 },
      { granite: 5, mahoganyPlanks: 7 }, {}]);
    for (const typeId of [0, 4, 14, 29, 39, 40, 57])
      expect(buildingLevelCost(typeId, 2), `type ${typeId}`).toEqual({ basalt: 4, walnutPlanks: 6 });
  });
  it("lets the shared sawmill pay logs, since it makes the tier's planks", () => {
    expect(LEVELS.map(level => buildingLevelCost(33, level))).toEqual([
      { hardwoodLogs: 4, marble: 2 }, { cedarLogs: 5, limestone: 3 }, { basalt: 4, walnutLogs: 6 },
      { granite: 5, mahoganyLogs: 7 }, {}]);
    expect(buildingLevelCost(7, 0)).toEqual({});
  });
});

describe("every building type through the real upgrade functions", () => {
  const types = BUILDING_CATALOG.map(entry => entry.id).filter(typeId => typeId !== 38 && typeId !== 7);
  it("classifies every catalog type into one family with effects", () => {
    expect(buildingLevelFamily(38)).toBeUndefined();
    for (const typeId of types) expect(buildingLevelFamily(typeId), `type ${typeId}`).toBeDefined();
    for (const typeId of types) expect(buildingLevelEffects(typeId).length, `type ${typeId}`).toBeGreaterThan(0);
  });
  it.each(types)("raises type %i to level 5 with escrow, refunds a cancelled request, then stops", typeId => {
    const target = building(typeId);
    for (const level of LEVELS.slice(0, 4)) {
      const cost = workshopUpgradeCost(target);
      expect(requestWorkshopUpgrade(target)).toBe(true);
      const [ware] = Object.keys(cost);
      target.workshopUpgrade!.reserved![ware!] = 1;
      expect(cancelWorkshopUpgrade(target)).toBe(true);
      updateWorkshopUpgrade(target);
      expect(refundStock(target)[ware!]).toBe(1);
      delete refundStock(target)[ware!];
      expect(target.workshopUpgrade).toEqual(level ? { level } : undefined);
      expect(requestWorkshopUpgrade(target)).toBe(true);
      target.workshopUpgrade!.reserved = { ...cost };
      expect(validWorkshopUpgrade(target)).toBe(true);
      expect(finishWorkshopUpgrade(target)).toBe(true);
      expect(target.workshopUpgrade).toEqual({ level: level + 1 });
      expect(validWorkshopUpgrade(target)).toBe(true);
    }
    expect(requestWorkshopUpgrade(target)).toBe(false);
    expect(workshopUpgradeCost(target)).toEqual({});
    expect(buildingLevelBenefits(typeId, MAX_BUILDING_LEVEL).length).toBeGreaterThan(0);
    expect(target.input).toEqual({}); expect(target.output).toEqual({});
  });
});

describe("building level effects per family", () => {
  it("speeds producers and the shared sawmill by 10% per level", () => {
    for (const typeId of [17, 20, 25, 33])
      expect(LEVELS.map(level => workshopCycleFactor(atLevel(typeId, level)))).toEqual([1, 1.1, 1.2, 1.3, 1.4]);
    expect(productionCycleRate(atLevel(25, 4))).toBeGreaterThan(productionCycleRate(atLevel(25, 3)));
    expect(workshopCycleFactor(atLevel(29, 4))).toBe(1);
  });
  it("unlocks one sawmill recipe per level; specialist woodcutters keep their own rule", () => {
    expect(LEVELS.map(level => unlockedSawmillRecipes(atLevel(33, level)).length)).toEqual([1, 2, 3, 4, 5]);
    const specialist = { ...atLevel(42, 4), selectedOutput: "mahoganyPlanks" };
    const base = { inputs: ["hardwoodLogs"], outputs: ["hardwoodPlanks"] } as never;
    expect(sawmillProductionRule(specialist, base)).toBe(base);
    expect(sawmillProductionRule({ ...atLevel(33, 4), selectedOutput: "mahoganyPlanks" }, base))
      .toMatchObject({ inputs: [SAWMILL_RECIPES[4]!.input], outputs: ["mahoganyPlanks"] });
  });
  it("adds a quarter of the base storage per level to the HQ, storehouse and harbour", () => {
    expect(LEVELS.map(level => storageContribution(atLevel(0, level)))).toEqual([1000, 1250, 1500, 1750, 2000]);
    expect(LEVELS.map(level => storageContribution(atLevel(39, level)))).toEqual([500, 625, 750, 875, 1000]);
    expectFactors(LEVELS.map(level => storageContribution(atLevel(29, level)) / 500), BUILDING_LEVEL_STEPS.storage);
    expect(LEVELS.map(level => dockPorterSpeedFactor(level))).toEqual([1, 1.1, 1.2, 1.3, 1.4]);
  });
  it("adds 10% of the base population limit per residence level", () => {
    const limit = (typeId: number, level: SavedLevel) =>
      residenceEffect(atLevel(typeId, level), { populationLimit: 0, settlerGrowthSpeed: 0 }).limitBonus;
    expect(LEVELS.map(level => limit(58, level))).toEqual([25, 28, 31, 34, 37]);
    expect(LEVELS.map(level => limit(59, level))).toEqual([45, 50, 55, 60, 65]);
  });
  it("strengthens military doors and territory, lookout sight and tavern training per level", () => {
    expectFactors(LEVELS.map(level => militaryDoorFactor(atLevel(1, level))), BUILDING_LEVEL_STEPS.door);
    expect(militaryDoorFactor(atLevel(1, 4))).toBeCloseTo(1.6, 9);
    expect(LEVELS.map(level => territoryRadius(atLevel(9, level)))).toEqual([53, 58, 64, 69, 74]);
    expectFactors(LEVELS.map(level => lookoutSightFactor(atLevel(14, level))), BUILDING_LEVEL_STEPS.sight);
    expect(lookoutSightFactor(atLevel(14, 4))).toBeCloseTo(1.6, 9);
    expect(LEVELS.map(level => tavernTrainingFactor(atLevel(40, level)))).toEqual([1, 1.1, 1.2, 1.3, 1.4]);
    // The HQ keeps its radius: its levels are storage.
    expect(territoryRadius(atLevel(0, 4))).toBe(48);
  });
});
