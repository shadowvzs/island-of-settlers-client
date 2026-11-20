import { SAVE_SLOT_LIMIT } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import { SLOT_META_KEY } from "../settlement/game-slot-rows";

/** The slot meta's shape is shared with the server's offline store (OFFLINE-CLOUD). */
export {
  SLOT_LABEL_MAX_LENGTH, SLOT_META_VERSION, SLOT_SHOWS_KINDS
} from "../../../../island-of-settlers-shared/src/offline-slots";

/** Save/Load slots (SAVE-SLOTS, plan §5.6). */

/** Slot ids are `<working slot>.<number>`: the number part. */
export const SLOT_NUMBER_PATTERN = /^[1-9]\d*$/;
/** Slot numbers 1 … SAVE_SLOT_LIMIT (10 per mode, plan §5.6). */
export const SAVE_SLOT_NUMBERS: readonly number[] = Object.freeze(
  Array.from({ length: SAVE_SLOT_LIMIT }, (_, index) => index + 1));
/** The listed boot values of slot metas end with this. */
export const SLOT_META_SUFFIX = `/${SLOT_META_KEY}`;
/** The browser's storage is full (IndexedDB transaction error name). */
export const QUOTA_ERROR_NAME = "QuotaExceededError";
/** Named HUD icons of the slot actions: the floppy disk, the import arrow, demolish. */
export const SLOT_ACTION_ICONS = Object.freeze({ delete: "demolish", load: "import", save: "save" } as const);
/** The English refusal on the localStorage fallback (rev I12); the UI shows its own translated reason. */
export const SLOTS_NEED_INDEXEDDB = "Save slots need IndexedDB in this browser";
/** A copy failed for lack of browser storage (the worker answers only an error's message). */
export const SLOT_STORAGE_FULL = "Not enough browser storage: delete a save";

/** OFFLINE-CLOUD: boot value of the working slot's sync state (server time of the last synced copy, unsent writes). */
export const CLOUD_SYNC_KEY = "cloud-sync";
const SECOND_MS = 1000;
/** At most one working-slot upload per automatic-saving interval (2 minutes). */
export const WORKING_UPLOAD_INTERVAL_MS = 120 * SECOND_MS;
/** The api accepts one offline slot write per account every 2 s (rate-limits.ts `offlineSlotWrites`). */
export const OFFLINE_WRITE_SPACING_MS = 2_100;
/** Byte arrays travel in a slot dump as `{ "$bytes": base64 }`. */
export const DUMP_BYTES_TAG = "$bytes";
/** Online without a home the working slot is the verified cloud slot: New game / Leave without saving do not apply. */
export const CLOUD_SLOT_KEEPS_WORKING = "The cloud save slot keeps the running game";
