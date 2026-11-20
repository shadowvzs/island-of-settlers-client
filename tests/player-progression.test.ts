import {
  BIG_QUEST_LEVEL, buildingExperience, dailyQuestGoods, deliveryWaresForLevel, LEVEL_THRESHOLDS,
  levelForExperience, levelProgress, levelUpReward, MAX_PLAYER_LEVEL, MEDIUM_QUEST_LEVEL, questWaresForLevel,
  SAWMILL_RECIPES
} from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { TOOL_WARES } from "../src/render-common/wares/ware-catalog";
import { isBuildingUnlocked } from "../src/shared/progression/building-unlocks";
import {
  type DailyQuest, generateDailyQuests, migrateRetiredQuests, questAmount, questExperience
} from "../src/shared/progression/daily-quests";
import {
  awardExperience, completeQuest, createPlayerProgress, questDayKey, recordProduction, refreshQuests,
  validatePlayerProgress
} from "../src/shared/progression/player-progress";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";

describe("player levels", () => {
  it("follows the 80-level curve: 100 XP per level at first, steep later, ×1.10 per step from 61", () => {
    expect(MAX_PLAYER_LEVEL).toBe(80);
    expect(LEVEL_THRESHOLDS.slice(0, 4)).toEqual([0, 100, 200, 300]);
    expect(LEVEL_THRESHOLDS[40]).toBe(412000);
    // From level 61 each step is ×1.10 of the previous (owner 2026-10-20).
    expect(LEVEL_THRESHOLDS[79]).toBe(494681000);
    expect(levelForExperience(99)).toBe(1);
    expect(levelForExperience(100)).toBe(2);
    expect(levelProgress(150)).toEqual({ current: 50, fraction: .5, level: 2, needed: 100 });
    expect(levelProgress(3e9)).toMatchObject({ fraction: 1, level: 80, needed: 0 });
  });

  it("pays coins every level and gems from level 10", () => {
    expect(levelUpReward(2)).toEqual({ coins: 9, gems: 0 });
    expect(levelUpReward(10)).toEqual({ coins: 25, gems: 5 });
    expect(levelUpReward(15).gems).toBe(10);
    expect(buildingExperience([4, 4])).toBe(5);
    expect(buildingExperience([5, 4])).toBe(10);
    expect(buildingExperience([6, 6])).toBe(20);
  });
});

