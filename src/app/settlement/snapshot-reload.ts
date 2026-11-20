import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import type { HeldFrameJobs } from "./held-frame-jobs";
import type { IslandSettlement } from "./island-settlement";

/**
 * After a save's capture the island reloads that snapshot in place in the next held frame (D3): no tick runs in
 * between, and play then continues exactly as a session resumed from the uploaded snapshot, which a server can
 * verify. A bug replay recording keeps playing continuously, because its replay has no reloads (false: not queued).
 */
export const queueSnapshotReload = (
  settlement: Pick<IslandSettlement, "bugReplay" | "simulation">, jobs: Pick<HeldFrameJobs, "queue">,
  snapshot: SettlementSaveV1, onReloaded?: (reloaded: boolean) => void, isStale: () => boolean = () => false,
  /** True once persistence holds an independent copy: the live reload can take the snapshot. */
  takeOwnership: (snapshot: SettlementSaveV1) => boolean = () => false
) => {
  if (settlement.bugReplay.recording()) return false;
  jobs.queue(() => {
    // A player command ran after the capture: the snapshot no longer holds it, so the island keeps its state.
    if (isStale()) { onReloaded?.(false); return; }
    const owns = takeOwnership(snapshot);
    const reloaded = owns ? settlement.simulation.reloadSnapshot(snapshot, true)
      : settlement.simulation.reloadSnapshot(snapshot);
    if (!reloaded.ok) console.warn(`The island kept playing without its snapshot reload: ${reloaded.reason}`);
    onReloaded?.(reloaded.ok);
  });
  return true;
};
