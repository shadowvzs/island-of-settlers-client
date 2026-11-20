import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import type { SettlementActor } from "../../shared/settlement/settlement-types";

/** A completed, hidden courier inside home no longer owns or waits for a physical stock court. */
export const settleOfflineCompletedStockTraffic = (state: SettlementSaveV1, actor: SettlementActor) => {
  if (actor.phase !== "inside" || actor.visible !== false || actor.stockBuilding !== undefined) return;
  const traffic = state.stockTraffic;
  if (!traffic) return;
  traffic.owners = traffic.owners.filter(entry => entry.actor !== actor.uid);
  traffic.actors = traffic.actors.filter(entry => entry.actor !== actor.uid);
  for (const entry of traffic.actors) if (entry.entry?.rival === actor.uid) entry.entry = undefined;
};
