import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { TutorialResource } from "../../shared/quests/home-quest-types";
import { HOME_QUEST_BOOK } from "../../shared/quests/home-quest-book";
import {
  activeHomeQuestId, claimHomeQuest, createHomeQuestProgress, homeQuestSummary, recordHomeQuestEvent
} from "../../shared/quests/home-quests";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";

/** A missing natural resource is re-checked at most this often (the summary refreshes every UI update). */
const RESOURCE_CHECK_MS = 10_000;

interface PlayerHomeQuestOptions {
  atHome: () => boolean;
  /** Awards experience with the Monument bonus (level-ups included). */
  award: (experience: number) => void;
  commit: (next: PlayerProgress) => void;
  localize: (text: string) => string;
  now: () => number;
  /** The refreshed player progress (the home chain activates its next quest here). */
  refresh: () => PlayerProgress;
  simulation: () => SettlementSimulation | undefined;
}

/**
 * The home island's quest chain of the player session (QU5): counters, the summary the quest window and HUD read,
 * the seen marker and the claim (recorded through the island's `claimQuest`). State: `PlayerProgress.questBook`.
 */
export const createPlayerHomeQuests = (options: PlayerHomeQuestOptions) => {
  const { atHome, commit, localize, now, refresh, simulation } = options;
  const resourceChecks = new Map<TutorialResource, { at: number; missing: boolean }>();
  const missingResource = (resource: TutorialResource) => {
    const time = now();
    const cached = resourceChecks.get(resource);
    if (cached && time - cached.at < RESOURCE_CHECK_MS) return cached.missing;
    const missing = simulation()?.missingTutorialResource?.(resource) ?? false;
    resourceChecks.set(resource, { at: time, missing });
    return missing;
  };
  const facts = () => {
    const island = simulation();
    return {
      buildings: island?.buildings() ?? [],
      missingResource,
      soldiers: island?.militarySoldiers() ?? [],
      stored: (ware: string) => island?.resourceTotal(ware) ?? 0,
      surveyedDeposits: island?.surveyedDepositCount?.() ?? 0
    };
  };
  /** Player-wide events (a talent Apply) count everywhere; island actions only at home (`islandEvent`). */
  const recordEvent = (key: string, amount = 1) => {
    const progress = refresh();
    if (!progress.questBook) return;
    commit({ ...progress, questBook: recordHomeQuestEvent(progress.questBook, key, amount) });
  };
  const islandEvent = (key: string, amount = 1) => {
    if (atHome()) recordEvent(key, amount);
  };
  const finish = (id: string, skip = false): true | string => {
    if (!atHome()) return localize("Tutorial quests are completed on your home island");
    const progress = refresh();
    const questBook = progress.questBook;
    if (!questBook || activeHomeQuestId(questBook) !== id) return localize("This tutorial is not active");
    const result = claimHomeQuest(questBook, facts(), now(), skip, progress.experience);
    if (!result) return localize(skip ? "This tutorial cannot be skipped" : "Finish this tutorial's objective first");
    const recorded = simulation()!.claimQuest({ bookId: HOME_QUEST_BOOK.id, cost: result.cost, goods: {},
      occurrence: "0", questId: id, skip });
    if (recorded !== true) return localize(recorded);
    commit({ ...progress, questBook: result.state });
    options.award(result.experience);
    refresh();
    return true;
  };
  return {
    /** A new island: fresh resource checks; the home island starts the chain once. */
    bind: (progress: PlayerProgress) => {
      resourceChecks.clear();
      const island = simulation();
      if (island && atHome() && !progress.questBook)
        commit({ ...progress, questBook: createHomeQuestProgress(island.playerNation()) });
    },
    finish,
    islandEvent,
    markSeen: (progress: PlayerProgress) => {
      if (progress.questBook)
        commit({ ...progress, questBook: { ...progress.questBook, seen: activeHomeQuestId(progress.questBook) } });
    },
    recordEvent,
    summary: () => {
      const questBook = refresh().questBook;
      return questBook ? homeQuestSummary(questBook, facts(), atHome()) : undefined;
    }
  };
};
