import { nationQuestWare } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import {
  createPlayerProgress,
  migratePlayerProgress,
  validatePlayerProgress
} from "../src/shared/progression/player-progress";
import { HOME_TUTORIAL_QUESTS as TUTORIAL_QUESTS } from "../src/shared/quests/home-quest-book";
import type { HomeIslandFacts as TutorialFacts } from "../src/shared/quests/home-quest-facts";
import { validHomeQuestProgress as validTutorialProgress } from "../src/shared/quests/home-quest-save";
import { homeQuestTitle as tutorialTitle } from "../src/shared/quests/home-quest-text";
import {
  createHomeQuestProgress, homeQuestSummary as tutorialSummary, recordHomeQuestEvent as recordTutorialEvent,
  refreshHomeQuests as refreshTutorial
} from "../src/shared/quests/home-quests";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import {
  activeHomeQuestId, claimAt as claimTutorial, claimedQuests, completedOf, NO_ISLAND_FACTS as empty, progressWith,
  skippedOf, stateAt as stateFor, unstarted
} from "./helpers/home-quest-state";

/** QU5: the code tutorial's progression tests, unchanged, against the default home book runtime. */
const owned = (typeId: number, amount = 1) =>
  Array.from({ length: amount }, () => ({ typeId, construction: 1, inventory: {} }));
const home = (typeId = 0, buildings: readonly number[] = [17]) =>
  ({
    headquarters: { typeId },
    home: () => ({ typeId }),
    islandRole: () => typeId === 0 ? "home" : "colony",
    playerNation: () => "roman",
    buildings: () => buildings.flatMap(type => owned(type)),
    claimQuest: () => true,
    militarySoldiers: () => [],
    setTalentRanks: () => true
  }) as unknown as SettlementSimulation;

