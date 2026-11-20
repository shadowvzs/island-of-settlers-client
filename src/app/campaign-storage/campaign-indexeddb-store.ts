import {
  CAMPAIGN_RECORD_KINDS, type CampaignRepositories
} from "../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import {
  type CampaignRecordEnvelope, type CampaignRecordStore, createStoreCampaignRepositories
} from "../../../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import { requestToPromise } from "../helpers";

/**
 * Local campaign repository (owner 2026-11-09: IndexedDB when the game runs without a server). Its own database,
 * like the editor's `island-maps`, so campaign authoring never bumps or resets the game save database. One object
 * store per record kind, keyed by id, with campaignId/state indexes for the repository filters.
 */
const DATABASE = "island-campaigns";
const VERSION = 1;
const CAMPAIGN_ID_INDEX = "campaignId";
const STATE_INDEX = "state";
const STORE_NAMES = Object.values(CAMPAIGN_RECORD_KINDS).map(kind => kind.name);

const openDatabase = () => {
  const opening = indexedDB.open(DATABASE, VERSION);
  opening.onupgradeneeded = () => {
    for (const name of STORE_NAMES) {
      if (opening.result.objectStoreNames.contains(name)) continue;
      const store = opening.result.createObjectStore(name, { keyPath: "id" });
      store.createIndex(CAMPAIGN_ID_INDEX, CAMPAIGN_ID_INDEX);
      store.createIndex(STATE_INDEX, STATE_INDEX);
    }
  };
  return requestToPromise(opening);
};

/** Reads the stored revision and applies `change` in the same readwrite transaction when it matches. */
const compareAndSet = (
  database: IDBDatabase, storeName: string, id: string, expectedRevision: number | null,
  change: (store: IDBObjectStore) => void
) => new Promise<boolean>((resolve, reject) => {
  const transaction = database.transaction(storeName, "readwrite"), store = transaction.objectStore(storeName);
  let applied = false;
  const current = store.get(id) as IDBRequest<CampaignRecordEnvelope | undefined>;
  current.onsuccess = () => {
    if ((current.result?.revision ?? null) !== expectedRevision) return;
    change(store);
    applied = true;
  };
  transaction.oncomplete = () => resolve(applied);
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error ?? new Error("Campaign storage write was interrupted"));
});

const listRequest = (store: IDBObjectStore, campaignId?: string, state?: string) => {
  if (campaignId !== undefined) return store.index(CAMPAIGN_ID_INDEX).getAll(campaignId);
  if (state !== undefined) return store.index(STATE_INDEX).getAll(state);
  return store.getAll();
};

export const createIndexedDbCampaignRecordStore = (database: IDBDatabase): CampaignRecordStore => ({
  list: (storeName, { campaignId, state }) => {
    const store = database.transaction(storeName).objectStore(storeName);
    return requestToPromise(listRequest(store, campaignId, state) as IDBRequest<CampaignRecordEnvelope[]>);
  },
  read: async (storeName, id) => {
    const store = database.transaction(storeName).objectStore(storeName);
    return await requestToPromise(store.get(id) as IDBRequest<CampaignRecordEnvelope | undefined>) ?? null;
  },
  remove: (storeName, id, expectedRevision) =>
    compareAndSet(database, storeName, id, expectedRevision, store => store.delete(id)),
  write: (storeName, envelope, expectedRevision) =>
    compareAndSet(database, storeName, envelope.id, expectedRevision, store => store.put(envelope))
});

/**
 * The campaign repositories over IndexedDB, or null where the browser gives no storage (private mode, blocked
 * site data); callers may then fall back to createMemoryCampaignRecordStore.
 */
export const openCampaignIndexedDbRepositories = async (
  now: () => number = Date.now
): Promise<CampaignRepositories | null> => {
  if (typeof indexedDB === "undefined") return null;
  try {
    return createStoreCampaignRepositories(createIndexedDbCampaignRecordStore(await openDatabase()), now);
  } catch {
    return null;
  }
};
