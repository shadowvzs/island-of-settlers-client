import type { GameDatabase } from "../settlement/game-database";
import type { CloudSlotOwner } from "./cloud-slot-repository";
import { SLOT_META_SUFFIX, SLOTS_NEED_INDEXEDDB } from "./constants";
import type { OfflineCloud } from "./offline-cloud";
import type { SlotCopyRequest } from "./slot-copy";
import { listSaveSlots, type SaveSlotEntry,saveSlotId } from "./slot-meta";

/** What the player gives a slot save besides the slot number. */
export interface SlotSaveInput {
  label?: string;
  /** The map's name when the game knows it. */
  place?: string;
}

/**
 * The Save/Load slots of one working slot (plan §5.6 seam): IndexedDB here, the api's offline store for signed-in
 * offline players (OFFLINE-CLOUD, `server-slot-repository.ts`). Every copy is table level and runs in the
 * game-session worker.
 */
export interface SlotRepository {
  /** Leave without saving: the working slot's rows go; its story progress and map bases stay. */
  discardWorking(): Promise<void>;
  /** The mode's 10 slots (empty ones included), read from the slot metas only. */
  list(): Promise<SaveSlotEntry[]>;
  /** Copies slot `number` over the working slot (the caller stopped saving first). */
  loadIntoWorking(number: number): Promise<void>;
  /** Clears the working slot: rows, map bases and story progress (saved slots stay). */
  newGame(): Promise<void>;
  /** Deletes slot `number`: its rows, map bases and meta. */
  remove(number: number): Promise<void>;
  /** Copies the working slot (already flushed) into slot `number`, replacing what it held. */
  saveFromWorking(number: number, input: SlotSaveInput): Promise<void>;
  readonly workingSlotId: string;
}

export interface SlotRepositoryOptions {
  /** The table-level copy (the game-session worker in the game). */
  copy: (request: SlotCopyRequest) => Promise<void>;
  database: Pick<GameDatabase, "clearGame" | "listValues" | "removeGame">;
  now: () => number;
  /** Asks the browser to keep the storage (Safari and storage pressure may evict it, rev I13); once per page. */
  persist?: () => Promise<unknown>;
  workingSlotId: string;
}

/** Asks for persistent storage once; a refusal or a missing API changes nothing. */
const persistOnce = (persist: SlotRepositoryOptions["persist"]) => {
  let asked = false;
  return () => {
    if (asked || !persist) return;
    asked = true;
    void persist().catch(() => undefined);
  };
};

export const createSlotRepository = (options: SlotRepositoryOptions): SlotRepository => {
  const { copy, database, workingSlotId } = options;
  const askPersistence = persistOnce(options.persist);
  const removeGame = (slotId: string) => {
    if (!database.removeGame) return Promise.reject(new Error(SLOTS_NEED_INDEXEDDB));
    return database.removeGame(slotId);
  };
  const list = async () => listSaveSlots(workingSlotId, await database.listValues(SLOT_META_SUFFIX));
  return {
    discardWorking: () => database.clearGame(workingSlotId),
    list,
    loadIntoWorking: async number => {
      const entry = (await list()).find(slot => slot.number === number);
      if (!entry?.meta) throw new Error(`Save slot ${number} is empty`);
      await copy({ from: entry.slotId, meta: null, to: workingSlotId });
    },
    newGame: () => removeGame(workingSlotId),
    remove: number => removeGame(saveSlotId(workingSlotId, number)),
    saveFromWorking: async (number, input) => {
      askPersistence();
      const to = saveSlotId(workingSlotId, number);
      await copy({ from: workingSlotId, meta: { ...input, savedAt: options.now() }, to });
    },
    workingSlotId
  };
};

/** Where a session's Save/Load slots live besides this browser. */
export interface SlotStores {
  /** A signed-in cloud slot without a home: copies of its game in the server's store (D1b). */
  cloud?: CloudSlotOwner | null;
  /** A signed-in offline player: the server's offline store. */
  offline?: OfflineCloud | null;
}

/**
 * The repository of the working slot: copies of a signed-in cloud slot, the server's offline store when the session
 * keeps its offline saves there, else IndexedDB, copying in the game-session worker.
 */
export const openSlotRepository = async (
  workingSlotId: string, { cloud, offline }: SlotStores = {}
): Promise<SlotRepository> => {
  if (cloud) return (await import("./cloud-slot-repository")).openCloudSlotRepository(cloud, workingSlotId);
  if (offline) return (await import("./offline-cloud")).openServerSlotRepository(offline);
  const [{ openGameDatabase }, { copyGameSlotInWorker }] = await Promise.all([
    import("../settlement/game-database"), import("../settlement/game-session-worker")]);
  return createSlotRepository({
    copy: copyGameSlotInWorker, database: await openGameDatabase(), now: Date.now,
    persist: () => globalThis.navigator?.storage?.persist?.() ?? Promise.resolve(false), workingSlotId
  });
};
