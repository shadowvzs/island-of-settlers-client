import type { SaveCoordinator } from "../save-store/save-coordinator";
import { SLOT_STORAGE_FULL, SLOTS_NEED_INDEXEDDB } from "./constants";
import type { SaveSlotEntry } from "./slot-meta";
import type { SlotRepository, SlotSaveInput } from "./slot-repository";

/** Why a slot action did not happen (the view translates it). */
export type SlotFailure = "busy" | "failed" | "noIndexedDb" | "saveFailed" | "storageFull";
export type SlotResult = true | SlotFailure;

/** What the Save/Load list needs: the title page leaves `save` out (it only loads and deletes). */
export interface SaveSlotsControls {
  list(): Promise<SaveSlotEntry[]>;
  load(number: number): Promise<SlotResult>;
  remove(number: number): Promise<SlotResult>;
  save?(number: number, label: string): Promise<SlotResult>;
}

/** The save coordinator as the slot actions use it. */
export type SlotSaving = Pick<SaveCoordinator, "flush" | "isSuspended" | "setSuspended" | "stop" | "whenIdle">;

/** A thrown copy/removal as the view's reason (the worker answers only error messages). */
export const slotFailureOf = (error: unknown): SlotFailure => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === SLOT_STORAGE_FULL) return "storageFull";
  return message === SLOTS_NEED_INDEXEDDB ? "noIndexedDb" : "failed";
};

/** Runs a storage action and answers `true` or the failure. */
export const attemptSlot = async (action: () => Promise<unknown>): Promise<SlotResult> => {
  try {
    await action();
    return true;
  } catch (error) {
    return slotFailureOf(error);
  }
};

/**
 * Takes the writes away from the coordinator: no save may start (a pagehide checkpoint included) and the one in
 * flight finishes first. Returns false while a transition (travel, hand-off) already owns them.
 */
const holdSaving = async (saving: SlotSaving) => {
  if (saving.isSuspended()) return false;
  saving.setSuspended(true);
  await saving.whenIdle();
  return true;
};

/** Holds saving, runs `action`, then stops saving for good and leaves; a failed action gives the writes back. */
const leaveAfter = async (saving: SlotSaving, action: () => Promise<unknown>, leave: () => void) => {
  if (!(await holdSaving(saving))) return "busy";
  const result = await attemptSlot(action);
  if (result !== true) {
    saving.setSuspended(false);
    return result;
  }
  saving.stop();
  leave();
  return true;
};

export interface InGameSlotOptions {
  /** Reloads to the start URL that continues the working slot (`?continue=1`). */
  continueGame: () => void;
  /** Reloads to the title page. */
  exitToTitle: () => void;
  /** The map's name for a new slot's meta, when the game knows it. */
  place?: () => string | undefined;
  repository: SlotRepository;
  saving: SlotSaving;
}

/**
 * Save/Load in game (plan §5.6, §7.6). Save: the working slot is flushed (`manual`), then copied into the slot.
 * Load: saving is held (no checkpoint can overwrite the copy, rev I4), the slot is copied over the working slot,
 * saving stops and the page reloads into it. Leave without saving (automatic saving off) discards the working slot's
 * rows the same way and returns to the title page.
 */
export const createInGameSlots = (options: InGameSlotOptions) => {
  const { repository, saving } = options;
  const save = async (number: number, label: string): Promise<SlotResult> => {
    if (saving.isSuspended()) return "busy";
    if (!(await saving.flush("manual"))) return "saveFailed";
    const input: SlotSaveInput = { label, place: options.place?.() };
    return attemptSlot(() => repository.saveFromWorking(number, input));
  };
  const controls: SaveSlotsControls = {
    list: () => repository.list(),
    load: number => leaveAfter(saving, () => repository.loadIntoWorking(number), options.continueGame),
    remove: number => attemptSlot(() => repository.remove(number)),
    save
  };
  const leaveWithoutSaving = async () =>
    await leaveAfter(saving, () => repository.discardWorking(), options.exitToTitle) === true;
  return { controls, leaveWithoutSaving };
};

export type InGameSlots = ReturnType<typeof createInGameSlots>;
