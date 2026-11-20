import { expect, it } from "vitest";

import { canClaimReliefQuest, type ReliefQuestState, retainedReliefQuestIds, returnReliefQuests,
  validateReliefQuestState } from "../src/shared/progression/relief-quests";

it("returns only explicit matching paid aid, without reward eligibility or next-day retention", () => {
  const mission = { questId: "2026-10-28-0", day: "2026-10-28", ware: "fish", amount: 4,
    stage: "loading" as const, loaded: 0, departed: false, islandSeed: 7, harbourUid: 0 };
  const paid: ReliefQuestState = { version: 1, missions: [mission] };
  const receipt = { questId: mission.questId, ware: mission.ware, amount: 4, islandSeed: 7, harbourUid: 0 };
  expect(returnReliefQuests(paid, [{ ...receipt, amount: 5 }])).toBe(paid);
  expect(returnReliefQuests(paid, [{ ...receipt, islandSeed: 8 }])).toBe(paid);
  const returned = returnReliefQuests(paid, [receipt])!;
  expect(returned.missions[0]!.stage).toBe("returned");
  expect(canClaimReliefQuest(returned, mission.questId)).toBe(false);
  expect(retainedReliefQuestIds(returned).size).toBe(0);
  expect(validateReliefQuestState(returned)).toBe(true);
  expect(returnReliefQuests(returned, [receipt])).toBe(returned);
  for (const stage of ["awaiting-aid", "completed", "ready-to-claim"] as const) {
    const state: ReliefQuestState = { version: 1, missions: [{ ...mission, stage,
      loaded: stage === "awaiting-aid" ? 0 : 4, departed: stage !== "awaiting-aid" }] };
    expect(returnReliefQuests(state, [receipt])).toBe(state);
  }
});
