import { initialQuestState } from "../../../../island-of-settlers-shared/src/script/engine/quest-state";
import { activationBaseline, isQuestFinished } from "../../../../island-of-settlers-shared/src/script/engine/quests";
import type { QuestInstanceState } from "../../../../island-of-settlers-shared/src/script/types/run-state";
import { isWorkerNation } from "../../render-common/workers/worker-appearance";
import { isSaveInteger } from "../settlement/save-validation";
import { HOME_QUEST_BOOK, homeTutorialQuest } from "./home-quest-book";
import { homeQuestFacts } from "./home-quest-facts";
import type { HomeQuestProgress } from "./home-quests";

/**
 * Save contract of the home quest state (QU5): quest ids are part of the save (unknown ids are refused, and the
 * player progress migration then restarts the chain, owner 2026-10-20), and the code tutorial's saved progress
 * converts loss-free (same finished, skipped and active quests, counters, baseline and seen marker).
 */

/** Longest action counter key a save may hold (home quest state and script islands). */
export const COUNTER_KEY_LENGTH = 80;
const STATES: ReadonlySet<QuestInstanceState["state"]> = new Set(["active", "claimed"]);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const canBeSkipped = (id: string) => {
  const quest = homeTutorialQuest(id);
  return Boolean(quest?.optional || quest?.resource);
};

const validCounters = (counters: unknown): counters is Record<string, number> => isPlainRecord(counters) &&
  Object.entries(counters).every(([key, value]) => key.length <= COUNTER_KEY_LENGTH && isSaveInteger(value));

const validBaseline = (state: HomeQuestProgress, id: string, entry: QuestInstanceState) => {
  if (entry.baseline === undefined) return true;
  const quest = homeTutorialQuest(id)!;
  const counter = activationBaseline(quest.definition.objective,
    homeQuestFacts({ buildings: [], soldiers: [] }, state.counters, state.nation, 0));
  return isSaveInteger(entry.baseline) && counter !== undefined && entry.baseline <= counter;
};

const validEntry = (state: HomeQuestProgress, id: string, entry: unknown) => {
  if (!homeTutorialQuest(id) || !isPlainRecord(entry)) return false;
  const quest = entry as unknown as QuestInstanceState;
  if (!STATES.has(quest.state) || !isSaveInteger(quest.claimCount) || !Array.isArray(quest.lastClaims)) return false;
  if ((quest.state === "claimed") !== isQuestFinished(quest)) return false;
  if (quest.skipped !== undefined && (quest.skipped !== true || !canBeSkipped(id))) return false;
  return quest.state === "claimed" || validBaseline(state, id, quest);
};

export const validHomeQuestProgress = (value: unknown): value is HomeQuestProgress => {
  if (!isPlainRecord(value)) return false;
  const state = value as unknown as HomeQuestProgress;
  if (state.bookId !== HOME_QUEST_BOOK.id || !isSaveInteger(state.revision) || !isWorkerNation(state.nation))
    return false;
  if (!validCounters(state.counters) || !isPlainRecord(state.quests)) return false;
  if (state.seen !== null && !homeTutorialQuest(state.seen)) return false;
  const entries = Object.entries(state.quests);
  if (entries.filter(([, entry]) => entry.state === "active").length > 1) return false;
  return entries.every(([id, entry]) => validEntry(state, id, entry));
};

/** The code tutorial's saved progress (before QU5). */
export interface LegacyTutorialProgress {
  active: string | null;
  baseline: number;
  completed: string[];
  counters: Record<string, number>;
  nation: HomeQuestProgress["nation"];
  seen: string | null;
  skipped: string[];
}

const claimed = (skipped: boolean): QuestInstanceState =>
  ({ ...initialQuestState(), claimCount: 1, state: "claimed", ...(skipped ? { skipped: true } : {}) });

/** The legacy tutorial as home quest state; null when it is malformed (the chain then restarts). */
export const migrateLegacyTutorial = (value: unknown): HomeQuestProgress | null => {
  if (!isPlainRecord(value) || !Array.isArray(value.completed) || !Array.isArray(value.skipped)) return null;
  const legacy = value as unknown as LegacyTutorialProgress;
  const quests: Record<string, QuestInstanceState> = {};
  for (const id of legacy.completed) quests[id] = claimed(legacy.skipped.includes(id));
  const state: HomeQuestProgress = { bookId: HOME_QUEST_BOOK.id, counters: legacy.counters, nation: legacy.nation,
    quests, revision: HOME_QUEST_BOOK.revision, seen: legacy.seen };
  const active = legacy.active ? homeTutorialQuest(legacy.active) : undefined;
  if (active) {
    const counted = activationBaseline(active.definition.objective,
      homeQuestFacts({ buildings: [], soldiers: [] }, legacy.counters ?? {}, legacy.nation, 0)) !== undefined;
    quests[active.id] = { ...initialQuestState(), ...(counted ? { baseline: legacy.baseline } : {}), state: "active" };
  }
  return validHomeQuestProgress(state) ? state : null;
};