describe("tutorial progression", () => {
  it.each(
    TUTORIAL_QUESTS.flatMap((quest, index) =>
      quest.objective.kind === "build" ? [{ quest, index }] : []
    )
  )("makes an existing owned building claimable for $quest.id", ({ index, quest }) => {
    if (quest.objective.kind !== "build") throw new Error("build objective");
    const facts = { ...empty, buildings: owned(quest.objective.building, quest.objective.amount) };
    const state = stateFor(index);
    expect(tutorialSummary(state, facts, true).ready).toBe(true);
    const claim = claimTutorial(state, facts)!;
    expect(claim.experience).toBe(quest.experience);
    expect(claimTutorial(claim.state, facts)).toBeNull();
    expect(
      tutorialSummary(
        state,
        { ...facts, buildings: [{ ...facts.buildings[0]!, construction: 0.99 }] },
        true
      ).ready
    ).toBe(false);
    expect(
      tutorialSummary(
        state,
        { ...facts, buildings: [{ ...facts.buildings[0]!, militaryFaction: 1 }] },
        true
      ).ready
    ).toBe(false);
  });
  it("asks for two small residences in chapter 2, where they are unlocked", () => {
    const step = TUTORIAL_QUESTS.find(quest => quest.id === "settlers.residence")!;
    expect(step.objective).toEqual({ amount: 2, building: 57, kind: "build" });
    expect(step.chapter).toBe(2);
    expect(step.chapter).toBeGreaterThanOrEqual(buildingUnlockLevel(57));
    expect(tutorialTitle(step, "roman")).toBe("Build 2 Small residences");
    const state = stateFor(TUTORIAL_QUESTS.indexOf(step));
    expect(tutorialSummary(state, { ...empty, buildings: owned(57) }, true).ready).toBe(false);
    expect(tutorialSummary(state, { ...empty, buildings: owned(57, 2) }, true).ready).toBe(true);
  });

  it("requires the second paid Pig breeder instead of reusing the first one", () => {
    const step = TUTORIAL_QUESTS.find(quest => quest.id === "food.pigs-second")!;
    const state = stateFor(TUTORIAL_QUESTS.indexOf(step));
    expect(tutorialSummary(state, { ...empty, buildings: owned(28) }, true).ready).toBe(false);
    expect(tutorialSummary(state, { ...empty, buildings: owned(28, 2) }, true).ready).toBe(true);
  });

  it("counts new production since activation, across save and reload", () => {
    const logs = TUTORIAL_QUESTS.findIndex(quest => quest.id === "wood.logs");
    let state = recordTutorialEvent(refreshTutorial(progressWith("japanese",
      TUTORIAL_QUESTS.slice(0, logs - 1).map(quest => quest.id)), 1, "japanese"), "produce:logs", 100);
    state = recordTutorialEvent(state, "plant", 10);
    state = refreshTutorial(claimTutorial(state, empty)!.state, 1, "japanese");
    expect(activeHomeQuestId(state)).toBe("wood.logs");
    expect(tutorialSummary(state, empty, true).progress).toBe(0);
    state = JSON.parse(JSON.stringify(recordTutorialEvent(state, "produce:logs", 19)));
    expect(validTutorialProgress(state)).toBe(true);
    expect(claimTutorial(state, empty)).toBeNull();
    expect(claimTutorial(recordTutorialEvent(state, "produce:logs"), empty)?.experience).toBe(20);
  });
  it.each(["roman", "viking", "japanese", "nubian"] as const)(
    "uses %s ingredients and drinks",
    (nation) => {
      for (const id of ["drink.raw", "drink.craft"]) {
        const index = TUTORIAL_QUESTS.findIndex((quest) => quest.id === id);
        const quest = TUTORIAL_QUESTS[index]!;
        if (quest.objective.kind !== "produce") throw new Error("produce objective");
        const state = refreshTutorial(stateFor(index), 80, nation);
        const ware = nationQuestWare(quest.objective.ware, nation);
        expect(
          tutorialSummary(recordTutorialEvent(state, `produce:${ware}`, 10), empty, true).ready
        ).toBe(true);
        if (ware !== quest.objective.ware)
          expect(
            tutorialSummary(
              recordTutorialEvent(state, `produce:${quest.objective.ware}`, 10),
              empty,
              true
            ).ready
          ).toBe(false);
      }
    }
  );
  it("gates later quests and only allows optional skips with no XP", () => {
    const state = stateFor(TUTORIAL_QUESTS.findIndex((quest) => quest.id === "stone.quarry"));
    expect(activeHomeQuestId(refreshTutorial(unstarted(state), 1, "roman"))).toBeNull();
    expect(claimTutorial(state, empty, true)).toBeNull();
    const optional = stateFor(TUTORIAL_QUESTS.findIndex((quest) => quest.optional));
    const skipped = claimTutorial(optional, empty, true)!;
    expect(skipped.experience).toBe(0);
    expect(skippedOf(skipped.state)).toEqual([activeHomeQuestId(optional)]);
    expect(validTutorialProgress(skipped.state)).toBe(true);
  });
  it.each(["roman", "viking", "japanese", "nubian"] as const)(
    "completes the whole %s chain in order",
    (nation) => {
      let state = refreshTutorial(createHomeQuestProgress(nation), 80, nation);
      for (const quest of TUTORIAL_QUESTS) {
        expect(activeHomeQuestId(state)).toBe(quest.id);
        const objective = quest.objective;
        let facts: TutorialFacts = empty;
        if (objective.kind === "build") facts = { ...empty, buildings: owned(objective.building, objective.amount) };
        if (objective.kind === "stock")
          facts = {
            ...empty,
            buildings: [
              {
                typeId: objective.building,
                construction: 1,
                inventory: { [nationQuestWare(objective.ware, nation)]: objective.amount }
              }
            ]
          };
        if (objective.kind === "garrison")
          facts = {
            ...empty,
            soldiers: Array.from({ length: objective.amount }, () => ({
              stationed: true,
              combat: { faction: 0, type: objective.troop ?? "shield" }
            }))
          };
        if (objective.kind === "deliver")
          facts = { ...empty, stored: ware => (ware === nationQuestWare(objective.ware, nation) ? objective.amount : 0) };
        if (objective.kind === "produce")
          state = recordTutorialEvent(
            state,
            `produce:${nationQuestWare(objective.ware, nation)}`,
            objective.amount
          );
        if (objective.kind === "event")
          state = recordTutorialEvent(state, objective.event, objective.amount);
        const claimed = claimTutorial(state, facts)!;
        expect(claimed).not.toBeNull();
        state = refreshTutorial(JSON.parse(JSON.stringify(claimed.state)), 80, nation);
        expect(validTutorialProgress(state)).toBe(true);
      }
      expect(completedOf(state)).toHaveLength(TUTORIAL_QUESTS.length);
      expect(tutorialSummary(state, empty, true).next).toBeNull();
    }
  );
  it("accepts a previously surveyed deposit so an explored old island can continue", () => {
    const state = stateFor(TUTORIAL_QUESTS.findIndex((quest) => quest.id === "mine.survey"));
    expect(tutorialSummary(state, empty, true).ready).toBe(false);
    expect(tutorialSummary(state, { ...empty, surveyedDeposits: 1 }, true).ready).toBe(true);
  });
  it("rejects malformed saves while accepting reordered known quest histories", () => {
    const state = stateFor(0);
    expect(validatePlayerProgress(createPlayerProgress(1))).toBe(true);
    expect(validTutorialProgress(undefined)).toBe(false);
    expect(validTutorialProgress(state)).toBe(true);
    const active = state.quests["wood.woodcutter"]!;
    expect(validTutorialProgress({ ...state, quests: { "unknown.quest": active } })).toBe(false);
    expect(validTutorialProgress({ ...state, quests: { ...state.quests, "wood.forester": active } })).toBe(false);
    const logs = progressWith("roman", ["wood.woodcutter", "wood.forester"]);
    expect(validTutorialProgress({ ...logs, quests: { ...logs.quests,
      "wood.logs": { ...active, baseline: 1 } } })).toBe(false);
    expect(validTutorialProgress({ ...state, counters: { "produce:logs": -1 } })).toBe(false);
    expect(validTutorialProgress({ ...state, quests: claimedQuests(["wood.woodcutter"], ["wood.woodcutter"]) }))
      .toBe(false);
  });
  it("preserves non-prefix legacy claims and the player's XP", () => {
    const legacy = { active: null, baseline: 0, completed: ["wood.woodcutter", "wood.logs"], counters: {},
      nation: "roman", seen: null, skipped: [] };
    const old = { ...createPlayerProgress(2), experience: 250, tutorial: legacy };
    const migrated = migratePlayerProgress(old) as ReturnType<typeof createPlayerProgress>;
    expect(completedOf(migrated.questBook!)).toEqual(["wood.woodcutter", "wood.logs"]);
    expect(migrated).not.toHaveProperty("tutorial");
    expect(migrated.experience).toBe(250);
    expect(validatePlayerProgress(migrated)).toBe(true);
    const current = { ...createPlayerProgress(2), questBook: stateFor(3) };
    expect(migratePlayerProgress(current)).toBe(current);
  });
  it("converts the code tutorial's saved progress loss-free (active quest, baseline, counters, skips, seen)", () => {
    const index = TUTORIAL_QUESTS.findIndex(quest => quest.id === "wood.logs");
    const completed = TUTORIAL_QUESTS.slice(0, index).map(quest => quest.id);
    const optional = TUTORIAL_QUESTS.find(quest => quest.optional)!.id;
    const legacy = { active: "wood.logs", baseline: 7, completed: [...completed, optional],
      counters: { "produce:logs": 12, plant: 3 }, nation: "viking", seen: "wood.logs", skipped: [optional] };
    const migrated = migratePlayerProgress({ ...createPlayerProgress(2), tutorial: legacy }) as
      ReturnType<typeof createPlayerProgress>;
    const book = migrated.questBook!;
    expect(activeHomeQuestId(book)).toBe("wood.logs");
    expect(book.quests["wood.logs"]?.baseline).toBe(7);
    expect(completedOf(book)).toEqual(TUTORIAL_QUESTS.map(quest => quest.id)
      .filter(id => legacy.completed.includes(id)));
    expect(skippedOf(book)).toEqual([optional]);
    expect(book).toMatchObject({ counters: legacy.counters, nation: "viking", seen: "wood.logs" });
    expect(tutorialSummary(book, empty, true).progress).toBe(5);
    expect(migratePlayerProgress({ ...createPlayerProgress(2), tutorial: { ...legacy, active: "gone.quest",
      completed: ["gone.quest"] } })).not.toHaveProperty("questBook");
  });
  it("awards once for existing buildings, persists progress and pauses away from home", () => {
    const session = createPlayerSession({ now: Date.now, seed: 4 });
    session.bind(home());
    expect(session.tutorialSummary()?.ready).toBe(true);
    expect(session.completeQuest("wood.woodcutter")).toBe(true);
    expect(session.progress().experience).toBe(15);
    expect(session.completeQuest("wood.woodcutter")).not.toBe(true);
    session.bind(home(39, [17, 20]));
    expect(session.tutorialSummary()?.ready).toBe(false);
    expect(session.completeQuest("wood.forester")).not.toBe(true);
    const restored = createPlayerSession({ now: Date.now,
      initial: JSON.parse(JSON.stringify(session.progress())),
      seed: 4
    });
    restored.bind(home(0, [17, 20]));
    expect(restored.completeQuest("wood.forester")).toBe(true);
    expect(restored.progress().experience).toBe(30);
    expect(validatePlayerProgress(restored.progress())).toBe(true);
  });
  it("pauses safely on building-free adventures whose headquarters getter throws", () => {
    const session = createPlayerSession({ now: Date.now, seed: 4 });
    session.bind(home());
    expect(session.completeQuest("wood.woodcutter")).toBe(true);
    const before = JSON.parse(JSON.stringify(session.progress().questBook));
    const adventure = {
      ...home(39),
      home: () => undefined,
      islandRole: () => "adventure",
      get headquarters() {
        throw new Error("This adventure island has no home building");
      },
      setTalentRanks: () => true
    } as unknown as SettlementSimulation;
    expect(() => session.bind(adventure)).not.toThrow();
    expect(session.tutorialSummary()?.enabled).toBe(false);
    for (let index = 0; index < 20; index++) session.produced("logs");
    expect(session.progress().questBook).toEqual(before);
    expect(session.completeQuest("wood.logs")).toContain("home island");
    session.bind(home());
    expect(session.tutorialSummary()?.ready).toBe(false);
  });
});
