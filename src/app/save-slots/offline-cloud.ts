import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { OfflineSlotMode } from "../../../../island-of-settlers-shared/src/offline-slots";
import type { PlayerAccount } from "../account/account-boot";
import type { CloudSession } from "../cloud/cloud-boot";
import { browserWorkingSlot, isOfflineMode } from "../game-settings/session-mode";
import type { SaveStore } from "../save-store/save-store";
import { openGameDatabase } from "../settlement/game-database";
import { buildSlotDumpInWorker, importSlotDumpInWorker } from "../settlement/game-session-worker";
import { OFFLINE_STORY_SLOT } from "../settlement/game-slot-rows";
import { createOfflineSlotsClient, type OfflineSlotsClient } from "./offline-slots-client";
import { createServerSlotRepository } from "./server-slot-repository";
import type { SlotRepository } from "./slot-repository";
import { createWorkingSlotSync, type SlotTransfer, type WorkingSlotSync } from "./working-slot-sync";

/**
 * A signed-in offline player's server saves (OFFLINE-CLOUD, plan §7.1): Save/Load slots in the api's unverified
 * offline store and a copy of the working slot. Guests and tool runs keep browser-only slots; online sessions never
 * open one (their cloud slot is the verified store).
 */
export interface OfflineCloud {
  api: OfflineSlotsClient;
  mode: OfflineSlotMode;
  sync: WorkingSlotSync;
  workingSlotId: string;
}

export interface OfflineCloudBoot {
  account: PlayerAccount | null;
  cloud: CloudSession | null;
  settings: GameSettings | null;
  toolRun: boolean;
}

/** The offline store's mode of a browser working slot. */
export const offlineSlotModeOf = (workingSlotId: string): OfflineSlotMode =>
  workingSlotId === OFFLINE_STORY_SLOT ? "story" : "home";

/** True when this session keeps its offline saves on the server too. */
export const wantsOfflineCloud = ({ account, cloud, settings, toolRun }: OfflineCloudBoot) =>
  isOfflineMode(settings) && account !== null && cloud === null && !toolRun;

const WORKER_TRANSFER: SlotTransfer = { exportSlot: buildSlotDumpInWorker, importSlot: importSlotDumpInWorker };

/**
 * The session's offline cloud, or null: offline mode, signed in, IndexedDB (the localStorage fallback cannot read a
 * slot's records), and no tool run.
 */
export const openOfflineCloud = async (boot: OfflineCloudBoot): Promise<OfflineCloud | null> => {
  if (!wantsOfflineCloud(boot)) return null;
  const database = await openGameDatabase();
  if (database.backend !== "indexeddb") return null;
  const { backend, identity } = boot.account!;
  const api = createOfflineSlotsClient({ apiUrl: backend.apiUrl, getAccessToken: identity.accessToken,
    renewAccessToken: identity.renew });
  const workingSlotId = browserWorkingSlot(boot.settings), mode = offlineSlotModeOf(workingSlotId);
  const sync = createWorkingSlotSync({ accountId: boot.account!.account.id, api, database, mode, now: Date.now,
    transfer: WORKER_TRANSFER, workingSlotId });
  return { api, mode, sync, workingSlotId };
};

/** The Save/Load slots on the server, behind the SAVE-SLOTS seam. */
export const openServerSlotRepository = async (offline: OfflineCloud): Promise<SlotRepository> =>
  createServerSlotRepository({ ...offline, database: await openGameDatabase(), now: Date.now,
    transfer: WORKER_TRANSFER });

type Write<Args extends unknown[], Result> = (...args: Args) => Promise<Result>;

/** The working slot's store whose every write also schedules the server copy (browser first, upload after). */
export const withWorkingSlotSync = <Store extends SaveStore>(store: Store, sync: WorkingSlotSync): Store => {
  const after = <Args extends unknown[], Result>(write: Write<Args, Result>): Write<Args, Result> =>
    async (...args) => {
      const result = await write(...args);
      sync.changed();
      return result;
    };
  const { endRunWithoutHome, writeArchivedIslandGame } = store;
  return {
    ...store,
    ...(endRunWithoutHome ? { endRunWithoutHome: after(endRunWithoutHome) } : {}),
    ...(writeArchivedIslandGame ? { writeArchivedIslandGame: after(writeArchivedIslandGame) } : {}),
    writeCapturedGame: after(store.writeCapturedGame),
    writeSavedGame: after(store.writeSavedGame)
  };
};

/** The browser working slot's store, synced to the server when the session keeps offline saves there. */
export const withOfflineCloud = <Store extends SaveStore>(store: Store, offline: OfflineCloud | null) =>
  offline ? withWorkingSlotSync(store, offline.sync) : store;
