import {
  CAPSTONE_BRANCH_POINTS, LEVEL_THRESHOLDS, TALENT_BRANCHES, TALENT_MAX_RANK, TALENT_RESET_GEMS, TALENTS,
  TIER_GATE_POINTS
} from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import {
  completeQuest, createPlayerProgress, type PlayerProgress, validatePlayerProgress
} from "../src/shared/progression/player-progress";
import { applyTalents, resetAppliedTalents } from "../src/shared/progression/player-talents";
import {
  branchGatePoints, maximumTalentModifier, NEUTRAL_TALENT_MODIFIERS, raiseTalent, reducedDuration,
  talentModifiers, talentPointsForLevel, talentRaiseCheck, type TalentRanks, talentRanksError, timeReductionRate
} from "../src/shared/progression/talents";

const atLevel = (level: number, extra: Partial<PlayerProgress> = {}): PlayerProgress =>
  ({ ...createPlayerProgress(1), experience: LEVEL_THRESHOLDS[level - 1]!, ...extra });
/** Five ranks in each listed talent. */
const full = (...ids: string[]): TalentRanks => Object.fromEntries(ids.map(id => [id, TALENT_MAX_RANK]));
const ECONOMY_GATE = full("productionSpeed", "storageCapacity", "constructionSpeed", "treeGrowth");
/** Four points in Economy tier 1 and four in tier 2: field growth's tier is open. */
const ECONOMY_TIER_3 = { constructionSpeed: 4, productionSpeed: 4 };

describe("talent tree data", () => {
  it("has 24 talents of five ranks in three symmetric branches of 3 / 2 / 2 / 1, one capstone each", () => {
    expect(TALENTS).toHaveLength(24);
    expect(TALENTS.length * TALENT_MAX_RANK).toBe(120);
    for (const branch of TALENT_BRANCHES) {
      const talents = TALENTS.filter(entry => entry.branch === branch);
      expect(talents.filter(entry => entry.capstone).map(entry => entry.tier)).toEqual([4]);
      expect([1, 2, 3, 4].map(tier => talents.filter(entry => entry.tier === tier).length)).toEqual([3, 2, 2, 1]);
    }
  });
  it("names what every talent affects, and drops the lookout sight talent", () => {
    for (const entry of TALENTS) expect(entry.affects.length).toBeGreaterThan(0);
    expect(TALENTS.find(entry => entry.id === "hunterFisherSpeed")).toMatchObject({ affects: [18, 22], tier: 1 });
    expect(TALENTS.find(entry => entry.id === "towerArcherDamage")?.tier).toBe(1);
    expect(TALENTS.some(entry => entry.id === "lookoutSight")).toBe(false);
  });
  it("puts the capstones at the owner-confirmed levels 40, 45 and 50", () => {
    const capstones = Object.fromEntries(TALENTS.filter(entry => entry.capstone)
      .map(entry => [entry.id, entry.requiredLevel]));
    expect(capstones).toEqual({ colonyProduction: 40, soldierStrength: 50, tradeOfferSlot: 45 });
  });
  it("opens shipping with the harbour and the adventure talents after the army", () => {
    const levels = Object.fromEntries(TALENTS.map(entry => [entry.id, entry.requiredLevel]));
    expect(levels.shipping).toBe(buildingUnlockLevel(39));
    expect(levels.adventureExperience).toBeGreaterThan(buildingUnlockLevel(40));
  });
  it("opens tier 1 at level 1 and asks rising levels further down each branch", () => {
    for (const entry of TALENTS.filter(talent => talent.tier === 1)) expect(entry.requiredLevel).toBe(1);
    for (const branch of TALENT_BRANCHES) {
      const tiers = TALENTS.filter(entry => entry.branch === branch);
      for (const entry of tiers.filter(talent => talent.tier > 1)) {
        expect(entry.requiredLevel).toBeGreaterThan(1);
        const above = tiers.filter(talent => talent.tier < entry.tier);
        expect(entry.requiredLevel).toBeGreaterThan(Math.max(...above.map(talent => talent.requiredLevel)));
      }
    }
  });
});

