import { compactIsland, expandIsland, type LiveMap, type MapBases } from '../../../../island-of-settlers-shared/src/save-map-delta';
import type { CampaignRunKey } from "../../shared/campaign/campaign-run";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import {
  composeGameSave, type IslandKey, sessionCampaignRunKey, splitGameSave, unreferencedCampaignRuns,
  unreferencedIslands
} from "../../shared/settlement/game-save-rows";
import { islandTradeRows, type TradeRows } from "../../shared/trade/trade-rows";
import { CURRENT_ACCOUNT_KEY, type LocalAccountRow, type LocalAccountsDatabase } from "../account/local-accounts";
import {
  DATABASE, FILED_TABLES, GAME_TABLES, TABLES, upgradeGameDatabase, VERSION
} from "./game-database-schema";
import {
  ISLAND_SIGNATURE_INDEX, islandSignature, islandSignatureKey, KeptIslandMissing, keptIslands, type SignedIsland,
  staleIslandIds
} from "./game-island-rows";
import { openLocalStorageGame } from "./game-local-storage";
import { indexedDbMapBases } from './game-map-bases';
import {
  clearSlotRows, copySlotRecords, exportSlotRecords, removeSlotRecords, replaceSlotRecords, type SlotMetaWriter,
  type SlotRecords, slotRange
} from "./game-slot-copy";
import { fromSlotRows, type SlotRows, slotValueKey, toSlotRows } from "./game-slot-rows";

/**
 * Browser stand-in for the future game database: one IndexedDB object store per table, rows keyed like a
 * backend would key them (game-database-schema.ts). Every game call names its save slot: the account id, or
 * GUEST_SLOT without an account. Swap this module for an SQL or NoSQL client later.
 */
/**
 * Trade office tables (version 6): offers, history and mail rows of one island, as a backend would serve them
 * to the trade window. They are written with the game (`writeGame`) and read here without loading saves.
 */
export interface TradeRepository {
  readTradeRows(slotId: string, islandId: IslandKey): Promise<TradeRows>;
}

/** One saved game's session row: its slot and when it was saved (retention sweeps). */
export interface SlotSession {
  savedAt: number;
  slotId: string;
}

export interface WriteGameOptions {
  /** Keyed by the save's row key: an island key, or the campaign run key while the run is on screen. */
  live?: Partial<Record<IslandKey | CampaignRunKey, LiveMap>>;
}

/** Row signature of each island written (or kept) by a save; live islands are not signed. */
export type RowSignatures = ReadonlyMap<IslandKey, string>;

export interface GameDatabase extends LocalAccountsDatabase, TradeRepository {
  /** IndexedDB is reachable from workers too; the localStorage fallback only from the page. */
  readonly backend: "indexeddb" | "local-storage";
  mapBases?(slotId: string): MapBases;
  readGame(slotId: string): Promise<GameSaveV1 | null>;
  /** Removes the slot's game rows (a confirmed recovery copy, a swept slot). */
  clearGame(slotId: string): Promise<void>;
  /** Debug: removes every saved game, map base and boot value while keeping local accounts. */
  clearAllGames(): Promise<void>;
  /** Debug: deletes the whole local game database (including local accounts); reload afterwards. */
  recreateDatabase(): Promise<void>;
  /** Every slot holding a game, with its save time. */
  listGameSlots(): Promise<SlotSession[]>;
  /** Every boot value whose key ends with `suffix` (retention of per-slot values). */
  listValues(suffix: string): Promise<[string, string][]>;
  readValue(key: string): Promise<string | null>;
  removeValue(key: string): Promise<void>;
  writeValue(key: string, value: string): Promise<void>;
  /**
   * Replaces the slot's game in one transaction (every island, colony, player and session row).
   * `live` holds the maps of islands whose `map` is empty because the caller keeps them as parts.
   * Answers the row signature (island-rows) of every island that is not live, when the backend signs rows:
   * an unchanged signature means the island's saved content is unchanged (the cloud body reuses its encoding).
   */
  writeGame(slotId: string, save: GameSaveV1, options?: WriteGameOptions): Promise<RowSignatures | void>;
  /** Deletes the slot's island and campaign run rows nothing refers to (startup sweep); the number removed. */
  pruneIslands(slotId: string): Promise<number>;
  /** True when the slot holds a saved game (its session row exists). */
  hasGame(slotId: string): Promise<boolean>;
  /**
   * IndexedDB only (SAVE-SLOTS): replaces slot `to` with a table-level copy of slot `from` (rows, map bases, the
   * slot's story progress) in one transaction; `meta` writes the target's slot meta in it. Absent on the
   * localStorage fallback, which cannot hold copies (rev I12).
   */
  copyGame?(from: string, to: string, meta?: SlotMetaWriter): Promise<void>;
  /** IndexedDB only: removes the slot's rows, map bases and own boot values (`clearGame` keeps map bases). */
  removeGame?(slotId: string): Promise<void>;
  /** IndexedDB only (OFFLINE-CLOUD): everything the slot holds, as stored (the server dump's records). */
  exportGame?(slotId: string): Promise<SlotRecords>;
  /** IndexedDB only (OFFLINE-CLOUD): replaces the slot with `records` (a downloaded dump) in one transaction. */
  importGame?(slotId: string, records: SlotRecords): Promise<void>;
}

