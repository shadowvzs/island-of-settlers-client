import { describe, expect, it } from "vitest";

import { getRaceOptions } from "../src/app/account/race-picker/helpers";
import { NEUTRAL_TALENT_MODIFIERS } from "../src/shared/progression/talents";
import {
  applyNationalAttack, applyNationalDefence, NATION_BONUSES, nationArcherRangeFactor,
  nationConstructionShare, nationDamageShare, nationMilitarySpeedFactor, nationProductionShare,
  nationSoldierHealthShare
} from "../src/shared/settlement/nation-bonuses";
import { garrisonArcherReach } from "../src/shared/settlement/settlement-garrison-archers";
import { productionTalentBonus } from "../src/shared/settlement/settlement-talents";
import { workerCycleRateDetail } from "../src/shared/settlement/workshop-upgrades";

describe("national advantages", () => {
  it("publishes one economy and one military effect for every nation", () => {
    expect(Object.keys(NATION_BONUSES)).toHaveLength(8);
    for (const bonus of Object.values(NATION_BONUSES)) {
      expect(bonus.economy).toBeDefined();
      expect(bonus.military).toBeDefined();
    }
  });

  it("adds the Roman construction share to builder hammering only", () => {
    const context = { buildings: [], playerNation: "roman" as const, talents: NEUTRAL_TALENT_MODIFIERS };
    expect(nationConstructionShare("roman")).toBeCloseTo(.05);
    expect(nationConstructionShare("viking")).toBe(0);
    expect(workerCycleRateDetail(context, { building: 1, phase: "builderWork", uid: 1 })).toMatchObject({
      applies: false
    });
    expect(workerCycleRateDetail(context, { action: "work", building: 1, phase: "builderWork", uid: 1 }).rate)
      .toBeCloseTo(1.05);
  });

  it("adds production only for the nation's listed building types", () => {
    const base = { talents: NEUTRAL_TALENT_MODIFIERS };
    expect(productionTalentBonus({ ...base, playerNation: "nubian" }, 12)).toBeCloseTo(.05);
    expect(productionTalentBonus({ ...base, playerNation: "nubian" }, 37)).toBe(0);
    expect(productionTalentBonus({ ...base, playerNation: "japanese" }, 37)).toBeCloseTo(.05);
    expect(nationProductionShare("chinese", 30)).toBe(0);
    expect(nationProductionShare("chinese", 5)).toBeCloseTo(.05);
  });

  it("keeps the Chinese double at exactly two and never stacks a rank critical to three", () => {
    const normal = applyNationalAttack(10, false, "chinese", "archer", 0, .01);
    const critical = applyNationalAttack(15, true, "chinese", "archer", 0, .01);
    const noDouble = applyNationalAttack(10, false, "chinese", "archer", 0, .9);
    expect(normal).toEqual({ critical: true, damage: 20 });
    expect(critical).toEqual({ critical: true, damage: 20 });
    expect(noDouble).toEqual({ critical: false, damage: 10 });
    expect(applyNationalAttack(10, false, "chinese", "heavy", 0, .01)).toEqual({ critical: false, damage: 10 });
  });

  it("shows the same localized nation/economy/military tooltip on every icon", () => {
    const options = getRaceOptions(null);
    expect(options).toHaveLength(8);
    for (const option of options) {
      expect(option.tooltip).toContain(option.label);
      expect(option.tooltip).toContain("Economy:");
      expect(option.tooltip).toContain("Military:");
      expect(option.tooltip.split("\n")).toHaveLength(3);
    }
    expect(options.find(option => option.nation === "nubian")!.tooltip)
      .toContain("+10% archer range");
  });

  it("gives Nubian field and tower archers +10% range while preserving the 1.125x tower cap", () => {
    const archer = (nation: "nubian" | "roman", facing: number | null) => ({
      facing, floor: 0, nation, soldier: { combat: { faction: 0 } }
    }) as never;
    expect(garrisonArcherReach(archer("nubian", 3), 0)).toBeCloseTo(8.8);
    expect(garrisonArcherReach(archer("nubian", null), 0)).toBeCloseTo(8.8);
    expect(garrisonArcherReach(archer("nubian", null), -20)).toBeCloseTo(9);
    expect(garrisonArcherReach(archer("roman", null), 0)).toBeCloseTo(8);
  });

  it("applies national damage, health and movement to the player side only", () => {
    expect(nationDamageShare("viking", "heavy")).toBeCloseTo(.10);
    expect(nationDamageShare("viking", "archer")).toBe(0);
    expect(nationSoldierHealthShare("roman", "shield")).toBeCloseTo(.05);
    expect(applyNationalDefence(21, "roman", "shield", 0)).toBeCloseTo(20);
    expect(applyNationalDefence(21, "roman", "shield", 1)).toBe(21);
    expect(nationMilitarySpeedFactor("indigenous")).toBeCloseTo(1.15);
    expect(nationMilitarySpeedFactor("roman")).toBe(1);
    expect(nationArcherRangeFactor("nubian")).toBeCloseTo(1.10);
    expect(nationArcherRangeFactor("chinese")).toBe(1);
  });
});
