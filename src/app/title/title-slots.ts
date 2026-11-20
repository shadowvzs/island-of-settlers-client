import { attemptSlot, type SaveSlotsControls, type SlotResult } from "../save-slots/slot-actions";
import { newestSaveSlot } from "../save-slots/slot-meta";
import type { SlotRepository } from "../save-slots/slot-repository";
import type { TitleSlotFacts } from "./helpers";

/** The session's slots on the title page (SAVE-SLOTS); absent while slots are off. */
export interface TitleSlotsOptions {
  /** Automatic saving on: Continue resumes the working slot; off: it loads the newest slot (owner §19.2). */
  autosave: boolean;
  /** Reloads the title page (a New game without a home resets the progress the page already read). */
  reload: () => void;
  repository: SlotRepository;
  /** False when New game cannot reset the working slot (a signed-in cloud slot); default true. */
  resettable?: boolean;
}

interface TitleSlotsContext {
  /** Lets the boot continue into the working slot. */
  finish: () => void;
  /** The game has a home island: New game boots a fresh island instead of reloading the title page. */
  home: boolean;
}

/**
 * Load, Continue and New game on the title page (plan §5.6, §7.5). No world or save coordinator exists here, so a
 * load copies the slot over the working slot and the boot continues into it.
 */
export const createTitleSlots = async (options: TitleSlotsOptions | undefined, context: TitleSlotsContext) => {
  const repository = options?.repository;
  const entries = repository ? await repository.list().catch(() => []) : [];
  const count = entries.filter(entry => entry.meta !== null).length;
  const load = async (number: number): Promise<SlotResult> => {
    if (!repository) return "failed";
    const result = await attemptSlot(() => repository.loadIntoWorking(number));
    if (result === true) context.finish();
    return result;
  };
  const continueGame = async (): Promise<SlotResult> => {
    if (!options || options.autosave) {
      context.finish();
      return true;
    }
    const newest = newestSaveSlot(entries);
    return newest ? load(newest.number) : "failed";
  };
  const newGame = async (): Promise<SlotResult> => {
    const result = repository ? await attemptSlot(() => repository.newGame()) : true;
    if (result !== true) return result;
    if (context.home || !options) context.finish();
    else options.reload();
    return true;
  };
  const controls: SaveSlotsControls | null = repository ? {
    list: () => repository.list(), load, remove: number => attemptSlot(() => repository.remove(number))
  } : null;
  const facts: TitleSlotFacts | undefined = options
    ? { autosave: options.autosave, count, ...(options.resettable === false ? { resettable: false } : {}) }
    : undefined;
  return { continueGame, controls, facts, newGame };
};

export type TitleSlots = Awaited<ReturnType<typeof createTitleSlots>>;