describe("talent points and gates", () => {
  it("grants one point per level from level 1 (80 at level 80)", () => {
    expect(talentPointsForLevel(1)).toBe(1);
    expect(talentPointsForLevel(37)).toBe(37);
    expect(talentPointsForLevel(80)).toBe(80);
    expect(talentPointsForLevel(0)).toBe(1);
  });
  it("refuses a level-gated talent below its level and allows it at that level", () => {
    expect(talentRaiseCheck(ECONOMY_TIER_3, "fieldGrowth", 11)).toBe("Requires level 12");
    expect(talentRaiseCheck(ECONOMY_TIER_3, "fieldGrowth", 12)).toBe(true);
    expect(talentRanksError({ ...ECONOMY_TIER_3, fieldGrowth: 1 }, 11)).toMatch(/requires level 12/);
    expect(talentRanksError({ ...ECONOMY_TIER_3, fieldGrowth: 1 }, 12)).toBeNull();
  });
  it("opens tier 2 after 4 points in the branch's tier 1 and tier 3 after 4 in tier 2", () => {
    expect(TIER_GATE_POINTS).toBe(4);
    const three = { productionSpeed: 2, storageCapacity: 1 };
    expect(talentRaiseCheck(three, "constructionSpeed", 80)).toBe("Requires 4 points in tier 1 of this branch");
    // Points in another branch never count.
    expect(talentRaiseCheck({ ...three, populationLimit: 5 }, "constructionSpeed", 80))
      .toBe("Requires 4 points in tier 1 of this branch");
    expect(talentRaiseCheck({ ...three, hunterFisherSpeed: 1 }, "constructionSpeed", 80)).toBe(true);
    expect(talentRaiseCheck({ productionSpeed: 5, treeGrowth: 3 }, "fieldGrowth", 80))
      .toBe("Requires 4 points in tier 2 of this branch");
    expect(talentRaiseCheck({ productionSpeed: 5, treeGrowth: 4 }, "fieldGrowth", 80)).toBe(true);
    expect(talentRanksError({ ...three, constructionSpeed: 1 }, 80))
      .toMatch(/constructionSpeed requires 4 points in tier 1/);
    expect(talentRanksError({ fieldGrowth: 1, productionSpeed: 5, treeGrowth: 3 }, 80)).toMatch(/tier 2/);
  });
  it("needs a free point and stops at the highest rank", () => {
    expect(talentRaiseCheck({ productionSpeed: 1 }, "storageCapacity", 1)).toBe("No talent points left");
    expect(talentRaiseCheck(full("productionSpeed"), "productionSpeed", 80)).toBe("This talent is at its highest rank");
    expect(talentRaiseCheck({}, "unknown", 80)).toBe("Unknown talent");
    expect(raiseTalent({}, "productionSpeed", 1)).toEqual({ productionSpeed: 1 });
    expect(raiseTalent({ productionSpeed: 1 }, "productionSpeed", 1)).toEqual({ productionSpeed: 1 });
  });
  it("opens a capstone only after 20 points in its branch's other talents", () => {
    const nineteen = { ...ECONOMY_GATE, treeGrowth: 4 };
    expect(branchGatePoints(nineteen, "economy")).toBe(CAPSTONE_BRANCH_POINTS - 1);
    expect(talentRaiseCheck(nineteen, "colonyProduction", 80)).toBe("Requires 20 points in this branch");
    // Points in another branch never count.
    expect(talentRaiseCheck({ ...nineteen, populationLimit: 5 }, "colonyProduction", 80))
      .toBe("Requires 20 points in this branch");
    expect(talentRaiseCheck(ECONOMY_GATE, "colonyProduction", 80)).toBe(true);
    expect(talentRaiseCheck(ECONOMY_GATE, "colonyProduction", 39)).toBe("Requires level 40");
    expect(talentRanksError({ ...nineteen, colonyProduction: 1 }, 80)).toMatch(/branch points/);
  });
  it("validates shape, points within the level and gates", () => {
    expect(talentRanksError({ productionSpeed: 6 }, 80)).toBe("Invalid talent ranks");
    expect(talentRanksError({ productionSpeed: 1.5 }, 80)).toBe("Invalid talent ranks");
    expect(talentRanksError({ missing: 1 }, 80)).toBe("Invalid talent ranks");
    expect(talentRanksError([], 80)).toBe("Invalid talent ranks");
    expect(talentRanksError({ productionSpeed: 2 }, 1)).toBe("More talent points than the level grants");
    expect(talentRanksError({}, 1)).toBeNull();
  });
});