const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error ?? new Error("Game database request failed"));
});

const openIndexedDb = () => new Promise<IDBDatabase | null>(resolve => {
  if (!globalThis.indexedDB) { resolve(null); return; }
  let open: IDBOpenDBRequest;
  try { open = indexedDB.open(DATABASE, VERSION); } catch { resolve(null); return; }
  open.onupgradeneeded = event => upgradeGameDatabase(open.result, open.transaction!, event.oldVersion);
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => resolve(null);
  open.onblocked = () => resolve(null);
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error("Game database is unavailable"));
  transaction.onabort = () => reject(transaction.error ?? new Error("Game database write was interrupted"));
});

const readSlotRows = async (database: IDBDatabase, slotId: string): Promise<SlotRows | null> => {
  const transaction = database.transaction([...GAME_TABLES]), range = slotRange(slotId);
  const [adventures, islands, colonies, evacuations, player, session, campaignRuns, ...trade] = await Promise.all([
    request(transaction.objectStore(TABLES.adventures).getAll(range) as IDBRequest<SlotRows["adventures"]>),
    request(transaction.objectStore(TABLES.islands).getAll(range) as IDBRequest<SlotRows["islands"]>),
    request(transaction.objectStore(TABLES.colonies).getAll(range) as IDBRequest<SlotRows["colonies"]>),
    request(transaction.objectStore(TABLES.evacuations).getAll(range) as IDBRequest<SlotRows["evacuations"]>),
    request(transaction.objectStore(TABLES.players).get(slotId) as IDBRequest<SlotRows["player"]>),
    request(transaction.objectStore(TABLES.sessions).get(slotId) as IDBRequest<SlotRows["session"] | undefined>),
    request(transaction.objectStore(TABLES.campaignRuns).getAll(range) as IDBRequest<SlotRows["campaignRuns"]>),
    request(transaction.objectStore(TABLES.tradeHistory).getAll(range) as IDBRequest<SlotRows["tradeHistory"]>),
    request(transaction.objectStore(TABLES.tradeOffers).getAll(range) as IDBRequest<SlotRows["tradeOffers"]>)
  ]);
  const [tradeHistory, tradeOffers] = trade as [SlotRows["tradeHistory"], SlotRows["tradeOffers"]];
  if (!session) return null;
  return { adventures, campaignRuns: campaignRuns as SlotRows["campaignRuns"], colonies, evacuations, islands,
    player, session, tradeHistory, tradeOffers };
};

/** `keepFiled`: a save keeps the island and campaign run rows it does not rewrite. */
const clearSlot = (transaction: IDBTransaction, slotId: string, keepFiled = false) =>
  clearSlotRows(transaction, slotId, keepFiled ? FILED_TABLES : []);

