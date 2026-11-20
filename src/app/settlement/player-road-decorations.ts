import { type ClosedRoadDecorationReturn,receiveClosedRoadDecorations } from "../../shared/settlement/road-decoration-closures";
import { createPlayerRoadDecorationActions } from "./player-road-decoration-actions";
import { createPlayerRoadDecorationCustody } from "./player-road-decoration-custody";

/** Event-triggered outbox draining: no timer or unchanged-frame polling. A refusal preserves the durable outbox. */
export const createPlayerRoadDecorations = (options: Parameters<typeof createPlayerRoadDecorationActions>[0] & {
  refreshWallet?: () => Promise<{ gems: number; items?: import("../../shared/progression/player-inventory").PlayerInventory }>;
}) => {
  let draining = false;
  const claimPendingRoadDecorationReturns = () => {
    if (!options.online || draining || options.busy() || !options.active()) return;
    const ids = options.simulation()?.pendingRoadDecorationReturns().map(row => row.id).slice(0, 256) ?? [];
    if (!ids.length) return;
    draining = true;
    void mutateRoadDecoration({ kind: "claim-returns", ids }).then(result => {
      draining = false;
      if (result === true) claimPendingRoadDecorationReturns();
      return undefined;
    }).catch(() => { draining = false; });
  };
  const mutateRoadDecoration = createPlayerRoadDecorationActions({ ...options, onIdle: claimPendingRoadDecorationReturns });
  return {
    acceptClosedRoadDecorationReturns: (rows: readonly ClosedRoadDecorationReturn[]) => {
      if (!options.active()) return false;
      const current = options.get(), next = receiveClosedRoadDecorations(current, rows, options.online);
      if (!next) return false;
      if (next !== current) options.commit(next);
      return true;
    },
    refreshInventory: async () => {
      if (!options.refreshWallet || !options.active() || options.busy()) return;
      const before = options.get();
      try {
        const wallet = await options.refreshWallet(), current = options.get();
        if (options.active() && !options.busy() && current.inventory === before.inventory && current.gems === before.gems)
          options.commit({ ...current, gems: wallet.gems, inventory: wallet.items ?? {} });
        claimPendingRoadDecorationReturns();
      } catch { /* The server wallet remains authoritative; retain the displayed inventory until a later open. */ }
    },
    mutateRoadDecoration, claimPendingRoadDecorationReturns,
    roadDecorationCustody: createPlayerRoadDecorationCustody({ ...options, requestServerReturns: claimPendingRoadDecorationReturns })
  };
};
