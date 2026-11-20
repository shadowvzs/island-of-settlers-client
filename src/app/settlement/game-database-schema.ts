import { CURRENT_ACCOUNT_KEY } from "../account/local-accounts";
import { ISLAND_SIGNATURE_INDEX } from "./game-island-rows";
import { GAME_STARTUP_SLOT, SLOT_META_KEY, STORY_PROGRESS_KEY } from "./game-slot-rows";

/**
 * Version 9 (game save format 4, owner D-S9) deliberately resets old games, like version 8; authored
 * maps and accounts live independently. The pinned map bases of the discarded games go too.
 * Version 10 adds the islands' signature index (dirty-row writes, S07) and keeps every stored game.
 * Version 11 adds the campaign run table (C2): a campaign run is its own document, never a filed island.
 */
export const DATABASE = "island-settlers-db";
export const VERSION = 11;
/** The last version that resets games on upgrade: a later one only adds what it needs. */
const LAST_RESETTING_VERSION = 9;
export const TABLES = {
  accounts: "accounts", adventures: "adventures", boot: "boot", campaignRuns: "campaignRuns", colonies: "colonies",
  evacuations: "evacuations",
  islands: "islands", mapBases: "mapBases", players: "players", sessions: "sessions",
  tradeHistory: "tradeHistory", tradeOffers: "tradeOffers"
} as const;
export type Table = typeof TABLES[keyof typeof TABLES];
const KEY_PATHS: Readonly<Record<Table, string | string[] | null>> = {
  accounts: "id", adventures: ["slotId", "expeditionId"], boot: null, campaignRuns: ["slotId", "id"],
  colonies: ["slotId", "expeditionId"],
  mapBases: ["slotId", "key"],
  evacuations: ["slotId", "expeditionId"], islands: ["slotId", "id"], players: "id", sessions: "id",
  tradeHistory: ["slotId", "islandId", "id"], tradeOffers: ["slotId", "islandId", "id"]
};
/** Unique login name index of the accounts table (lower-case username). */
const USERNAME_INDEX = "usernameKey";
/** Every table of one saved game (the boot table holds loose values). */
export const GAME_TABLES: readonly Table[] = [TABLES.adventures, TABLES.islands, TABLES.colonies,
  TABLES.evacuations, TABLES.players, TABLES.sessions, TABLES.tradeHistory, TABLES.tradeOffers, TABLES.campaignRuns];
/** Tables whose rows are keyed by [slotId, ...]: one key range clears or reads a slot. */
export const SLOT_RANGE_TABLES: readonly Table[] = [TABLES.adventures, TABLES.islands, TABLES.colonies,
  TABLES.evacuations, TABLES.tradeHistory, TABLES.tradeOffers, TABLES.campaignRuns];
/** Per-slot boot values that belong to the slot's game and travel with a slot copy (SAVE-SLOTS). */
export const COPIED_SLOT_VALUES: readonly string[] = Object.freeze([STORY_PROGRESS_KEY]);
/** Per-slot boot values a slot copy or removal clears on the target: the copied ones, a startup game, the meta. */
export const OWNED_SLOT_VALUES: readonly string[] = Object.freeze([STORY_PROGRESS_KEY, GAME_STARTUP_SLOT,
  SLOT_META_KEY]);
/** Tables of a slot copy's one transaction. */
export const SLOT_COPY_TABLES: readonly Table[] = Object.freeze([...GAME_TABLES, TABLES.mapBases, TABLES.boot]);
/** Filed documents a save keeps unless it rewrites them: island rows and campaign run rows. */
export const FILED_TABLES: readonly Table[] = [TABLES.islands, TABLES.campaignRuns];
const createTable = (database: IDBDatabase, table: Table) => {
  const keyPath = KEY_PATHS[table];
  const store = database.createObjectStore(table, keyPath ? { keyPath } : undefined);
  if (table === TABLES.mapBases) store.createIndex('slotHash', ['slotId', 'hash']);
  if (table === TABLES.islands) store.createIndex(ISLAND_SIGNATURE_INDEX, ["slotId", "id", "signature"]);
  if (table === TABLES.accounts) store.createIndex(USERNAME_INDEX, USERNAME_INDEX, { unique: true });
  return store;
};

/** Keep accounts and map libraries, recreate game tables with the current keys, and discard old startup saves. */
export const upgradeGameDatabase = (database: IDBDatabase, transaction: IDBTransaction, oldVersion: number) => {
  for (const table of Object.values(TABLES))
    if (!database.objectStoreNames.contains(table)) createTable(database, table);
  if (!oldVersion || oldVersion >= VERSION) return;
  if (oldVersion >= LAST_RESETTING_VERSION) {
    const islands = transaction.objectStore(TABLES.islands);
    if (!islands.indexNames.contains(ISLAND_SIGNATURE_INDEX))
      islands.createIndex(ISLAND_SIGNATURE_INDEX, ["slotId", "id", "signature"]);
    return;
  }
  for (const table of GAME_TABLES) {
    database.deleteObjectStore(table);
    createTable(database, table);
  }
  transaction.objectStore(TABLES.mapBases).clear();
  const boot = transaction.objectStore(TABLES.boot), current = boot.get(CURRENT_ACCOUNT_KEY);
  current.onsuccess = () => {
    boot.clear();
    if (current.result !== undefined) boot.put(current.result, CURRENT_ACCOUNT_KEY);
  };
  if (database.objectStoreNames.contains('tradeMail')) database.deleteObjectStore('tradeMail');
};