describe("daily quests", () => {
  it("offers small-building wares first, then medium from level 10 and large from level 20", () => {
    // Colony-only materials join the quests at level 8 (owner 2026-10-20); other wares need their
    // building unlocked: Woodcutter 1, Quarry 2, Fishery and Hunter 3, Well 4.
    expect(questWaresForLevel(1)).toEqual(["logs"]);
    expect(questWaresForLevel(2)).toEqual(["logs", "stone"]);
    expect(questWaresForLevel(4)).toEqual(["fish", "logs", "meat", "stone", "water"]);
    expect(questWaresForLevel(6)).toContain("cloth");
    expect(questWaresForLevel(4)).not.toContain("cloth");
    expect(questWaresForLevel(18)).toContain("hardwoodLogs");
    expect(questWaresForLevel(1)).not.toContain("cedarLogs");
    expect(questWaresForLevel(MEDIUM_QUEST_LEVEL)).toContain("planks");
    expect(questWaresForLevel(MEDIUM_QUEST_LEVEL)).not.toContain("grain");
    expect(questWaresForLevel(BIG_QUEST_LEVEL)).toContain("grain");
    expect(questWaresForLevel(80)).not.toContain("horse");
  });

  it("scales amounts and experience with level and keeps a day's quests stable", () => {
    expect(questAmount("logs", 1)).toBeLessThan(questAmount("logs", 20));
    expect(questAmount("sword", 20, TOOL_WARES)).toBeLessThan(questAmount("logs", 20));
    expect(questExperience(1)).toBe(30);
    expect(questExperience(20)).toBe(330);
    const quests = generateDailyQuests("2026-10-12", MEDIUM_QUEST_LEVEL, 7);
    expect(quests).toEqual(generateDailyQuests("2026-10-12", MEDIUM_QUEST_LEVEL, 7));
    // One daily quest per day (owner 2026-10-20); seeds and days vary its kind once deliveries exist.
    expect(quests).toHaveLength(1);
    const kinds = new Set(Array.from({ length: 20 }, (_, seed) =>
      generateDailyQuests("2026-10-12", MEDIUM_QUEST_LEVEL, seed)[0]!.kind));
    expect(kinds).toEqual(new Set(["deliver", "produce"]));
  });

  it("has no paying delivery quests before level 10, only production quests", () => {
    for (let level = 1; level < MEDIUM_QUEST_LEVEL; level++)
      for (let seed = 0; seed < 20; seed++)
        expect(generateDailyQuests("2026-10-12", level, seed).every(quest => quest.kind === "produce")).toBe(true);
    expect(deliveryWaresForLevel(MEDIUM_QUEST_LEVEL - 1)).toEqual([]);
  });

  it("never asks for or pays colony-only materials below level 18", () => {
    const colonyMaterials = /^(hardwood|cedar|walnut|mahogany|marble|limestone|basalt|granite)/;
    for (let level = 1; level < 18; level++) {
      expect(questWaresForLevel(level).filter(ware => colonyMaterials.test(ware)), `level ${level}`).toEqual([]);
      for (const ware of questWaresForLevel(level))
        expect(Object.keys(dailyQuestGoods(level, ware)).filter(entry => colonyMaterials.test(entry))).toEqual([]);
    }
  });

  it("never asks for a ware before a building that makes it is unlocked", () => {
    const colonyMaterials = new Set(["hardwoodLogs", "marble", "hardwoodPlanks"]);
    for (let level = 1; level <= 30; level++)
      for (const ware of questWaresForLevel(level).filter(entry => !colonyMaterials.has(entry))) {
        const makers = BUILDING_CATALOG.filter(entry => PRODUCTION_RULES[entry.id]?.outputs.includes(ware) ||
          (entry.id === 33 && SAWMILL_RECIPES.some(recipe=>recipe.output === ware)));
        expect(makers.some(entry => isBuildingUnlocked(entry.id, level)), `${ware} at ${level}`).toBe(true);
      }
  });

  it("asks deliveries only of wares whose production quests came a tier earlier", () => {
    // Colony materials keep their own level gates (owner 2026-10-18), so a tier's deliveries are the
    // production wares offered just before that tier: cedar (level 15) is deliverable from level 20.
    const donationEligible = (wares: string[]) => wares.filter(ware =>
      !["axe", "bow", "sword", "shield", "armor", "coins"].includes(ware));
    expect(deliveryWaresForLevel(MEDIUM_QUEST_LEVEL)).toEqual(donationEligible(questWaresForLevel(MEDIUM_QUEST_LEVEL - 1)));
    expect(deliveryWaresForLevel(BIG_QUEST_LEVEL)).toEqual(donationEligible(questWaresForLevel(BIG_QUEST_LEVEL - 1)));
    expect(deliveryWaresForLevel(22)).toContain("cedarPlanks");
    expect(deliveryWaresForLevel(BIG_QUEST_LEVEL)).not.toContain("walnutPlanks");
    expect(deliveryWaresForLevel(80)).not.toContain("grain");
    for (const level of [MEDIUM_QUEST_LEVEL, BIG_QUEST_LEVEL, 40]) {
      const deliverable = deliveryWaresForLevel(level);
      const deliveries = Array.from({ length: 20 }, (_, seed) => generateDailyQuests("2026-10-12", level, seed))
        .flat().filter(quest => quest.kind === "deliver");
      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries.every(quest => deliverable.includes(quest.ware))).toBe(true);
    }
  });

  it("turns a removed early delivery quest of an old save into the matching production quest", () => {
    const quest = (overrides: Partial<DailyQuest>): DailyQuest => ({ amount: 8, done: false, experience: 30,
      id: "2026-10-12-0", kind: "deliver", progress: 0, reward: {}, ware: "logs", ...overrides });
    const quests = [quest({}), quest({ id: "b", kind: "produce", progress: 3, ware: "fish" }),
      quest({ done: true, id: "c", ware: "meat" })];
    expect(migrateRetiredQuests(quests, 1)).toEqual([quest({ kind: "produce" }), quests[1], quests[2]]);
    expect(migrateRetiredQuests(quests, MEDIUM_QUEST_LEVEL)).toBe(quests);
    const planks = [quest({ ware: "planks" })];
    expect(migrateRetiredQuests(planks, MEDIUM_QUEST_LEVEL)[0]!.kind).toBe("produce");
    expect(migrateRetiredQuests(planks, BIG_QUEST_LEVEL)).toBe(planks);
  });
});

