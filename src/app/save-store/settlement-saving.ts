import type { ShipFrame } from "../../render-common/ships/ship-frame";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { createTickBoundary, type FrameJobQueue, type SaveCoordinator } from "./save-coordinator";
import { createSaveEventWatch, watchPageHide } from "./save-events";

type PageEvents = Pick<Window, "addEventListener" | "removeEventListener">;

interface SettlementSaver {
  /** Waits for a running save or load, then saves with `notice`; `null` keeps a background save silent. */
  saveWhenIdle: (notice?: string | null) => Promise<boolean>;
}

interface SettlementSavingOptions {
  /** Resolves at an idle moment (camera still, tab hidden, a menu open). */
  idleMoment?: (signal?: AbortSignal) => Promise<void>;
  /** The settlement's held frames: saves capture (and reload) in frames that do not tick. */
  jobs: FrameJobQueue;
  page?: PageEvents;
}

/**
 * Binds the save coordinator to the running settlement: saves wait for an idle moment and a held frame, the dirty
 * flag follows every update, key events come from the 0.5 s UI pass, and the tab closing flushes one last save.
 */
export const bindSettlementSaving = (
  saving: SaveCoordinator, saver: SettlementSaver, { idleMoment, jobs, page = window }: SettlementSavingOptions
) => {
  const ticks = createTickBoundary(jobs), events = createSaveEventWatch();
  // Automatic saves (interval, game events, tab hiding) are silent; explicit saves keep their own notice.
  saving.attach({ betweenTicks: ticks.betweenTicks, idleMoment, save: () => saver.saveWhenIdle(null) });
  const unwatchPageHide = watchPageHide(saving, page);
  return {
    /** Every settlement update: a simulated step is a change. */
    afterTick: (simulated: boolean) => {
      if (simulated) saving.markDirty();
    },
    /** The 0.5 s UI pass: a finished construction/upgrade or a ship sailing off or returning saves soon. */
    checkEvents: (buildings: readonly SettlementBuilding[], ships: readonly Pick<ShipFrame, "phase">[]) => {
      if (events(buildings, ships)) saving.request();
    },
    /** A page handoff that already saved the game (travel, load, resume): no later save may overwrite it. */
    stop: () => {
      saving.stop();
      unwatchPageHide();
    }
  };
};


