import { initialQuestState } from "../../../island-of-settlers-shared/src/script/engine/quest-state";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { HOME_TUTORIAL_QUESTS } from "../../src/shared/quests/home-quest-book";
import type { HomeIslandFacts } from "../../src/shared/quests/home-quest-facts";
import {
  activeHomeQuestId, claimHomeQuest, createHomeQuestProgress, finishedHomeQuestIds, type HomeQuestProgress,
  refreshHomeQuests, skippedHomeQuestIds
} from "../../src/shared/quests/home-quests";

/** Home quest state builders of the ported tutorial tests (QU5: same expectations on the book runtime). */
export const NOW = Date.UTC(2026, 10, 11);
export const NO_ISLAND_FACTS: HomeIslandFacts = { buildings: [], soldiers: [] };

export const claimedQuests = (ids: readonly string[], skipped: readonly string[] = []) =>
  Object.fromEntries(ids.map(id => [id, { ...initialQuestState(), claimCount: 1, state: "claimed" as const,
    ...(skipped.includes(id) ? { skipped: true } : {}) }]));

export { finishedHomeQuestIds as completedOf, skippedHomeQuestIds as skippedOf };

export const progressWith = (nation: WorkerNation, completed: readonly string[]): HomeQuestProgress =>
  ({ ...createHomeQuestProgress(nation), quests: claimedQuests(completed) });

/** The state with every quest before `index` claimed, refreshed at `level`. */
export const stateAt = (index: number, level = 80, nation: WorkerNation = "roman") => refreshHomeQuests(
  progressWith(nation, HOME_TUTORIAL_QUESTS.slice(0, index).map(quest => quest.id)), level, nation);

export const stateBefore = (id: string, level = 80) =>
  stateAt(HOME_TUTORIAL_QUESTS.findIndex(quest => quest.id === id), level);

/** The same state with no quest activated yet (counters kept). */
export const unstarted = (state: HomeQuestProgress) =>
  ({ ...state, quests: claimedQuests(finishedHomeQuestIds(state)) });

export const claimAt = (state: HomeQuestProgress, facts: HomeIslandFacts, skip = false) =>
  claimHomeQuest(state, facts, NOW, skip);

export { activeHomeQuestId };
