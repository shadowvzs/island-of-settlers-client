import { nationQuestWare } from "@shared/catalog/balance";

import { claimedQuestState, decideQuestClaim } from "../../../../island-of-settlers-shared/src/script/engine/quest-claims";
import { initialQuestState } from "../../../../island-of-settlers-shared/src/script/engine/quest-state";
import {
  activationBaseline, eligibleQuestIds, isQuestFinished, isQuestSkippable, objectiveProgress
} from "../../../../island-of-settlers-shared/src/script/engine/quests";
import type { QuestRunState } from "../../../../island-of-settlers-shared/src/script/types/run-state";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { HOME_QUEST_BOOK, HOME_TUTORIAL_QUESTS, type HomeTutorialQuest,homeTutorialQuest } from "./home-quest-book";
import { type HomeIslandFacts, homeQuestFacts } from "./home-quest-facts";

/**
 * The home island's quests on the shared quest engine (QU5, lane TRG6): the default home book's tutorial chain
 * with one active quest at a time, counters with an activation baseline, live building/stock/garrison facts, the
 * skip rules and the chapter top-up. Player-wide (the home island is unique), saved in the player progress.
 */
export interface HomeQuestProgress {
  bookId: string;
  /** Action and production counters (`plant`, `ship`, `tools`, `produce:<ware>`, …), counted at home only. */
  counters: Record<string, number>;
  nation: WorkerNation;
  /** Instance states of the touched quests; a quest without an entry is inactive. */
  quests: QuestRunState;
  revision: number;
  /** The active quest the player has seen in the quest window (the HUD's "new" badge). */
  seen: string | null;
}

export interface TutorialSummary {
  enabled: boolean;
  hasNew: boolean;
  next: HomeTutorialQuest | null;
  progress: number;
  quest: HomeTutorialQuest | null;
  ready: boolean;
  /** Optional, or its natural resource is missing on the home island. */
  skippable: boolean;
}

export const createHomeQuestProgress = (nation: WorkerNation): HomeQuestProgress => ({
  bookId: HOME_QUEST_BOOK.id, counters: {}, nation, quests: {}, revision: HOME_QUEST_BOOK.revision, seen: null
});

/** The active chain quest (at most one). */
export const activeHomeQuestId = (state: HomeQuestProgress) =>
  HOME_TUTORIAL_QUESTS.find(quest => state.quests[quest.id]?.state === "active")?.id ?? null;

/** Claimed or skipped chain quests, in book order (tools and checks read the history this way). */
export const finishedHomeQuestIds = (state: HomeQuestProgress | undefined) => state
  ? HOME_TUTORIAL_QUESTS.filter(quest => isQuestFinished(state.quests[quest.id])).map(quest => quest.id) : [];

export const skippedHomeQuestIds = (state: HomeQuestProgress | undefined) =>
  finishedHomeQuestIds(state).filter(id => state!.quests[id]?.skipped);

const NO_FACTS: HomeIslandFacts = { buildings: [], soldiers: [] };

const factsOf = (state: HomeQuestProgress, facts: HomeIslandFacts, level = 0) =>
  homeQuestFacts(facts, state.counters, state.nation, level);

const withActive = (state: HomeQuestProgress, id: string, nation: WorkerNation): HomeQuestProgress => {
  const quest = homeTutorialQuest(id)!;
  const baseline = activationBaseline(quest.definition.objective, homeQuestFacts(NO_FACTS, state.counters, nation, 0));
  const { baseline: _old, ...current } = state.quests[id] ?? initialQuestState();
  return { ...state, nation, quests: { ...state.quests,
    [id]: { ...current, ...(baseline === undefined ? {} : { baseline }), state: "active" } } };
};

/**
 * Exactly one active quest: an activated quest is kept; otherwise the book's next eligible one (group level and
 * order) activates with its counter baseline. A nation change re-baselines the active quest on its own counter.
 */
export const refreshHomeQuests = (
  state: HomeQuestProgress, level: number, nation: WorkerNation
): HomeQuestProgress => {
  const active = activeHomeQuestId(state);
  if (active) return nation === state.nation ? state : withActive(state, active, nation);
  const next = eligibleQuestIds(HOME_QUEST_BOOK, state.quests, level)[0];
  if (next) return withActive(state, next, nation);
  return nation === state.nation ? state : { ...state, nation };
};

export const recordHomeQuestEvent = (state: HomeQuestProgress, key: string, amount = 1): HomeQuestProgress => {
  if (!Number.isFinite(amount) || amount < 1) return state;
  return { ...state, counters: { ...state.counters, [key]: (state.counters[key] ?? 0) + Math.floor(amount) } };
};

const nextUnfinished = (state: HomeQuestProgress) =>
  HOME_TUTORIAL_QUESTS.find(quest => !isQuestFinished(state.quests[quest.id])) ?? null;

export const homeQuestSummary = (
  state: HomeQuestProgress, facts: HomeIslandFacts, enabled: boolean
): TutorialSummary => {
  const quest = homeTutorialQuest(activeHomeQuestId(state)) ?? null;
  const questFacts = factsOf(state, facts);
  const progress = quest
    ? objectiveProgress(quest.definition.objective, state.quests[quest.id]!, questFacts)?.current ?? 0 : 0;
  return {
    enabled,
    hasNew: !!quest && state.seen !== quest.id,
    next: quest ? null : nextUnfinished(state),
    progress,
    quest,
    ready: enabled && !!quest && progress >= quest.objective.amount,
    skippable: !!quest && isQuestSkippable(quest.definition, questFacts)
  };
};

/**
 * Claims (or skips) the active quest at game time `now`. XP is awarded by the caller only after this returns a
 * newly finished quest: the quest's own XP (0 when skipped), topped up to the next level by a chapter's last quest.
 * `cost` is what the recorded claim takes from the island stock (the nation's own ware; empty when skipped).
 */
export const claimHomeQuest = (
  state: HomeQuestProgress, facts: HomeIslandFacts, now: number, skip = false, playerExperience?: number
) => {
  const quest = homeTutorialQuest(activeHomeQuestId(state));
  if (!quest) return null;
  const decision = decideQuestClaim(HOME_QUEST_BOOK, state.quests, quest.definition, factsOf(state, facts),
    { playerExperience, skip }, now);
  if (!decision.ok) return null;
  const claimed = claimedQuestState(quest.definition, state.quests[quest.id]!, now, skip);
  const cost = Object.fromEntries(decision.cost.map(line => [nationQuestWare(line.ware, state.nation), line.amount]));
  return { cost, experience: decision.experience, state: { ...state, quests: { ...state.quests, [quest.id]: claimed } } };
};
