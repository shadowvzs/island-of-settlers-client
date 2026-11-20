import { requestToPromise } from "../helpers";
import { CAMPAIGN_SLOT_PREFIX } from "./campaign/constants";

const DATABASE = "island-maps";
/** Slot id -> MapSlot (small: the list reads only these). */
const SLOTS = "slots";
/** Slot id -> the map file bytes. */
const FILES = "files";
/** The slot of a map file opened from disk: kept for the reload that loads it, never listed. */
export const OPENED_FILE_SLOT = "opened-file";
/** The map of the running admin play-test (Script window "Test play"): rewritten by every test, never listed. */
export const TEST_PLAY_SLOT = "test-play";
/** Content-addressed copies of published starter maps; hidden from the user's draft list. */
export const PUBLISHED_MAP_PREFIX = "published-map:";

/** A saved map in the browser: its name, when it was saved and the file size. */
export interface MapSlot {
  id: string;
  name: string;
  savedAt: number;
  size: number;
}

const openDatabase = () => {
  const opening = indexedDB.open(DATABASE, 1);
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore(SLOTS);
    opening.result.createObjectStore(FILES);
  };
  return requestToPromise(opening);
};

/** Resolves once a write transaction is committed. */
const commit = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const createMapStorage = (database: IDBDatabase) => ({
  close: () => database.close(),
  /** Removes a slot and its file. */
  delete: (id: string) => {
    const transaction = database.transaction([SLOTS, FILES], "readwrite");
    transaction.objectStore(SLOTS).delete(id);
    transaction.objectStore(FILES).delete(id);
    return commit(transaction);
  },
  /** The listed slots, newest first (campaign map files belong to the campaign editor, not this list). */
  list: async () => {
    const store = database.transaction(SLOTS).objectStore(SLOTS);
    const slots = await requestToPromise(store.getAll() as IDBRequest<MapSlot[]>);
    return slots
      .filter(({ id }) => id !== OPENED_FILE_SLOT && id !== TEST_PLAY_SLOT &&
        !id.startsWith(PUBLISHED_MAP_PREFIX) && !id.startsWith(CAMPAIGN_SLOT_PREFIX))
      .sort((first, second) => second.savedAt - first.savedAt);
  },
  /** Drops the content-addressed starter copies (administrator maintenance M11); the next load fetches again. */
  removePublishedCopies: () => {
    const published = IDBKeyRange.bound(PUBLISHED_MAP_PREFIX, `${PUBLISHED_MAP_PREFIX}\uffff`);
    const transaction = database.transaction([SLOTS, FILES], "readwrite");
    transaction.objectStore(SLOTS).delete(published);
    transaction.objectStore(FILES).delete(published);
    return commit(transaction);
  },
  /** The file of a slot, or null when there is none. */
  read: async (id: string) => {
    const store = database.transaction(FILES).objectStore(FILES);
    const bytes = await requestToPromise(store.get(id) as IDBRequest<Uint8Array | undefined>);
    return bytes ?? null;
  },
  /** Stores (or overwrites) a slot with its file. */
  write: (slot: MapSlot, bytes: Uint8Array) => {
    const transaction = database.transaction([SLOTS, FILES], "readwrite");
    transaction.objectStore(SLOTS).put(slot, slot.id);
    transaction.objectStore(FILES).put(bytes, slot.id);
    return commit(transaction);
  }
});

export type MapStorage = ReturnType<typeof createMapStorage>;

/**
 * The map slots in IndexedDB, or null where the browser gives no storage (private mode, blocked
 * site data): saving and loading files still works then.
 */
export const openMapStorage = async (): Promise<MapStorage | null> => {
  if (typeof indexedDB === "undefined") return null;
  try {
    return createMapStorage(await openDatabase());
  } catch {
    return null;
  }
};