const putSlotRows = (transaction: IDBTransaction, rows: SlotRows) => {
  rows.islands.forEach(row => transaction.objectStore(TABLES.islands).put(row));
  rows.colonies.forEach(row => transaction.objectStore(TABLES.colonies).put(row));
  rows.adventures.forEach(row => transaction.objectStore(TABLES.adventures).put(row));
  rows.evacuations.forEach(row => transaction.objectStore(TABLES.evacuations).put(row));
  rows.campaignRuns.forEach(row => transaction.objectStore(TABLES.campaignRuns).put(row));
  rows.tradeHistory.forEach(row => transaction.objectStore(TABLES.tradeHistory).put(row));
  rows.tradeOffers.forEach(row => transaction.objectStore(TABLES.tradeOffers).put(row));
  if (rows.player) transaction.objectStore(TABLES.players).put(rows.player);
  transaction.objectStore(TABLES.sessions).put(rows.session);
};

/** One read-write transaction over the game tables: `clearIds` are emptied, then `next` is written. */
const replaceSlots = async (database: IDBDatabase, clearIds: readonly string[], next: SlotRows | null) => {
  const transaction = database.transaction([...GAME_TABLES], "readwrite");
  clearIds.forEach(slotId => clearSlot(transaction, slotId));
  if (next) putSlotRows(transaction, next);
  await transactionDone(transaction);
};

/** The islands whose current signature is stored for the slot (one index lookup each, no row is read). */
const storedSignatures = async (database: IDBDatabase, slotId: string, signed: readonly SignedIsland[]) => {
  if (!signed.length) return new Set<IslandKey>();
  const index = database.transaction(TABLES.islands).objectStore(TABLES.islands).index(ISLAND_SIGNATURE_INDEX);
  const hits = await Promise.all(signed.map(async ({ id, signature }) =>
    await request(index.getKey(islandSignatureKey(slotId, id, signature))) === undefined ? null : id));
  return new Set(hits.filter((id): id is IslandKey => id !== null));
};

/**
 * One transaction: every table but the islands is replaced, islands that left the game are deleted, the
 * rewritten island rows are put and each kept island's signature is verified again inside the transaction
 * (a row removed meanwhile, e.g. by another tab, aborts it: the caller then writes every island).
 */
const commitGameRows = async (
  database: IDBDatabase, slotId: string, rows: SlotRows, kept: ReadonlyMap<IslandKey, string>
) => {
  const transaction = database.transaction([...GAME_TABLES], "readwrite");
  let missing = false;
  clearSlot(transaction, slotId, true);
  const islands = transaction.objectStore(TABLES.islands);
  const storedKeys = islands.getAllKeys(slotRange(slotId));
  storedKeys.onsuccess = () => {
    const stored = (storedKeys.result as [string, IslandKey][]).map(key => key[1]);
    for (const id of staleIslandIds(stored, [...rows.islands.map(row => row.id), ...kept.keys()]))
      islands.delete([slotId, id]);
  };
  for (const [id, signature] of kept) {
    const check = islands.index(ISLAND_SIGNATURE_INDEX).getKey(islandSignatureKey(slotId, id, signature));
    check.onsuccess = () => {
      if (check.result !== undefined) return;
      missing = true;
      transaction.abort();
    };
  }
  putSlotRows(transaction, rows);
  try { await transactionDone(transaction); }
  catch (error) { throw missing ? new KeptIslandMissing() : error; }
};

/** Signs the filed islands, skips the ones already stored, compacts and writes the rest. */
const writeGameRows = async (
  database: IDBDatabase, slotId: string, save: GameSaveV1, options: WriteGameOptions | undefined, skipping: boolean
): Promise<RowSignatures> => {
  const rows = toSlotRows(slotId, splitGameSave(save)), bases = indexedDbMapBases(database, slotId);
  const candidates = rows.islands.filter(row => !options?.live?.[row.id]);
  const signed = await Promise.all(candidates.map(async row =>
    ({ id: row.id, signature: await islandSignature(row.save) })));
  const stored = skipping ? await storedSignatures(database, slotId, signed) : new Set<IslandKey>();
  const kept = keptIslands(signed, stored);
  const signatures = new Map(signed.map(entry => [entry.id, entry.signature]));
  const written = rows.islands.filter(row => !kept.has(row.id));
  for (const row of rows.campaignRuns)
    row.save = await compactIsland(row.save as unknown as Record<string, unknown>, row.id, bases,
      options?.live?.[row.id]) as unknown as GameSaveV1;
  for (const row of written) {
    row.save = await compactIsland(row.save as unknown as Record<string, unknown>, row.id, bases,
      options?.live?.[row.id]) as unknown as GameSaveV1;
    const signature = signatures.get(row.id);
    if (signature) (row as { signature?: string }).signature = signature;
  }
  await commitGameRows(database, slotId, { ...rows, islands: written }, kept);
  return signatures as RowSignatures;
};

