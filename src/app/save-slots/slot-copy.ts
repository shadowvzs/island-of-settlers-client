import type { GameDatabase } from "../settlement/game-database";
import { QUOTA_ERROR_NAME, SLOT_STORAGE_FULL, SLOTS_NEED_INDEXEDDB } from "./constants";
import { buildSlotMeta, type SlotMetaInput, slotSourceOf } from "./slot-meta";

/** One slot copy as the game-session worker receives it (plan §5.6: the copy never runs on the frame). */
export interface SlotCopyRequest {
  from: string;
  /** Present when the target is a Save/Load slot: its meta is written in the copy's transaction. */
  meta: SlotMetaInput | null;
  to: string;
}

const isQuotaError = (error: unknown) => (error as { name?: string } | null)?.name === QUOTA_ERROR_NAME;

/** A full browser storage as the slot UI's reason (the worker answers only an error's message). */
export const slotStorageError = (error: unknown) => isQuotaError(error) ? new Error(SLOT_STORAGE_FULL) : error;

/** Copies one slot onto another (worker side, or the page in tests); the meta is built from the copied rows. */
export const copyGameSlot = async (database: Pick<GameDatabase, "copyGame">, request: SlotCopyRequest) => {
  if (!database.copyGame) throw new Error(SLOTS_NEED_INDEXEDDB);
  const { meta } = request;
  try {
    await database.copyGame(request.from, request.to,
      meta ? records => JSON.stringify(buildSlotMeta(meta, slotSourceOf(records))) : undefined);
  } catch (error) {
    throw slotStorageError(error);
  }
};
