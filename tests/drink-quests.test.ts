import { nationQuestWare } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { type DailyQuest, generateDailyQuests, migrateNationQuests } from "../src/shared/progression/daily-quests";
import {
  createPlayerProgress, migratePlayerProgress, refreshQuests, validatePlayerProgress
} from "../src/shared/progression/player-progress";

describe("player progress after the Temple's removal", () => {
  /** Progress saved while blessings existed: points, typed or single scrolls and running blessings. */
  const blessed = { ...createPlayerProgress(5), blessingPoints: 3,
    blessings: [{ island: null, remaining: 60, type: "economy" }], scrolls: { economy: 1, logistic: 0, military: 1 } };

  it("drops scrolls, blessing points and running blessings on load", () => {
    const migrated = migratePlayerProgress(blessed);
    expect(migrated).toEqual(createPlayerProgress(5));
    expect(validatePlayerProgress(migrated)).toBe(true);
    expect(migratePlayerProgress({ ...createPlayerProgress(5), blessings: [], scrolls: 2 }))
      .toEqual(createPlayerProgress(5));
  });

  it("returns current progress unchanged and starts a session from old progress", () => {
    const current = createPlayerProgress(5);
    expect(migratePlayerProgress(current)).toBe(current);
    const session = createPlayerSession({ initial: blessed as never, seed: 5, now: () => Date.UTC(2026, 9, 19) });
    expect(session.progress()).not.toHaveProperty("scrolls");
    expect(session.progress()).not.toHaveProperty("blessings");
  });
});

describe("drink quests follow the player nation", () => {
  const day = "2026-10-13";
  it("maps the Roman grape and wine quests onto the nation's chain with the same roll", () => {
    expect(nationQuestWare("wine", "viking")).toBe("mead");
    expect(nationQuestWare("grapes", "nubian")).toBe("coconut");
    expect(nationQuestWare("toddy", "roman")).toBe("wine");
    expect(nationQuestWare("logs", "japanese")).toBe("logs");
    for (let level = 1; level <= 40; level += 3) {
      const roman = generateDailyQuests(day, level, 7);
      const japanese = generateDailyQuests(day, level, 7, new Set(), "japanese");
      expect(japanese.map(quest => quest.ware)).toEqual(roman.map(quest => nationQuestWare(quest.ware, "japanese")));
      expect(japanese.map(quest => quest.amount)).toEqual(roman.map(quest => quest.amount));
    }
  });

  it("converts today's quests of another chain and keeps the same list when nothing changes", () => {
    const quests: DailyQuest[] = [{ amount: 4, done: false, experience: 9, id: "a", kind: "deliver", progress: 0, reward: {},
      ware: "wine" }];
    expect(migrateNationQuests(quests, "roman")).toBe(quests);
    expect(migrateNationQuests(quests, "viking")[0]!.ware).toBe("mead");
    const progress = { ...createPlayerProgress(7), experience: 99999, questDay: day, quests };
    expect(refreshQuests(progress, day, new Set(), "viking").quests[0]).toMatchObject({ kind: "deliver",
      ware: "mead" });
  });
});