/** Every boot value of one account (`<accountId>/...`). */
const accountValueRange = (accountId: string) =>
  IDBKeyRange.bound(slotValueKey(accountId, ""), slotValueKey(accountId, "￿"));

/** One read-write transaction over the accounts, game and boot tables: removes the accounts with their rows. */
const removeAccounts = async (database: IDBDatabase, ids: readonly string[]) => {
  const transaction = database.transaction([TABLES.accounts, TABLES.boot, ...GAME_TABLES], "readwrite");
  for (const accountId of ids) {
    transaction.objectStore(TABLES.accounts).delete(accountId);
    transaction.objectStore(TABLES.boot).delete(accountValueRange(accountId));
    clearSlot(transaction, accountId);
  }
  await transactionDone(transaction);
};

const deleteFiledRows = async (
  database: IDBDatabase, slotId: string, islands: readonly IslandKey[], runs: readonly CampaignRunKey[]
) => {
  const transaction = database.transaction([...FILED_TABLES], "readwrite");
  for (const id of islands) transaction.objectStore(TABLES.islands).delete([slotId, id]);
  for (const id of runs) transaction.objectStore(TABLES.campaignRuns).delete([slotId, id]);
  await transactionDone(transaction);
};

/** Only the run a campaign session shows is expanded and composed; filed runs stay stored as they are. */
const keepShownCampaignRun = (rows: SlotRows) => {
  const shown = sessionCampaignRunKey(rows.session);
  rows.campaignRuns = rows.campaignRuns.filter(row => row.id === shown);
};

type StoreAction<T> =(store: IDBObjectStore) => IDBRequest<T>;

/** One island's trade rows in list order: key range [slotId, islandId] .. [slotId, islandId, []]. */
const readTradeRows = async (database: IDBDatabase, slotId: string, islandId: IslandKey): Promise<TradeRows> => {
  const transaction = database.transaction([TABLES.tradeHistory, TABLES.tradeOffers]);
  const range = IDBKeyRange.bound([slotId, islandId], [slotId, islandId, []]);
  const readTable = async <Row>(table: string) => {
    const read = transaction.objectStore(table).getAll(range) as IDBRequest<(Row & { slotId: string })[]>;
    const rows = await request(read);
    return rows.map(({ slotId: _slotId, ...row }) => row as unknown as Row);
  };
  const [tradeHistory, tradeOffers] = await Promise.all([
    readTable<TradeRows["tradeHistory"][number]>(TABLES.tradeHistory),
    readTable<TradeRows["tradeOffers"][number]>(TABLES.tradeOffers)
  ]);
  return islandTradeRows({ tradeHistory, tradeOffers }, islandId);
};

/** Boot values whose key ends with `suffix` (one cursor over the boot table). */
const listValues = (database: IDBDatabase, suffix: string) => new Promise<[string, string][]>((resolve, reject) => {
  const found: [string, string][] = [];
  const cursor = database.transaction(TABLES.boot).objectStore(TABLES.boot).openCursor();
  cursor.onerror = () => reject(cursor.error ?? new Error("Game database request failed"));
  cursor.onsuccess = () => {
    const current = cursor.result;
    if (!current) { resolve(found); return; }
    const { key, value } = current;
    if (typeof key === "string" && key.endsWith(suffix) && typeof value === "string") found.push([key, value]);
    current.continue();
  };
});

const clearFallbackStorage = (storage: Storage | undefined = globalThis.localStorage) => {
  if (!storage) return;
  const prefix = `${DATABASE}.`;
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
};

