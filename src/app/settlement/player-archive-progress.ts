import { awardExperience, type LevelUp, type PlayerProgress } from "../../shared/progression/player-progress";
import { type ReliefQuestReturn, returnReliefQuests as markReliefQuestsReturned } from "../../shared/progression/relief-quests";
import type { ServerEconomy } from "../cloud/server-economy";

/** Archive transaction owns persistence and physical coin custody; this bridge publishes global progress once. */
export const createArchivedPlayerProgress = (options: {
  current(): PlayerProgress;
  commit(next: PlayerProgress): unknown;
  economy?: ServerEconomy;
  onLevelUp?: (entries: readonly LevelUp[]) => void;
}) => {
  const prepareArchivedProgress = (next: PlayerProgress): PlayerProgress =>
    options.economy ? { ...next, gems: options.current().gems } : next;
  const acceptArchivedProgress = (expected: PlayerProgress, next: PlayerProgress) => {
    if (JSON.stringify(options.current()) !== JSON.stringify(expected) || next.seed !== expected.seed ||
      next.experience < expected.experience) return false;
    const { levelUps } = awardExperience(expected, next.experience - expected.experience);
    options.commit(prepareArchivedProgress(next));
    if (levelUps.length) {
      options.economy?.claimLevel(levelUps.at(-1)!.level);
      options.onLevelUp?.(levelUps);
    }
    return true;
  };
  return { acceptArchivedProgress, prepareArchivedProgress,
    returnReliefQuests: (records: readonly ReliefQuestReturn[]) => {
      const progress = options.current(), relief = markReliefQuestsReturned(progress.relief, records);
      if (relief !== progress.relief) options.commit({ ...progress, relief });
    }
  };
};