describe("talent modifiers", () => {
  it("adds per-rank values into one frozen, cached object", () => {
    const ranks = { colonyStartSettlers: 5, productionSpeed: 5, shipping: 3, soldierStrength: 5 };
    const modifiers = talentModifiers(ranks);
    expect(modifiers).toMatchObject({ colonyStartSettlers: 10, dockPorterSpeed: .15, productionSpeed: .1,
      shippingTimeReduction: .15, soldierDamage: .15, soldierHealth: .15, storageCapacity: 0 });
    expect(Object.isFrozen(modifiers)).toBe(true);
    expect(talentModifiers(ranks)).toBe(modifiers);
    expect(talentModifiers(undefined)).toBe(NEUTRAL_TALENT_MODIFIERS);
    expect(talentModifiers({ productionSpeed: 9 })).toBe(NEUTRAL_TALENT_MODIFIERS);
  });
  it("turns time reductions into durations and rates", () => {
    expect(reducedDuration(60, .25)).toBe(45);
    expect(timeReductionRate(.25)).toBeCloseTo(4 / 3);
    expect(maximumTalentModifier("tradeOfferSlots")).toBe(5);
    expect(maximumTalentModifier("handcartCapacity")).toBeCloseTo(.5);
  });
});

describe("apply and reset", () => {
  it("applies pending points that only add to the applied ranks", () => {
    const result = applyTalents(atLevel(5), { productionSpeed: 4, storageCapacity: 0, constructionSpeed: 1 });
    expect(result).toEqual({ ok: true, progress: expect.objectContaining({
      talents: { constructionSpeed: 1, productionSpeed: 4 } }) });
    const applied = (result as { progress: PlayerProgress }).progress;
    expect(applyTalents(applied, { productionSpeed: 1 })).toEqual({ ok: false,
      reason: "Applied talents can only be reset" });
    expect(applyTalents(applied, applied.talents)).toEqual({ ok: false, reason: "No new talent points to apply" });
    expect(applyTalents(atLevel(2), { fieldGrowth: 1 })).toEqual({ ok: false,
      reason: "Talent fieldGrowth requires level 12" });
  });
  it("refunds every applied point for 100 gems", () => {
    const progress = atLevel(10, { gems: TALENT_RESET_GEMS + 5, talents: { productionSpeed: 3 } });
    const result = resetAppliedTalents(progress);
    expect(result).toEqual({ ok: true, progress: expect.objectContaining({ gems: 5, talents: {} }) });
    expect(resetAppliedTalents({ ...progress, gems: 99 })).toEqual({ ok: false,
      reason: "Resetting talents costs 100 gems" });
    expect(resetAppliedTalents(atLevel(10, { gems: 500 }))).toEqual({ ok: false,
      reason: "No applied talents to reset" });
  });
});

describe("player progress with talents", () => {
  it("round-trips a saved tree and rejects one that breaks the rules", () => {
    const progress = atLevel(20, { talents: { constructionSpeed: 5, productionSpeed: 5 } });
    expect(validatePlayerProgress(JSON.parse(JSON.stringify(progress)))).toBe(true);
    expect(validatePlayerProgress(atLevel(2, { talents: { productionSpeed: 5 } }))).toBe(false);
    expect(validatePlayerProgress(atLevel(20, { talents: { ...ECONOMY_TIER_3, fieldGrowth: 1 } }))).toBe(true);
    expect(validatePlayerProgress(atLevel(11, { talents: { ...ECONOMY_TIER_3, fieldGrowth: 1 } }))).toBe(false);
    expect(validatePlayerProgress(atLevel(20, { talents: { fieldGrowth: 1 } }))).toBe(false);
  });
  it("pays daily quest experience and goods with the quest reward talent", () => {
    const quest = { amount: 1, done: false, experience: 100, id: "q", kind: "produce" as const, progress: 1,
      reward: { coins: 70, walnutPlanks: 5 }, ware: "logs" };
    const plain = completeQuest(atLevel(30, { quests: [quest] }), "q")!;
    const boosted = completeQuest(atLevel(30, { quests: [quest], talents: { questRewards: 5 } }), "q")!;
    expect(boosted.progress.experience - plain.progress.experience).toBe(25);
    expect(plain.goods).toEqual({ coins: 70, walnutPlanks: 5 });
    expect(boosted.goods).toEqual({ coins: 88, walnutPlanks: 6 });
  });
});
