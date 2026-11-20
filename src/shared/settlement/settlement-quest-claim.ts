import type { QuestClaimCommand } from "../../../../island-of-settlers-shared/src/commands/quest-claim-command";
import { addToHome, takeFromStorages } from "./colony-economy";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** The refusal of a claim whose cost the island cannot pay (the player session pre-checks with its own text). */
export const QUEST_CLAIM_COST_SHORT = "Not enough goods in storage for this quest";

/**
 * The recorded quest claim (TRG6, manifest `claimQuest`): the cost leaves the island stock and the reward goods
 * arrive at home in one journalled step, so a replay applies both at the same tick. A skip pays and takes nothing.
 */
/** Takes a cost from the island stock when all of it is there; false (nothing taken) when short. */
export const payQuestCost = (
  buildings: readonly SettlementBuilding[], cost: Readonly<Record<string, number>>, stored: (ware: string) => number
) => {
  const lines = Object.entries(cost);
  if (lines.some(([ware, amount]) => stored(ware) < amount)) return false;
  if (lines.length) takeFromStorages(buildings, cost);
  return true;
};

export const applyQuestClaim = (
  buildings: readonly SettlementBuilding[], claim: QuestClaimCommand, stored: (ware: string) => number
): true | string => {
  if (claim.skip) return true;
  if (!payQuestCost(buildings, claim.cost, stored)) return QUEST_CLAIM_COST_SHORT;
  if (Object.keys(claim.goods).length) addToHome(buildings, claim.goods);
  return true;
};

const QUEST_CLAIM_REFUSALS: Readonly<Record<string, string>> = {
  costShort: QUEST_CLAIM_COST_SHORT,
  notActive: "This quest is not active",
  notClaimable: "This quest cannot be claimed again yet",
  notReady: "Finish this quest's objective first",
  notSkippable: "This quest cannot be skipped"
};

/**
 * The recorded claim on an island that runs a map script (TRG3a): a quest of the island's book is claimed by the
 * engine (readiness, window, cost through the world port, `onSuccess`); the reward goods the session names arrive
 * at home. Quests of other books (the home book, the global daily pool) keep the plain claim.
 */
export const claimIslandQuest = (
  context: SettlementContext, claim: QuestClaimCommand, stored: (ware: string) => number
): true | string => {
  const engine = context.script?.engine;
  if (!engine || engine.script.quests.id !== claim.bookId) {
    return applyQuestClaim(context.buildings, claim, stored);
  }
  const result = engine.claimQuest(claim.questId, { skip: claim.skip });
  if (!result.ok) return QUEST_CLAIM_REFUSALS[result.reason] ?? QUEST_CLAIM_COST_SHORT;
  if (Object.keys(claim.goods).length) addToHome(context.buildings, claim.goods);
  return true;
};
