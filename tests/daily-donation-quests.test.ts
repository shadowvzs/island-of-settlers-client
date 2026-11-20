import {
  dailyQuestGoods, deliveryWaresForLevel, LEVEL_THRESHOLDS, MAX_PLAYER_LEVEL, nationQuestWare
} from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { TOOL_WARES } from "../src/render-common/wares/ware-catalog";
import {
  type DailyQuest, deliveryQuestExperience, generateDailyQuests, migrateRetiredQuests, questAmount, questExperience
} from "../src/shared/progression/daily-quests";
import { completeQuest, createPlayerProgress, refreshQuests, validatePlayerProgress } from "../src/shared/progression/player-progress";

describe("daily disaster-relief donations", () => {
  it("registers only new relief, keeps early requests after harbour removal, and requires full cargo plus departure for one claim", () => {
    const generated = Array.from({ length: 40 }, (_, seed) => refreshQuests(createPlayerProgress(seed),
      "2026-10-28", TOOL_WARES, "roman", { reliefAvailable: true }))
      .find(progress => progress.quests[0]!.kind === "deliver")!;
    const quest = generated.quests[0]!, mission = generated.relief!.missions[0]!;
    expect(mission).toMatchObject({ questId: quest.id, stage: "awaiting-aid", loaded: 0, departed: false });
    expect(validatePlayerProgress(generated)).toBe(true);
    expect(refreshQuests(generated, "2026-10-28", TOOL_WARES, "roman", { reliefAvailable: false })).toBe(generated);
    expect(completeQuest(generated, quest.id)).toBeNull();
    const paid = { ...generated, relief: { version: 1 as const, missions: [{ ...mission,
      stage: "departing" as const, loaded: quest.amount }] } };
    expect(refreshQuests(paid, "2026-10-29", TOOL_WARES, "roman", { reliefAvailable: false })).toBe(paid);
    expect(completeQuest(paid, quest.id)).toBeNull();
    const forgedReady = { ...paid, relief: { version: 1 as const, missions: [{ ...paid.relief.missions[0]!,
      stage: "ready-to-claim" as const }] } };
    expect(validatePlayerProgress(forgedReady)).toBe(false);
    expect(completeQuest(forgedReady, quest.id)).toBeNull();
    const ready = { ...forgedReady, relief: { version: 1 as const, missions: [{ ...forgedReady.relief.missions[0]!,
      departed: true }] } };
    expect(validatePlayerProgress(ready)).toBe(true);
    const claimed = completeQuest(ready, quest.id)!;
    expect(claimed.progress.experience).toBe(generated.experience + quest.experience);
    expect(claimed.goods).toEqual(quest.reward);
    expect(claimed.progress.relief!.missions[0]!.stage).toBe("completed");
    expect(completeQuest(claimed.progress, quest.id)).toBeNull();
    const renewed = refreshQuests(claimed.progress, "2026-10-29", TOOL_WARES, "roman", { reliefAvailable: false });
    expect(renewed.questDay).toBe("2026-10-29"); expect(renewed.quests).toHaveLength(1);
    expect(refreshQuests(renewed, "2026-10-29", TOOL_WARES, "roman", { reliefAvailable: true })).toBe(renewed);
    const legacy = { ...generated, relief: undefined };
    expect(refreshQuests(legacy, "2026-10-28", TOOL_WARES, "roman", { reliefAvailable: true }).relief).toBeUndefined();
  });

  it("uses actual harbour capability for new generation and never rerolls today's quest when it changes", () => {
    for (const level of [1, 9, 10, 80]) {
      const kinds = new Set<string>();
      for (let seed = 0; seed < 40; seed++) {
        expect(generateDailyQuests("2026-10-28", level, seed, TOOL_WARES, "roman", {
          reliefAvailable: false
        })[0]!.kind).toBe("produce");
        kinds.add(generateDailyQuests("2026-10-28", level, seed, TOOL_WARES, "roman", {
          reliefAvailable: true
        })[0]!.kind);
      }
      expect(kinds).toEqual(new Set(["deliver", "produce"]));
    }
    const initial = refreshQuests(createPlayerProgress(7), "2026-10-28", TOOL_WARES, "roman", {
      reliefAvailable: false
    });
    expect(refreshQuests(initial, "2026-10-28", TOOL_WARES, "roman", { reliefAvailable: true })).toBe(initial);
    const withHarbour = Array.from({ length: 40 }, (_, seed) => refreshQuests({ ...createPlayerProgress(seed),
      experience: LEVEL_THRESHOLDS[19]! }, "2026-10-28", TOOL_WARES, "roman", { reliefAvailable: true }))
      .find(progress => progress.quests[0]!.kind === "deliver")!;
    expect(withHarbour).toBeDefined();
    expect(refreshQuests(withHarbour, "2026-10-28", TOOL_WARES, "roman", { reliefAvailable: false })).toBe(withHarbour);
  });

  it("retains paid unfinished quests across midnight until claim, then permits the current day's new roll", () => {
    const quest: DailyQuest = { amount: 13, done: false, experience: 55, id: "2026-10-27-0", kind: "deliver",
      progress: 0, reward: { coins: 50, cedarPlanks: 4 }, ware: "logs" };
    const saved = { ...createPlayerProgress(7), experience: LEVEL_THRESHOLDS[19]!, questDay: "2026-10-27", quests: [quest] };
    const context = { reliefAvailable: false, retainedQuestIds: new Set([quest.id]) };
    expect(refreshQuests(saved, "2026-10-28", TOOL_WARES, "roman", context)).toBe(saved);
    expect(refreshQuests(saved, "2026-10-29", TOOL_WARES, "roman", context)).toBe(saved);
    const claimed = { ...saved, quests: [{ ...quest, done: true }] };
    const renewed = refreshQuests(claimed, "2026-10-29", TOOL_WARES, "roman", context);
    expect(renewed.questDay).toBe("2026-10-29"); expect(renewed.quests).toHaveLength(1);
    expect(renewed.quests[0]!.kind).toBe("produce");
  });

  it("requests floor(level/2) plus a seeded1..5 and five percent of the full next-level XP step", () => {
    for (const level of [10, 11, 20, 31, 60, 79, MAX_PLAYER_LEVEL]) {
      const offsets = new Set<number>();
      for (let seed = 0; seed < 160; seed++) {
        const quests = generateDailyQuests("2026-10-28", level, seed, TOOL_WARES);
        expect(quests).toHaveLength(1);
        expect(quests).toEqual(generateDailyQuests("2026-10-28", level, seed, TOOL_WARES));
        const quest = quests[0]!;
        if (quest.kind === "produce") {
          expect(quest.amount).toBe(questAmount(quest.ware, level, TOOL_WARES));
          expect(quest.experience).toBe(questExperience(level));
        } else {
          const offset = quest.amount - Math.floor(level / 2);
          expect(offset).toBeGreaterThanOrEqual(1); expect(offset).toBeLessThanOrEqual(5);
          offsets.add(offset);
          expect(quest.experience).toBe(level === MAX_PLAYER_LEVEL ? 0 :
            Math.round((LEVEL_THRESHOLDS[level]! - LEVEL_THRESHOLDS[level - 1]!) * .05));
        }
        expect(quest.reward).toEqual(dailyQuestGoods(level, quest.ware));
      }
      expect(offsets).toEqual(new Set([1, 2, 3, 4, 5]));
    }
    expect(deliveryQuestExperience(10)).toBe(5);
    expect(deliveryQuestExperience(MAX_PLAYER_LEVEL)).toBe(0);
  });

  it("keeps level/tier/nation eligibility while excluding weapons, armor, coins, boats and horses only from donations", () => {
    const excluded = ["axe", "bow", "sword", "shield", "armor", "coins", "boat", "horse"];
    for (let level = 1; level <= MAX_PLAYER_LEVEL; level++) {
      expect(deliveryWaresForLevel(level).filter(ware => excluded.includes(ware))).toEqual([]);
      for (const seed of [1, 2, 7, 19, 31]) {
        const roman = generateDailyQuests("2026-10-28", level, seed, TOOL_WARES)[0]!;
        for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
          const quest = generateDailyQuests("2026-10-28", level, seed, TOOL_WARES, nation)[0]!;
          expect(quest.ware).toBe(nationQuestWare(roman.ware, nation));
          expect(quest.amount).toBe(roman.amount); expect(quest.experience).toBe(roman.experience);
          if (level < 10) expect(quest.kind).toBe("produce");
          if (quest.kind === "deliver") expect(excluded).not.toContain(quest.ware);
        }
      }
    }
    expect(deliveryWaresForLevel(80)).toEqual(expect.arrayContaining([
      "saw", "pickaxe", "shovel", "hammer", "fishingRod", "scythe", "crucible", "tongs", "rollingPin", "cleaver", "spyglass"
    ]));
  });

  it("honors saved same-day amounts, rewards and excluded legacy deliveries without adding serialized fields", () => {
    const quests: DailyQuest[] = ["axe", "bow", "sword", "shield", "coins"].map((ware, index) => ({
      amount: 71 + index, done: false, experience: 123 + index, id: `legacy-${index}`, kind: "deliver",
      progress: 0, reward: { coins: 17, mahoganyPlanks: 2 }, ware
    }));
    expect(migrateRetiredQuests(quests, 80)).toBe(quests);
    // Armor already belonged to a never-deliverable large-building tier: retain that older policy.
    const oldArmor = { ...quests[0]!, ware: "armor" };
    expect(migrateRetiredQuests([oldArmor], 80)).toEqual([{ ...oldArmor, kind: "produce" }]);
    const saved = { ...createPlayerProgress(7), experience: LEVEL_THRESHOLDS[79]!, questDay: "2026-10-28", quests };
    expect(validatePlayerProgress(saved)).toBe(true);
    expect(refreshQuests(saved, "2026-10-28")).toBe(saved);
    const tomorrow = refreshQuests(saved, "2026-10-29");
    expect(tomorrow.quests).toHaveLength(1);
    expect(Object.keys(tomorrow.quests[0]!).sort()).toEqual(Object.keys(quests[0]!).sort());
  });
});
