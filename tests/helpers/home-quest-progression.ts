import { levelForExperience, nationQuestWare } from "@shared/catalog/balance";

import { createPlayerSession } from "../../src/app/settlement/player-session";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { addToHome, takeFromStorages } from "../../src/shared/settlement/colony-economy";
import { applyQuestClaim } from "../../src/shared/settlement/settlement-quest-claim";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

/**
 * A scripted home progression (QU §10.1 step 3): the whole tutorial chain from level 1, with a daily quest claimed
 * every few steps, driven through the player session only. It records what the player sees and gets (active ids,
 * readiness, progress, skip rules, XP, level, daily ids and reward goods), so the code tutorial and the default
 * home book runtime can be compared step by step.
 */

export interface ProgressionScenario {
  /** Every natural resource is missing on the island (required resource steps become skippable). */
  missingResources: boolean;
  nation: WorkerNation;
}

interface FakeBuilding {
  construction: number;
  inventory: Record<string, number>;
  militaryFaction?: number;
  typeId: number;
  uid: number;
}

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 1, 9);
const MAX_STEPS = 240;
const DAILY_EVERY = 9;

const createIsland = (scenario: ProgressionScenario) => {
  const hq: FakeBuilding = { construction: 1, inventory: {}, typeId: 0, uid: 1 };
  const buildings: FakeBuilding[] = [hq];
  const soldiers: { combat: { faction: number; type: string }; stationed: boolean }[] = [];
  const simulation = {
    buildings: () => buildings,
    claimQuest: (claim: Parameters<SettlementSimulation["claimQuest"]>[0]) =>
      applyQuestClaim(buildings as never, claim, ware => hq.inventory[ware] ?? 0),
    home: () => hq,
    islandRole: () => "home",
    militarySoldiers: () => soldiers,
    missingTutorialResource: () => scenario.missingResources,
    playerNation: () => scenario.nation,
    pruneReliefCollections: () => [],
    receiveHomeGoods: (goods: Record<string, number>) => addToHome(buildings as never, goods),
    reliefCollectionCandidates: () => [],
    reliefCollections: () => [],
    reliefCollectionsToPrune: () => [],
    resourceTotal: (ware: string) => hq.inventory[ware] ?? 0,
    setTalentRanks: () => true,
    surveyedDepositCount: () => 0,
    takeStoredGoods: (goods: Record<string, number>) => takeFromStorages(buildings as never, goods)
  } as unknown as SettlementSimulation;
  return { buildings, hq, simulation, soldiers };
};

type Session = ReturnType<typeof createPlayerSession>;
type Island = ReturnType<typeof createIsland>;
type Objective = NonNullable<NonNullable<ReturnType<Session["tutorialSummary"]>>["quest"]>["objective"];

const addBuildings = (session: Session, island: Island, typeId: number, amount: number, ware?: string) => {
  for (let index = 0; index < amount; index++) {
    const building = { construction: 1, inventory: ware ? { [ware]: 999 } : {}, typeId,
      uid: island.buildings.length + 1 };
    island.buildings.push(building);
    session.buildingCompleted(building as never);
  }
};

const satisfy = (session: Session, island: Island, objective: Objective, nation: WorkerNation) => {
  switch (objective.kind) {
    case "build": return addBuildings(session, island, objective.building, objective.amount);
    case "stock": return addBuildings(session, island, objective.building, 1, nationQuestWare(objective.ware, nation));
    case "deliver": {
      const ware = nationQuestWare(objective.ware, nation);
      island.hq.inventory[ware] = (island.hq.inventory[ware] ?? 0) + objective.amount;
      return;
    }
    case "garrison":
      for (let index = 0; index < objective.amount; index++)
        island.soldiers.push({ combat: { faction: 0, type: objective.troop ?? "swordsman" }, stationed: true });
      return;
    case "produce":
      for (let index = 0; index < objective.amount; index++) session.produced(nationQuestWare(objective.ware, nation));
      return;
    case "event":
      for (let index = 0; index < objective.amount; index++) session.tutorialEvent(objective.event);
  }
};

const claimDaily = (session: Session, island: Island) => {
  const quest = session.progress().quests.find(entry => !entry.done);
  if (!quest) return null;
  if (quest.kind === "produce") for (let index = 0; index < quest.amount; index++) session.produced(quest.ware);
  else island.hq.inventory[quest.ware] = (island.hq.inventory[quest.ware] ?? 0) + quest.amount;
  const before = { ...island.hq.inventory }, experience = session.progress().experience;
  const result = session.completeQuest(quest.id);
  const goods = Object.fromEntries(Object.entries(island.hq.inventory)
    .map(([ware, amount]) => [ware, amount - (before[ware] ?? 0)]).filter(([, delta]) => delta !== 0));
  return { goods, id: quest.id, kind: quest.kind, result: typeof result === "object" ? "pending" : result,
    ware: quest.ware,
    xp: session.progress().experience - experience };
};

/** Runs the scenario; every entry is one claim (tutorial step or daily quest) as the player saw it. */
export const runHomeProgression = (scenario: ProgressionScenario) => {
  let now = START;
  const session = createPlayerSession({ now: () => now, seed: 7 });
  const island = createIsland(scenario);
  session.bind(island.simulation);
  const log: unknown[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const summary = session.tutorialSummary();
    const quest = summary?.quest;
    if (!summary || !quest) break;
    const before = { progress: summary.progress, ready: summary.ready, skippable: summary.skippable };
    const skip = summary.skippable && (!quest.optional || step % 2 === 0);
    const early = summary.ready ? null : session.completeQuest(quest.id);
    if (!skip) satisfy(session, island, quest.objective, scenario.nation);
    const ready = session.tutorialSummary()!.ready;
    const experience = session.progress().experience;
    const result = skip ? session.skipTutorial(quest.id) : session.completeQuest(quest.id);
    log.push({ before, chapter: quest.chapter, early, id: quest.id, objective: quest.objective, ready, result, skip,
      xp: session.progress().experience - experience, level: levelForExperience(session.progress().experience) });
    if (step % DAILY_EVERY !== 0) continue;
    now += DAY;
    log.push({ daily: claimDaily(session, island) });
  }
  return { experience: session.progress().experience, log, open: session.tutorialSummary()?.next?.id ?? null };
};
