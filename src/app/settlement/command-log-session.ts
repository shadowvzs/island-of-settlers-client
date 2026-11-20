import { SOURCE_VERSION } from "virtual:source-version";

import { createCommandLogRecorder } from "../../shared/settlement/command-log";
import { activeSaveKey } from "../../shared/settlement/game-save-rows";
import type { CapturedGame } from "../save-store/captured-game";
import { takeCapturedSettlementOwnership } from "../save-store/captured-ownership";
import type { HeldFrameJobs } from "./held-frame-jobs";
import type { IslandSettlement } from "./island-settlement";
import { queueSnapshotReload } from "./snapshot-reload";

const NO_RELOAD_GAP = "Bug replay recording: the island played on without its snapshot reload";
const FAILED_RELOAD_GAP = "The island played on without its snapshot reload (failed, or a command came first)";
const STOCK_MOVE_GAP = "The server moved island goods; local commands before the new base are not replayable";

/**
 * The island's command log between uploads (D4.2): a save's capture closes the interval, and the in-place reload
 * of that snapshot opens the next one, so every interval starts exactly where the server's replay starts.
 */
export const createCommandLogSession = (
  settlement: Pick<IslandSettlement, "bugReplay" | "simulation">, jobs: Pick<HeldFrameJobs, "queue">
) => {
  const recorder = createCommandLogRecorder(settlement.simulation, { sourceVersion: SOURCE_VERSION });
  let disposed = false;
  let reloadGeneration = 0;
  recorder.open();
  return {
    /**
     * At a save's capture: the finished interval with the island's draw ring buffer at its end, and the snapshot
     * reload that opens the next interval.
     */
    capture: (captured: CapturedGame): Pick<CapturedGame, "commandLog" | "commandLogTrail"> => {
      if (disposed) return { commandLog: null, commandLogTrail: settlement.simulation.randomAudit().draws() };
      // A campaign run logs under its own run key, never under the filed home island (C2).
      const interval = recorder.close(activeSaveKey(captured));
      const trail = settlement.simulation.randomAudit().draws();
      const generation = reloadGeneration;
      const queued = queueSnapshotReload(settlement, jobs, captured.save[1],
        reloaded => {
          if (disposed || generation !== reloadGeneration) return;
          recorder.open(reloaded ? undefined : [FAILED_RELOAD_GAP]);
        }, () => disposed || generation !== reloadGeneration || recorder.changedSinceClose(),
        takeCapturedSettlementOwnership);
      if (!queued) recorder.open([NO_RELOAD_GAP]);
      return { commandLog: interval, commandLogTrail: trail };
    },
    /** Stops the departing island's recorder; a queued snapshot reload cannot reopen it. */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      reloadGeneration++;
      recorder.dispose();
    },
    /**
     * The server moved island goods and saved the slot at `revision` outside this interval: drop the open interval
     * and reopen at the local (already adjusted) state. Commands in the dropped interval are no longer replayable
     * from the server's new base, so the next interval carries a gap instead of a wrong checksum chain.
     */
    rebase: (island: string) => {
      if (disposed) return;
      // The server's accepted state supersedes every earlier captured snapshot, even while
      // a lifecycle hold prevents its queued reload from running. Old callbacks must not
      // restore that state or reopen over the new authoritative command interval.
      reloadGeneration++;
      const dropped = recorder.close(island);
      const changed = Boolean(dropped && (dropped.entries.length || dropped.gaps?.length));
      recorder.open(changed ? [STOCK_MOVE_GAP] : undefined);
    }
  };
};
