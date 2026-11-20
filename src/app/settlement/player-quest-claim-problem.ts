import type { PlayerProgress } from "../../shared/progression/player-progress";
import { completeQuest } from "../../shared/progression/player-progress";
import { isReliefQuest } from "../../shared/progression/relief-quests";
import { wareNameForCount } from "../../shared/settlement/ware-names";
import { formatWareCount } from "../settlement-ui/helpers";

interface Options {
  refresh(): PlayerProgress;
  atHome(): boolean;
  localize(text: string): string;
  reliefProblem(id: string): string | null;
  stored(ware: string): number;
}
/** Shared claim preflight keeps the player session factory focused on progress ownership. */
export const createPlayerQuestClaimProblem = (options: Options) => (id: string): string | null => {
  const { atHome, localize, refresh, reliefProblem, stored } = options;
  const progress = refresh(), quest = progress.quests.find(entry => entry.id === id);
  if (!quest || quest.done) return localize("This quest is already done");
  if (!atHome()) return localize("Claim the daily quest on your home island");
  const problem = reliefProblem(id);
  if (problem) return problem;
  if (quest.kind === "deliver" && !isReliefQuest(progress.relief, id) && stored(quest.ware) < quest.amount)
    return localize(`Needs ${formatWareCount(quest.amount, quest.ware)} in storage`);
  if (completeQuest(progress, id)) return null;
  return localize(`Produce ${quest.amount - quest.progress} more ${wareNameForCount(quest.ware, quest.amount - quest.progress)} first`);
};
