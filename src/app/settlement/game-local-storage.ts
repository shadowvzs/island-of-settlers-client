import {
  composeGameSave, type GameRows, splitGameSave, unreferencedCampaignRuns, unreferencedIslands
} from "../../shared/settlement/game-save-rows";
import { emptyTradeRows, islandTradeRows } from "../../shared/trade/trade-rows";
import { CURRENT_ACCOUNT_KEY, type LocalAccountRow } from "../account/local-accounts";
import type { GameDatabase } from "./game-database";
import { DATABASE, VERSION } from "./game-database-schema";
import {
  slotValueKey
} from "./game-slot-rows";

type KeyValueStorage = Pick<Storage, "getItem" | "key" | "length" | "removeItem" | "setItem">;

const PREFIX = `${DATABASE}.`;
const ACCOUNTS_KEY = `${PREFIX}accounts`;
/** Version 3 kept the browser's one game here; version 4 keeps one entry per slot. */
const LEGACY_ROWS_KEY = `${PREFIX}rows`;
/** Web Storage holds about 5 MiB (UTF-16 chars) per origin; stay below it and fail with a clear message. */
export const LOCAL_FALLBACK_MAX_CHARS = 4_500_000;
export const LOCAL_FALLBACK_TOO_LARGE = "This island is too large for browser storage without IndexedDB";
const rowsKey = (slotId: string) => `${LEGACY_ROWS_KEY}.${slotId}`;
const bootKey = (key: string) => `${PREFIX}boot.${key}`;

const isQuotaError = (error: unknown) => (error as { name?: string } | null)?.name === "QuotaExceededError";

/** Stores the slot's rows; an oversize game or a full storage is an explicit error, never a silent loss. */
const storeRows = (storage: KeyValueStorage, slotId: string, rows: GameRows) => {
  const text = JSON.stringify(rows);
  if (text.length > LOCAL_FALLBACK_MAX_CHARS) throw new Error(LOCAL_FALLBACK_TOO_LARGE);
  try {
    storage.setItem(rowsKey(slotId), text);
  } catch (error) {
    if (isQuotaError(error)) throw new Error(LOCAL_FALLBACK_TOO_LARGE);
    throw error;
  }
};

/**
 * The slot's next rows: a save without the campaign run on screen keeps the stored run rows (like the filed
 * island rows of IndexedDB); a save showing a run replaces that run's row. Runs and islands share one entry, so
 * a write stays atomic; the sweep removes runs no marker names.
 */
const withStoredCampaignRuns = (next: GameRows, stored: GameRows | null): GameRows => {
  const written = next.campaignRuns ?? [], keptRuns = (stored?.campaignRuns ?? [])
    .filter(row => !written.some(run => run.id === row.id));
  const campaignRuns = [...keptRuns, ...written];
  return campaignRuns.length ? { ...next, campaignRuns } : next;
};

/** Old save games are deliberately discarded; account records and account selection remain. */
const resetPreviousGames = (storage: KeyValueStorage) => {
  const marker = `${PREFIX}save-version`;
  if (storage.getItem(marker) === String(VERSION)) return;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '');
  for (const key of keys) {
    if (key === LEGACY_ROWS_KEY || key.startsWith(`${LEGACY_ROWS_KEY}.`) ||
      (key.startsWith(bootKey('')) && key !== bootKey(CURRENT_ACCOUNT_KEY))) storage.removeItem(key);
  }
  storage.setItem(marker, String(VERSION));
};

/**
 * Same tables in localStorage entries when IndexedDB is unavailable (private windows, old browsers): one rows
 * entry per save slot, the accounts list and the boot values.
 */
export const openLocalStorageGame = (storage: KeyValueStorage = localStorage): GameDatabase => {
  resetPreviousGames(storage);
  const readAccounts = () => JSON.parse(storage.getItem(ACCOUNTS_KEY) ?? "[]") as LocalAccountRow[];
  const readRows = (slotId: string): GameRows | null => {
    const text = storage.getItem(rowsKey(slotId));
    return text ? JSON.parse(text) as GameRows : null;
  };
  const storedKeys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? "");
  const removeAccount = (accountId: string) => {
    storage.removeItem(rowsKey(accountId));
    const values = bootKey(slotValueKey(accountId, ""));
    storedKeys().filter(key => key.startsWith(values)).forEach(key => storage.removeItem(key));
  };
  return {
    backend: "local-storage",
    clearGame: async slotId => storage.removeItem(rowsKey(slotId)),
    clearAllGames: async () => {
      for (const key of storedKeys()) {
        if (key === LEGACY_ROWS_KEY || key.startsWith(`${LEGACY_ROWS_KEY}.`) ||
          (key.startsWith(bootKey("")) && key !== bootKey(CURRENT_ACCOUNT_KEY)))
          storage.removeItem(key);
      }
    },
    recreateDatabase: async () => {
      for (const key of storedKeys()) if (key.startsWith(PREFIX)) storage.removeItem(key);
    },
    hasGame: async slotId => storage.getItem(rowsKey(slotId)) !== null,
    listAccounts: async () => readAccounts(),
    listGameSlots: async () => storedKeys().filter(key => key.startsWith(`${LEGACY_ROWS_KEY}.`)).flatMap(key => {
      const slotId = key.slice(LEGACY_ROWS_KEY.length + 1), rows = readRows(slotId);
      return rows ? [{ savedAt: rows.session.savedAt, slotId }] : [];
    }),
    listValues: async suffix => storedKeys().filter(key => key.startsWith(bootKey("")) && key.endsWith(suffix))
      .map(key => [key.slice(bootKey("").length), storage.getItem(key) ?? ""] as [string, string]),
    pruneIslands: async slotId => {
      const rows = readRows(slotId);
      if (!rows) return 0;
      const stale = unreferencedIslands(rows), runs = unreferencedCampaignRuns(rows);
      if (stale.length || runs.length) storage.setItem(rowsKey(slotId), JSON.stringify({ ...rows,
        campaignRuns: rows.campaignRuns?.filter(run => !runs.includes(run.id)),
        islands: rows.islands.filter(island => !stale.includes(island.id)) }));
      return stale.length + runs.length;
    },
    readGame: async slotId => {
      const rows = readRows(slotId);
      return rows && composeGameSave(rows);
    },
    readTradeRows: async (slotId, islandId) => {
      const rows = readRows(slotId);
      return rows ? islandTradeRows(rows, islandId) : emptyTradeRows();
    },
    readValue: async key => storage.getItem(bootKey(key)),
    removeAccounts: async ids => {
      ids.forEach(removeAccount);
      storage.setItem(ACCOUNTS_KEY, JSON.stringify(readAccounts().filter(row => !ids.includes(row.id))));
    },
    removeValue: async key => storage.removeItem(bootKey(key)),
    writeGame: async (slotId, save) =>
      storeRows(storage, slotId, withStoredCampaignRuns(splitGameSave(save), readRows(slotId))),
    writeValue: async (key, value) => storage.setItem(bootKey(key), value)
  };
};
