import { describe, expect, it } from "vitest";

import { activeQuests, claimableQuestCount, type DailyQuest } from "../src/shared/progression/daily-quests";

const quest = (id: string, overrides: Partial<DailyQuest>): DailyQuest =>
  ({ amount: 10, done: false, experience: 20, id, kind: "deliver", progress: 0, reward: {}, ware: "logs", ...overrides });

const quests = [
  quest("claimed", { done: true }),
  quest("deliver", { ware: "stone" }),
  quest("produce", { kind: "produce", progress: 10, ware: "planks" }),
  quest("unfinished", { kind: "produce", progress: 4, ware: "fish" })
];

describe("quest list", () => {
  it("drops claimed quests and keeps the order of the open ones", () => {
    expect(activeQuests(quests).map(entry => entry.id)).toEqual(["deliver", "produce", "unfinished"]);
  });

  it("counts deliveries covered by stock and finished production, never claimed quests", () => {
    expect(claimableQuestCount(quests, { logs: 99 })).toBe(1);
    expect(claimableQuestCount(quests, { logs: 99, stone: 10 })).toBe(2);
    expect(claimableQuestCount([], { logs: 99 })).toBe(0);
  });
});
