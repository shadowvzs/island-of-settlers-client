import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import type { SettlementActor } from "../../shared/settlement/settlement-types";
import { settleOfflineCompletedStockTraffic } from "./offline-economy-stock-traffic";

/** A completed offline delivery no longer owns its previous physical door departure. */
export const settleOfflineStorageTraffic = (state: SettlementSaveV1, actor: SettlementActor) => {
  settleOfflineCompletedStockTraffic(state, actor);
  const traffic = state.storageTraffic;
  if (!traffic) return;
  for (const entry of traffic.actors) if (entry.actor === actor.uid) {
    entry.phase = actor.phase;
    entry.home = actor.home;
  }
  traffic.departures = traffic.departures.filter(entry => entry.actor !== actor.uid);
};
