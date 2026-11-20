import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { getQuestDetails, getQuestTabs, isSameQuestBook, selectQuestBook } from "../src/app/settlement-ui/quests/helpers";
import { QuestDetailPane } from "../src/app/settlement-ui/quests/quest-details";
import type { SettlementPlayerSummary } from "../src/app/settlement-ui/types";
import type { DailyQuest } from "../src/shared/progression/daily-quests";
import type { ReliefQuestStatus } from "../src/shared/progression/relief-quests";
import { renderWithI18n } from "./helpers/render-with-i18n";

const quest: DailyQuest = { id: "2026-10-28-0", amount: 10, done: false, experience: 5,
  kind: "deliver", progress: 0, reward: { coins: 20 }, ware: "logs" };
const mission: ReliefQuestStatus = { questId: quest.id, day: "2026-10-28", ware: "logs", amount: 10,
  loaded: 0, departed: false, stage: "awaiting-aid" };
const book = (status: Partial<ReliefQuestStatus>, stored = 0, done = false) => selectQuestBook({
  player: { nation: "roman", level: 10, experience: 900, current: 0, needed: 100, fraction: 0,
    gems: 0, talents: {}, quests: [{ ...quest, done }], stock: { logs: stored },
    reliefQuests: { [quest.id]: { ...mission, ...status } } } satisfies SettlementPlayerSummary
});

describe("physical relief quest presentation", () => {
  it("permits aid at another eligible island without requiring duplicate active-island stock", () => {
    const details = getQuestDetails(book({ payable: true, available: 10 }), quest.id);
    expect(details).toMatchObject({ claimDisabled: false, claimLabel: "Pay aid",
      relief: { stageLabel: "Awaiting aid", amount: 10, ware: "logs" } });
    expect(getQuestDetails(book({ payable: false, available: 0 }), quest.id)).toMatchObject({ claimDisabled: true });
  });
  it("keeps rewards locked during collection and departure even when storage has surplus wares", () => {
    for (const stage of ["paid-awaiting-ship", "loading", "departing"] as const) {
      const current = book({ stage, loaded: 10 }, 999);
      expect(getQuestDetails(current, quest.id)).toMatchObject({ claimDisabled: true,
        relief: { stage, loaded: "Loaded: 10 / 10" } });
      expect(getQuestTabs(current, quest.id).daily[0]!.className).not.toContain("is-ready");
    }
    expect(getQuestDetails(book({ stage: "ready-to-claim", loaded: 10, departed: false }), quest.id))
      .toMatchObject({ claimDisabled: true });
    const ready = book({ stage: "ready-to-claim", loaded: 10, departed: true });
    expect(getQuestDetails(ready, quest.id)).toMatchObject({ claimDisabled: false, claimLabel: "Claim reward" });
    expect(getQuestTabs(ready, quest.id).daily[0]!.className).toContain("is-ready");
  });
  it("shows the saved status and payment ware directly inside the selected quest", () => {
    const details = getQuestDetails(book({ stage: "loading", loaded: 4, blocker: "Waiting for a free berth" }), quest.id);
    const html = renderWithI18n(createElement(QuestDetailPane, { details,
      onClaim: () => {}, onShow: () => {}, onSkip: () => {} }));
    expect(html).toContain('data-relief-stage="loading"');
    expect(html).toContain("Loading aid");
    expect(html).toContain("Loaded: 4 / 10");
    expect(html).toContain("Waiting for a free berth");
    expect(html).toContain("Aid paid");
    expect(html).toContain("ware-icons/logs");
    expect(html).toContain("quest-relief__illustration");
  });
  it("shows returned aid as closed and cannot pay or claim it even with surplus stock", () => {
    const returned = book({ stage: "returned", loaded: 0, departed: false, payable: true }, 999);
    expect(getQuestDetails(returned, quest.id)).toMatchObject({ claimDisabled: true, claimLabel: "Closed",
      relief: { stageLabel: "Aid returned", paymentLabel: "Aid returned" } });
    expect(getQuestTabs(returned, quest.id).daily[0]!.className).not.toContain("is-ready");
  });
  it("retains completed relief for its current quest list and only refreshes actual status changes", () => {
    const completed = book({ stage: "completed", loaded: 10, departed: true }, 0, true);
    expect(completed.quests).toHaveLength(1);
    expect(getQuestDetails(completed, quest.id)).toMatchObject({ claimDisabled: true,
      relief: { stageLabel: "Completed" } });
    const a = book({ stage: "loading", loaded: 4 });
    expect(isSameQuestBook(a, { ...a, reliefQuests: { [quest.id]: { ...a.reliefQuests![quest.id]! } } })).toBe(true);
    expect(isSameQuestBook(a, { ...a, reliefQuests: { [quest.id]: { ...a.reliefQuests![quest.id]!, loaded: 5 } } })).toBe(false);
  });
});
