import { describe, expect, it } from "vitest";

import { awaySummaryText, discardedAwayText, summarizeTimeAway } from "../src/app/settlement/away-summary";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

const HOUR = 3_600_000;
const game = (savedAt: number, logs: number, experience: number, colonies: [number, string][] = []) => ({
  archipelago: { active: null, colonies: colonies.map(([expeditionId, name]) => ({ expeditionId, island: { name } })),
    version: 1 },
  player: { experience },
  savedAt,
  settlement: { storagePools: { version: 1, nextId: 1, pools: [
    { id: 0, owner: 0, anchor: 0, available: { logs, stone: 5 } }
  ] }, buildings: [
    { construction: 1, inventory: {}, storagePoolId: 0, typeId: 0 },
    { inventory: { logs: 1000 }, typeId: 1 },
    { inventory: { logs: 7 }, militaryFaction: 1, typeId: 29 }
  ] }
}) as unknown as GameSaveV1;

describe("while you were away", () => {
  it("sums the home storages' change, the experience and the colonies that ended", () => {
    const summary = summarizeTimeAway(game(0, 10, 100, [[1, "Gull Rock"], [2, "Fox Isle"]]),
      game(5 * HOUR, 130, 340, [[2, "Fox Isle"]]), 5 * HOUR);
    expect(summary).toEqual({ awaySeconds: 18_000, capped: false, endedColonies: ["Gull Rock"], experience: 240,
      goods: { logs: 120 } });
    expect(awaySummaryText(summary)).toBe("While you were away (5 h 0 min): Your storages gained 120 Softwood logs. " +
      "You earned 240 experience. The colony on Gull Rock ended.");
  });

  it("says when production stopped at the one-day cap, and nothing when nothing changed", () => {
    const summary = summarizeTimeAway(game(0, 10, 0), game(30 * HOUR, 10, 0), 30 * HOUR);
    expect(summary.capped).toBe(true);
    expect(awaySummaryText(summary)).toBe("While you were away (1 d 6 h): Production stopped after one day away.");
    expect(awaySummaryText(summarizeTimeAway(game(0, 10, 0), game(60_000, 10, 0), 60_000))).toBe("");
  });

  it("describes a discarded catch-up without presenting fake away gains", () => {
    expect(discardedAwayText(6 * 3_600, ["Gull Rock"])).toBe("Offline production for 6 h 0 min was discarded; " +
      "calendar deadlines advanced to now. The colony on Gull Rock ended.");
    expect(discardedAwayText(0, [])).toBe("");
  });
});
