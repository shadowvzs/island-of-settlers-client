import type { OfflineSlotMode, OfflineSlotSummary } from "../../../../island-of-settlers-shared/src/offline-slots";
import type { GameDatabase } from "../settlement/game-database";
import { SAVE_SLOT_NUMBERS, SLOTS_NEED_INDEXEDDB } from "./constants";
import type { OfflineSlotsClient } from "./offline-slots-client";
import { type SaveSlotEntry, saveSlotId } from "./slot-meta";
import type { SlotRepository } from "./slot-repository";
import type { SlotTransfer, WorkingSlotSync } from "./working-slot-sync";

/**
 * The Save/Load slots of a signed-in offline player (OFFLINE-CLOUD) behind the SAVE-SLOTS seam: the slots live in the
 * api's unverified offline store, the working slot stays in this browser (with its server copy, slot 0). Save
 * uploads a dump of the working slot; Load downloads one over it. Both dumps are built and read in the game-session
 * worker.
 */
export interface ServerSlotRepositoryOptions {
  api: OfflineSlotsClient;
  database: Pick<GameDatabase, "clearGame" | "removeGame">;
  mode: OfflineSlotMode;
  now: () => number;
  sync: WorkingSlotSync;
  transfer: SlotTransfer;
  workingSlotId: string;
}

/** Every Save/Load slot of the mode (1 … 10, empty ones included) from the server's summaries. */
export const serverSaveSlots = (workingSlotId: string, summaries: readonly OfflineSlotSummary[]): SaveSlotEntry[] => {
  const metas = new Map(summaries.map(summary => [summary.slotNo, summary.meta]));
  return SAVE_SLOT_NUMBERS.map(number =>
    ({ meta: metas.get(number) ?? null, number, slotId: saveSlotId(workingSlotId, number) }));
};

/** A Save/Load slot number (never the working slot 0). */
const saveSlotNumber = (number: number) => {
  if (!SAVE_SLOT_NUMBERS.includes(number)) throw new RangeError(`Save slot ${number} is outside the slot list`);
  return number;
};

export const createServerSlotRepository = (options: ServerSlotRepositoryOptions): SlotRepository => {
  const { api, database, mode, sync, transfer, workingSlotId } = options;
  const list = async () => serverSaveSlots(workingSlotId, await api.list(mode));
  /** The local working slot already changed: a failed copy upload retries later instead of failing the action. */
  const copyWorking = () => sync.uploadNow().catch(() => sync.changed());
  return {
    discardWorking: async () => {
      await database.clearGame(workingSlotId);
      await copyWorking();
    },
    list,
    loadIntoWorking: async number => {
      const json = await api.download(mode, saveSlotNumber(number));
      if (!json) throw new Error(`Save slot ${number} is empty`);
      await transfer.importSlot(workingSlotId, json);
      await copyWorking();
    },
    newGame: async () => {
      if (!database.removeGame) throw new Error(SLOTS_NEED_INDEXEDDB);
      await database.removeGame(workingSlotId);
      await sync.forget();
    },
    remove: number => api.remove(mode, saveSlotNumber(number)),
    saveFromWorking: async (number, input) => {
      const { body } = await transfer.exportSlot(workingSlotId, { ...input, savedAt: options.now() });
      await api.upload(mode, saveSlotNumber(number), body);
    },
    workingSlotId
  };
};
