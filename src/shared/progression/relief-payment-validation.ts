import type { PlayerProgress } from "./player-progress";
import type { ReliefQuestStatus } from "./relief-quests";

type LocalReliefReceipt = Pick<ReliefQuestStatus, "questId" | "ware" | "amount" | "harbourUid" | "islandSeed">;

/** A recorded physical payment must pay the actual assigned daily aid, including legacy retained quantities. */
export const reliefPaymentProblem = (progress: Pick<PlayerProgress, "quests" | "relief">, request: unknown,
  localJobs: readonly LocalReliefReceipt[] = []) => {
  const problem = "The relief payment does not match its verified quest assignment";
  if (!request || typeof request !== "object" || Array.isArray(request)) return problem;
  const value = request as Record<string, unknown>;
  const quest = progress.quests.find(quest => quest.id === value.questId);
  const mission = progress.relief?.missions.find(mission => mission.questId === value.questId);
  if (!quest || !mission || value.version !== 1 || quest.kind !== "deliver" || quest.done ||
    quest.ware !== value.ware || quest.amount !== value.amount || mission.ware !== value.ware ||
    mission.amount !== value.amount || mission.stage === "returned" || mission.stage === "completed") return problem;
  if (mission.stage !== "awaiting-aid" && !localJobs.some(job => job.questId === value.questId &&
    job.ware === value.ware && job.amount === value.amount &&
    (value.harbourUid === undefined || value.harbourUid === job.harbourUid) &&
    (mission.harbourUid === undefined || mission.harbourUid === job.harbourUid) &&
    (mission.islandSeed === undefined || mission.islandSeed === job.islandSeed))) return problem;
  return undefined;
};
