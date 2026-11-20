import { DEMAND_RANKING } from "../balance/economy";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Owner 2026-11-09 demand-based delivery. Which consumer gets a ware:
 * 1. player settings first (a paused building asks for nothing; no building priority exists yet);
 * 2. the largest uncovered need (demand − stock − promised deliveries);
 * 3. plus one item per `DEMAND_RANKING.waitTicksPerUnit` ticks waited for that ware, so a small consumer
 *    always moves up and is never starved;
 * 4. a delivery on its way keeps its destination (ranking only picks new dispatches);
 * 5. ties keep the existing building order.
 * The wait is a saved tick (`demandWaitSince`): it starts when an uncovered need is first seen, restarts when
 * the consumer is served and ends when its need is covered. Only real dispatch passes write it.
 */
export interface ConsumerDemand {
  building: SettlementBuilding;
  /** Uncovered need: demand − stock − promised deliveries. */
  missing: number;
  ware: string;
}

export interface RankedConsumerDemand extends ConsumerDemand {
  /** Uncovered need plus the waiting bonus: the value both dispatch paths rank by. */
  rank: number;
}

const nowTick = (context: SettlementContext) => context.clock?.tick() ?? 0;

const waitBonus = (context: SettlementContext, building: SettlementBuilding, ware: string) => {
  const since = building.demandWaitSince?.[ware];
  if (since === undefined) return 0;
  return Math.max(0, Math.floor((nowTick(context) - since) / DEMAND_RANKING.waitTicksPerUnit));
};

/** The shared rank of one consumer's need for one ware. */
export const consumerDemandRank = (
  context: SettlementContext, building: SettlementBuilding, ware: string, missing: number
) => missing + waitBonus(context, building, ware);

export const clearDemandWait = (building: SettlementBuilding, ware: string) => {
  const waits = building.demandWaitSince;
  if (waits?.[ware] === undefined) return;
  delete waits[ware];
  if (!Object.keys(waits).length) delete building.demandWaitSince;
};

/** A real pass saw this need: an uncovered need starts waiting, a covered one stops. */
export const noteDemandWait = (
  context: SettlementContext, building: SettlementBuilding, ware: string, missing: number
) => {
  if (missing <= 0) { clearDemandWait(building, ware); return; }
  (building.demandWaitSince ??= {})[ware] ??= nowTick(context);
};

/** The consumer was just served this ware: its wait starts again. */
export const restartDemandWait = (context: SettlementContext, building: SettlementBuilding, ware: string) => {
  (building.demandWaitSince ??= {})[ware] = nowTick(context);
};

/**
 * Orders one demand category for dispatch: wares keep the order in which they first appear (building
 * order), and each ware's consumers are ranked by `rank`, highest first, ties in building order.
 * Ranks are computed once per pass.
 */
export const rankConsumerDemands = (
  context: SettlementContext, demands: readonly ConsumerDemand[]
): RankedConsumerDemand[] => {
  const groups = new Map<string, number>();
  const ranked = demands.map((demand, order) => {
    let group = groups.get(demand.ware);
    if (group === undefined) groups.set(demand.ware, group = groups.size);
    const rank = consumerDemandRank(context, demand.building, demand.ware, demand.missing);
    return { entry: { ...demand, rank }, group, order };
  });
  ranked.sort((a, b) => a.group - b.group || b.entry.rank - a.entry.rank || a.order - b.order);
  return ranked.map(item => item.entry);
};
