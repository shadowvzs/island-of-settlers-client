import type { PlayerProgress } from "../progression/player-progress";
import { type ReliefQuestReturn,returnReliefQuests } from "../progression/relief-quests";
import type { Archipelago, ColonyRecord } from "./archipelago";
import type { GameSaveV1 } from "./game-save";

export const pendingColonyRelief = (save?: GameSaveV1) => (save?.settlement.reliefCollections?.jobs ?? [])
  .filter(job => !job.departed).map(job => ({ questId: job.questId, ware: job.ware, amount: job.amount,
    islandSeed: save!.settlement.world.seed, harbourUid: job.harbourUid }));

/** Closed sources carry claim evidence only: no colony slot, ownership, production or further native ticks. */
export const retainColonyReliefReceipt = (group: Archipelago, colony?: ColonyRecord): Archipelago => {
  if (!colony?.save?.settlement.reliefCollections?.jobs.some(job => job.departed && job.loaded === job.amount)) return group;
  const { save, ...metadata } = colony;
  const receipt = { islandId: colony.expeditionId, colony: metadata, save: { ...save, player: undefined, archipelago: undefined } };
  return { ...group, reliefReceipts: [...group.reliefReceipts?.filter(old => old.islandId !== receipt.islandId) ?? [], receipt] };
};

export const pruneClaimedReliefReceipts = (group: Archipelago, player?: PlayerProgress): Archipelago => {
  if (!group.reliefReceipts || !player) return group;
  const receipts = group.reliefReceipts.filter(receipt => receipt.save.settlement.reliefCollections?.jobs.some(job =>
    job.departed && !player.relief?.missions.some(mission => mission.questId === job.questId && mission.stage === "completed" &&
      mission.ware === job.ware && mission.amount === job.amount && mission.islandSeed === receipt.save.settlement.world.seed &&
      mission.harbourUid === job.harbourUid)));
  return receipts.length === group.reliefReceipts.length ? group : { ...group, reliefReceipts: receipts.length ? receipts : undefined };
};

export const applyReturnedColonyRelief = (player: PlayerProgress | undefined, records: readonly ReliefQuestReturn[] = []) => {
  if (!player) return player;
  const relief = returnReliefQuests(player.relief, records);
  return relief === player.relief ? player : { ...player, relief };
};
