import {
  OFFLINE_WORKING_SLOT_NO, type OfflineSlotMode, type SlotMeta
} from "../../../../island-of-settlers-shared/src/offline-slots";
import type { GameDatabase } from "../settlement/game-database";
import { slotValueKey, STORY_PROGRESS_KEY } from "../settlement/game-slot-rows";
import { CLOUD_SYNC_KEY, SLOTS_NEED_INDEXEDDB, WORKING_UPLOAD_INTERVAL_MS } from "./constants";
import type { OfflineSlotsClient } from "./offline-slots-client";
import type { SlotDumpUpload } from "./slot-dump";
import type { SlotMetaInput } from "./slot-meta";

/**
 * The working slot's server copy for signed-in offline players (OFFLINE-CLOUD, the recovery-copy pattern): the browser
 * slot is written first, then a throttled upload copies it to server slot 0. A boot brings the server copy down
 * only when it is newer than this browser's last sync and nothing local is waiting for its upload: unsent local
 * play is never overwritten, and a browser that never synced keeps its own game (it becomes the account's copy).
 * The browser's offline working slot is shared by whoever signs in on it: the sync state names its account, and a
 * synced game of another account is replaced by this account's copy (it is safe on that account's server store).
 */

interface SyncMarker {
  /** The account whose copy the working slot holds; null in states written before an account was known. */
  account: string | null;
  dirty: boolean;
  /** The server's `savedAt` (ISO) of the copy this browser last uploaded or downloaded. */
  syncedAt: string | null;
}

/** Moves slot rows between the browser database and the server dump (the game-session worker in the game). */
export interface SlotTransfer {
  exportSlot(slotId: string, meta: SlotMetaInput): Promise<SlotDumpUpload>;
  importSlot(slotId: string, json: ArrayBuffer): Promise<SlotMeta>;
}

export interface WorkingSlotSyncOptions {
  /** The signed-in account. */
  accountId: string;
  api: OfflineSlotsClient;
  database: Pick<GameDatabase, "hasGame" | "readValue" | "removeGame" | "removeValue" | "writeValue">;
  intervalMs?: number;
  mode: OfflineSlotMode;
  now: () => number;
  schedule?: (run: () => void, delayMs: number) => unknown;
  transfer: SlotTransfer;
  workingSlotId: string;
}

export interface WorkingSlotSync {
  /** The browser's working slot was written: remember it and upload soon (throttled). */
  changed(): void;
  /** The working slot is gone (New game): the server copy and the sync state go too. */
  forget(): Promise<void>;
  /** Boot: brings a newer server copy down; true when the working slot was replaced or cleared. */
  pull(): Promise<boolean>;
  /** Uploads the working slot now (after Load or Leave without saving replaced it). */
  uploadNow(): Promise<void>;
}

const parseMarker = (json: string | null): SyncMarker | null => {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<SyncMarker>;
    return { account: typeof value.account === "string" ? value.account : null, dirty: value.dirty === true,
      syncedAt: typeof value.syncedAt === "string" ? value.syncedAt : null };
  } catch {
    return null;
  }
};

const isNewer = (serverSavedAt: string, syncedAt: string | null) =>
  syncedAt === null || Date.parse(serverSavedAt) > Date.parse(syncedAt);

export const createWorkingSlotSync = (options: WorkingSlotSyncOptions): WorkingSlotSync => {
  const { accountId, api, database, mode, transfer, workingSlotId } = options;
  const intervalMs = options.intervalMs ?? WORKING_UPLOAD_INTERVAL_MS;
  const schedule = options.schedule ?? ((run, delayMs) => setTimeout(run, delayMs));
  const markerKey = slotValueKey(workingSlotId, CLOUD_SYNC_KEY);
  const readMarker = async () => parseMarker(await database.readValue(markerKey));
  const writeMarker = (dirty: boolean, syncedAt: string | null) =>
    database.writeValue(markerKey, JSON.stringify({ account: accountId, dirty, syncedAt } satisfies SyncMarker));
  /** Another account's unsent play holds the working slot: this session never copies it to this account. */
  let foreign = false;
  let changes = 0, lastUpload = -Infinity, scheduled = false, knownDirty = false;
  let running: Promise<void> | null = null;

  const upload = async () => {
    const generation = changes;
    lastUpload = options.now();
    const { body } = await transfer.exportSlot(workingSlotId, { savedAt: options.now() });
    const stored = await api.upload(mode, OFFLINE_WORKING_SLOT_NO, body);
    knownDirty = generation !== changes;
    await writeMarker(knownDirty, stored.savedAt);
  };
  const uploadNow = () => {
    if (foreign) return Promise.resolve();
    return running ??= upload().finally(() => { running = null; });
  };
  const uploadLater = () => {
    if (scheduled || foreign) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      void uploadNow().then(() => knownDirty && uploadLater(), uploadLater);
    }, Math.max(0, lastUpload + intervalMs - options.now()));
  };
  const markDirty = async () => {
    if (knownDirty || foreign) return;
    knownDirty = true;
    await writeMarker(true, (await readMarker())?.syncedAt ?? null);
  };
  const hasLocalGame = async () => await database.hasGame(workingSlotId) ||
    await database.readValue(slotValueKey(workingSlotId, STORY_PROGRESS_KEY)) !== null;
  const download = async (savedAt: string) => {
    const json = await api.download(mode, OFFLINE_WORKING_SLOT_NO);
    if (!json) return false;
    await transfer.importSlot(workingSlotId, json);
    await writeMarker(false, savedAt);
    return true;
  };
  /** Another account's game: kept when it has unsent play, else cleared for this account's copy. */
  const leaveForeignSlot = async (marker: SyncMarker) => {
    if (marker.dirty) {
      foreign = true;
      return false;
    }
    if (!database.removeGame) throw new Error(SLOTS_NEED_INDEXEDDB);
    await database.removeGame(workingSlotId);
    await database.removeValue(markerKey);
    return true;
  };
  const pullServerCopy = async (marker: SyncMarker | null) => {
    const server = (await api.list(mode)).find(slot => slot.slotNo === OFFLINE_WORKING_SLOT_NO);
    if (!server || !isNewer(server.savedAt, marker?.syncedAt ?? null)) return false;
    if (!marker && await hasLocalGame()) return false;
    return download(server.savedAt);
  };

  return {
    changed: () => {
      changes++;
      void markDirty().catch(() => { knownDirty = false; });
      uploadLater();
    },
    forget: async () => {
      await api.remove(mode, OFFLINE_WORKING_SLOT_NO);
      await database.removeValue(markerKey);
      knownDirty = false;
    },
    pull: async () => {
      const marker = await readMarker();
      if (marker?.account && marker.account !== accountId) {
        if (!(await leaveForeignSlot(marker))) return false;
        await pullServerCopy(null);
        return true;
      }
      if (marker?.dirty) {
        knownDirty = true;
        uploadLater();
        return false;
      }
      return pullServerCopy(marker);
    },
    uploadNow
  };
};