const indexedDbGame = (database: IDBDatabase): GameDatabase => {
  const single = async <T>(table: string, mode: IDBTransactionMode, action: StoreAction<T>) => {
    const transaction = database.transaction(table, mode), result = request(action(transaction.objectStore(table)));
    await transactionDone(transaction);
    return result;
  };
  const boot = <T>(mode: IDBTransactionMode, action: StoreAction<T>) => single(TABLES.boot, mode, action);
  return {
    backend: "indexeddb",
    mapBases: slotId => indexedDbMapBases(database, slotId),
    clearGame: slotId => replaceSlots(database, [slotId], null),
    copyGame: (from, to, meta) => copySlotRecords(database, from, to, meta),
    exportGame: slotId => exportSlotRecords(database, slotId),
    importGame: (slotId, records) => replaceSlotRecords(database, slotId, records),
    clearAllGames: async () => {
      const current = await boot("readonly", store =>
        store.get(CURRENT_ACCOUNT_KEY) as IDBRequest<string | undefined>);
      const transaction = database.transaction([...GAME_TABLES, TABLES.mapBases, TABLES.boot], "readwrite");
      for (const table of [...GAME_TABLES, TABLES.mapBases]) transaction.objectStore(table).clear();
      transaction.objectStore(TABLES.boot).clear();
      if (current !== undefined) transaction.objectStore(TABLES.boot).put(current, CURRENT_ACCOUNT_KEY);
      await transactionDone(transaction);
      clearFallbackStorage();
    },
    recreateDatabase: async () => {
      database.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DATABASE);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("Game database could not be recreated"));
        request.onblocked = () => reject(new Error("Close other game tabs before recreating the database"));
      });
      clearFallbackStorage();
    },
    hasGame: async slotId => (await single(TABLES.sessions, "readonly", store => store.count(slotId))) > 0,
    listAccounts: () => single(TABLES.accounts, "readonly", store =>
      store.getAll() as IDBRequest<LocalAccountRow[]>),
    listGameSlots: async () => (await single(TABLES.sessions, "readonly", store =>
      store.getAll() as IDBRequest<SlotRows["session"][]>)).map(row => ({ savedAt: row.savedAt, slotId: row.id })),
    listValues: suffix => listValues(database, suffix),
    pruneIslands: async slotId => {
      const rows = await readSlotRows(database, slotId);
      if (!rows) return 0;
      const game = fromSlotRows(rows), stale = unreferencedIslands(game), runs = unreferencedCampaignRuns(game);
      if (stale.length || runs.length) await deleteFiledRows(database, slotId, stale, runs);
      return stale.length + runs.length;
    },
    readGame: async slotId => {
      const rows = await readSlotRows(database, slotId);
      if (!rows) return null;
      keepShownCampaignRun(rows);
      const bases = indexedDbMapBases(database, slotId);
      for (const run of rows.campaignRuns)
        run.save = await expandIsland(run.save as unknown as Record<string, unknown>, bases) as unknown as GameSaveV1;
      for (const island of rows.islands)
        island.save = await expandIsland(island.save as unknown as Record<string, unknown>, bases) as unknown as GameSaveV1;
      return composeGameSave(fromSlotRows(rows));
    },
    readTradeRows: (slotId, islandId) => readTradeRows(database, slotId, islandId),
    readValue: async key => (await boot("readonly", store => store.get(key) as IDBRequest<string | undefined>)) ?? null,
    removeAccounts: ids => removeAccounts(database, ids),
    removeGame: slotId => removeSlotRecords(database, slotId),
    removeValue: async key => { await boot("readwrite", store => store.delete(key)); },
    writeGame: async (slotId, save, options) => {
      try { return await writeGameRows(database, slotId, save, options, true); }
      catch (error) {
        if (!(error instanceof KeptIslandMissing)) throw error;
        return await writeGameRows(database, slotId, save, options, false);
      }
    },
    writeValue: async (key, value) => { await boot("readwrite", store => store.put(value, key)); }
  };
};

let opened: Promise<GameDatabase> | undefined;
export const openGameDatabase = () => {
  opened ??= openIndexedDb().then(database => database ? indexedDbGame(database) : openLocalStorageGame());
  return opened;
};
