import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { validatePlayerProgress } from "../src/shared/progression/player-progress";
import { HOME_TUTORIAL_QUESTS as TUTORIAL_QUESTS } from "../src/shared/quests/home-quest-book";
import type { HomeIslandFacts as TutorialFacts } from "../src/shared/quests/home-quest-facts";
import { validHomeQuestProgress as validTutorialProgress } from "../src/shared/quests/home-quest-save";
import {
  type HomeQuestProgress as TutorialProgress, homeQuestSummary as tutorialSummary,
  recordHomeQuestEvent as recordTutorialEvent, refreshHomeQuests as refreshTutorial
} from "../src/shared/quests/home-quests";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { createSettlementTrade } from "../src/shared/trade/settlement-trade";
import {
  activeHomeQuestId, claimAt as claimTutorial, completedOf, NO_ISLAND_FACTS as empty, stateBefore, unstarted
} from "./helpers/home-quest-state";

const harbour: TutorialFacts = { buildings: [{ construction: 1, inventory: {}, typeId: 39 }], soldiers: [] };
const indexOf = (id: string) => TUTORIAL_QUESTS.findIndex(quest => quest.id === id);
const reload = (state: TutorialProgress): TutorialProgress => JSON.parse(JSON.stringify(state));

describe("one-time feature tours", () => {
  it("closes the timber chapter with the talent tour and places the trade tour right after the harbour", () => {
    const talent = indexOf("talent.apply"), trade = indexOf("sea.trade-offer");
    expect(TUTORIAL_QUESTS[talent - 1]!.id).toBe("wood.logs");
    expect(TUTORIAL_QUESTS[talent + 1]!.id).toBe("supply.reserve-1");
    expect(TUTORIAL_QUESTS[talent]).toMatchObject({ chapter: 1, experience: 20,
      objective: { amount: 1, countsBeforeUnlock: true, event: "talent", kind: "event" } });
    expect(TUTORIAL_QUESTS[trade - 1]!.id).toBe("sea.harbour");
    expect(TUTORIAL_QUESTS[trade]).toMatchObject({ chapter: 18, experience: 15,
      objective: { amount: 1, countsBeforeUnlock: true, event: "trade-offer", kind: "event" } });
  });

  it("unlocks the trade tour only once the harbour step is claimed", () => {
    const beforeHarbour = stateBefore("sea.harbour");
    expect(activeHomeQuestId(beforeHarbour)).toBe("sea.harbour");
    const claimed = claimTutorial(beforeHarbour, harbour)!;
    expect(activeHomeQuestId(refreshTutorial(claimed.state, 80, "roman"))).toBe("sea.trade-offer");
    expect(activeHomeQuestId(refreshTutorial(claimed.state, 5, "roman"))).toBeNull();
  });

  it("unlocks the talent tour at level 1, when the first talent point exists", () => {
    expect(activeHomeQuestId(stateBefore("talent.apply", 1))).toBe("talent.apply");
  });

  it("completes with one action, also one taken before the step unlocked, and pays once", () => {
    for (const [id, key] of [["talent.apply", "talent"], ["sea.trade-offer", "trade-offer"]] as const) {
      const waiting = stateBefore(id);
      expect(tutorialSummary(waiting, empty, true).ready).toBe(false);
      const done = recordTutorialEvent(waiting, key);
      expect(tutorialSummary(done, empty, true)).toMatchObject({ progress: 1, ready: true });
      const earlier = refreshTutorial(recordTutorialEvent(unstarted(waiting), key), 80, "roman");
      expect(tutorialSummary(earlier, empty, true).ready).toBe(true);
      const claimed = claimTutorial(done, empty)!;
      expect(claimed.experience).toBe(TUTORIAL_QUESTS[indexOf(id)]!.experience);
      const next = refreshTutorial(claimed.state, 80, "roman");
      expect(activeHomeQuestId(next)).not.toBe(id);
      expect(claimTutorial(claimed.state, empty)).toBeNull();
      expect(TUTORIAL_QUESTS.filter(quest => quest.id === id)).toHaveLength(1);
    }
  });

  it("keeps an unclaimed action across save and reload", () => {
    const state = reload(recordTutorialEvent(stateBefore("sea.trade-offer"), "trade-offer"));
    expect(validTutorialProgress(state)).toBe(true);
    expect(tutorialSummary(state, empty, true).ready).toBe(true);
  });
});

const storage = (uid: number, typeId: number, inventory: Record<string, number>) => ({
  access: { x: 0, z: 0 }, construction: 1, incoming: {}, input: {}, inventory, output: {}, required: {}, typeId, uid
}) as unknown as SettlementBuilding;

describe("feature tour events from the real actions", () => {
  it("records a placed trade offer that nobody accepted, and nothing for a refused one", () => {
    const events: string[] = [];
    const context = { actors: [], buildings: [storage(1, 0, { planks: 400 }), storage(2, 39, {})],
      options: { now: () => 5_000, onTutorialEvent: (key: string) => events.push(key), playerLevel: () => 1,
        world: { seed: 7 } } } as unknown as SettlementContext;
    const trade = createSettlementTrade(context);
    expect(trade.placeOffer({ amount: 9999, ware: "planks" }, { amount: 10, ware: "fish" })).not.toBe(true);
    expect(events).toEqual([]);
    expect(trade.placeOffer({ amount: 20, ware: "planks" }, { amount: 10, ware: "fish" })).toBe(true);
    expect(events).toEqual(["trade-offer"]);
    expect(trade.snapshot().offers).toHaveLength(1);
    expect(trade.snapshot().deliveries).toEqual([]);
  });

  it("records a talent Apply on any island and claims the tour after reload", () => {
    const island = (typeId: number) => ({
      buildings: () => [], home: () => ({ typeId }),
      claimQuest: () => true, islandRole: () => typeId === 0 ? "home" : "colony", militarySoldiers: () => [], playerNation: () => "roman",
      receiveHomeGoods: () => true, setTalentRanks: () => true
    }) as unknown as SettlementSimulation;
    const session = createPlayerSession({ now: Date.now, seed: 5 });
    session.bind(island(0));
    session.bind(island(39));
    expect(session.applyTalents({ productionSpeed: 1 })).toBe(true);
    expect(session.applyTalents({ productionSpeed: 1 })).not.toBe(true);
    expect(session.progress().questBook!.counters.talent).toBe(1);
    const before = stateBefore("talent.apply");
    const saved = JSON.parse(JSON.stringify({ ...session.progress(),
      questBook: { ...unstarted(before), counters: session.progress().questBook!.counters } }));
    expect(validatePlayerProgress(saved)).toBe(true);
    const restored = createPlayerSession({ now: Date.now, initial: saved, seed: 5 });
    restored.bind(island(0));
    expect(restored.tutorialSummary()).toMatchObject({ quest: { id: "talent.apply" }, ready: true });
    expect(restored.completeQuest("talent.apply")).toBe(true);
    expect(restored.completeQuest("talent.apply")).not.toBe(true);
    expect(completedOf(restored.progress().questBook!).filter(id => id === "talent.apply")).toEqual(["talent.apply"]);
  });
});