describe("player progress", () => {
  it("renews quests per calendar day, counts production and awards level-ups", () => {
    let progress = refreshQuests(createPlayerProgress(7), questDayKey(Date.UTC(2026, 9, 12, 23)));
    expect(progress.questDay).toBe("2026-10-12");
    expect(refreshQuests(progress, "2026-10-12")).toBe(progress);
    expect(progress.quests.every(quest => quest.kind === "produce")).toBe(true);
    const produce = progress.quests.find(quest => quest.kind === "produce")!;
    expect(completeQuest(progress, produce.id)).toBeNull();
    progress = recordProduction(progress, produce.ware, produce.amount + 5);
    expect(progress.quests.find(quest => quest.id === produce.id)!.progress).toBe(produce.amount);
    const done = completeQuest(progress, produce.id)!;
    expect(done.progress.experience).toBe(30);
    expect(completeQuest(done.progress, produce.id)).toBeNull();
    const leap = awardExperience(done.progress, 1000);
    expect(leap.levelUps.map(entry => entry.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(leap.progress.gems).toBe(10);
    expect(validatePlayerProgress(leap.progress)).toBe(true);
    expect(validatePlayerProgress({ ...leap.progress, gems: -1 })).toBe(false);
  });

  it("loads an old save holding a removed early delivery quest as a production quest", () => {
    const saved = { ...createPlayerProgress(7), questDay: "2026-10-12", quests: [{ amount: 8, done: false,
      experience: 30, id: "2026-10-12-0", kind: "deliver" as const, progress: 0, reward: {}, ware: "fish" }] };
    expect(validatePlayerProgress(saved)).toBe(true);
    const loaded = refreshQuests(saved, "2026-10-12");
    expect(loaded.quests).toEqual([{ ...saved.quests[0], kind: "produce" }]);
    expect(refreshQuests(loaded, "2026-10-12")).toBe(loaded);
  });
});

describe("daily quest goods (owner 2026-10-20)", () => {
  it("pays coins and the newest unlocked material, stone for stone and mining quests", () => {
    expect(dailyQuestGoods(1, "logs")).toEqual({ coins: 12, planks: 2 });
    expect(dailyQuestGoods(7, "stone")).toEqual({ coins: 24, stone: 2 });
    expect(dailyQuestGoods(8, "logs")).toEqual({ coins: 26, planks: 2 });
    expect(dailyQuestGoods(10, "ironOre")).toEqual({ coins: 30, stone: 3 });
    expect(dailyQuestGoods(20, "bread")).toEqual({ coins: 50, hardwoodPlanks: 4 });
    expect(dailyQuestGoods(40, "stone")).toEqual({ coins: 90, granite: 6 });
    expect(dailyQuestGoods(80, "sword")).toEqual({ coins: 170, mahoganyPlanks: 10 });
    const generated = generateDailyQuests("2026-10-20", 20, 5)[0]!;
    expect(generated.reward).toEqual(dailyQuestGoods(20, generated.ware));
  });
});
