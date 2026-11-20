import { deliveryWaresForLevel, isMaterialAvailable, questWaresForLevel } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { type DailyQuest, generateDailyQuests, migrateRetiredQuests } from "../src/shared/progression/daily-quests";

describe("quest material unlocks", () => {
  it("never generates unavailable materials across discovery thresholds and cached level bands", () => {
    for (const level of [1, 10, 14, 15, 20, 29, 30, 45, 46]) {
      for (const ware of [...questWaresForLevel(level), ...deliveryWaresForLevel(level)])
        expect(isMaterialAvailable(ware, level), `${ware} at ${level}`).toBe(true);
      for (let seed = 0; seed < 30; seed++) for (const quest of generateDailyQuests("2026-10-18", level, seed))
        expect(isMaterialAvailable(quest.ware, level), `${quest.ware} at ${level}`).toBe(true);
    }
  });
  it("follows the spread late building unlocks for gold ore and coins", () => {
    expect(questWaresForLevel(18)).not.toContain("goldOre");
    expect(questWaresForLevel(18)).not.toContain("coins");
    expect(questWaresForLevel(19)).toContain("goldOre");
    expect(questWaresForLevel(19)).not.toContain("coins");
    expect(questWaresForLevel(21)).toContain("coins");
    for (let level = 18; level <= 30; level++)
      for (let seed = 0; seed < 30; seed++)
        for (const quest of generateDailyQuests("2026-10-18", level, seed))
          expect(questWaresForLevel(level), `${quest.ware} at ${level}`).toContain(quest.ware);
  });

  it("preserves existing paid and unclaimed advanced-material quest terms", () => {
    const quests: DailyQuest[] = [{ id: "old", kind: "deliver", ware: "limestone", amount: 21, progress: 0, experience: 10, done: false, reward: {} }];
    expect(migrateRetiredQuests(quests, 10)).toBe(quests);
    quests[0]!.done = true;
    expect(migrateRetiredQuests(quests, 10)).toBe(quests);
  });
});
