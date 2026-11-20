import {
  COPIED_SLOT_VALUES, OWNED_SLOT_VALUES, SLOT_COPY_TABLES, SLOT_RANGE_TABLES, type Table, TABLES
} from "./game-database-schema";
import { SLOT_META_KEY, slotValueKey } from "./game-slot-rows";

/**
 * Table-level slot copies (SAVE-SLOTS, plan §5.6, rev I3): a Save/Load slot is a verbatim copy of the working slot's
 * rows, never a `GameSaveV1` round trip (a composed save omits filed campaign runs and references map bases). One
 * read-write transaction clears the target and copies every game table range, the map bases and the slot's own boot
 * values, so a copy is all or nothing.
 */

type SlotRow = Record<string, unknown> & { slotId: string };
type KeyedRow = Record<string, unknown> & { id: string };

/** Everything one slot holds, as stored. */
export interface SlotRecords {
  /** Map bases of the slot's islands (`mapBases`, keyed [slotId, key]). */
  mapBases: SlotRow[];
  player?: KeyedRow;
  /** Rows of every [slotId, …]-keyed game table. */
  ranges: Partial<Record<Table, SlotRow[]>>;
  session?: KeyedRow;
  /** The slot's copied boot values by key (`story-progress`). */
  values: Record<string, string>;
}

/** Every composite key [slotId, *] of one slot (arrays sort after every other key type). */
export const slotRange = (slotId: string) => IDBKeyRange.bound([slotId], [slotId, []]);

/** The same records under slot `to` (pure; the rows' content is untouched). */
export const retargetSlotRecords = (records: SlotRecords, to: string): SlotRecords => ({
  mapBases: records.mapBases.map(row => ({ ...row, slotId: to })),
  ...(records.player ? { player: { ...records.player, id: to } } : {}),
  ranges: Object.fromEntries(Object.entries(records.ranges).map(([table, rows]) =>
    [table, rows.map(row => ({ ...row, slotId: to }))])),
  ...(records.session ? { session: { ...records.session, id: to } } : {}),
  values: { ...records.values }
});

/** Empties a slot's game rows (`keepFiled`: island and campaign run rows stay, as a save keeps them). */
export const clearSlotRows = (transaction: IDBTransaction, slotId: string, keep: readonly Table[] = []) => {
  for (const table of SLOT_RANGE_TABLES)
    if (!keep.includes(table)) transaction.objectStore(table).delete(slotRange(slotId));
  transaction.objectStore(TABLES.players).delete(slotId);
  transaction.objectStore(TABLES.sessions).delete(slotId);
};

/** Empties everything a slot owns: rows, map bases and its own boot values. */
const clearSlotRecords = (transaction: IDBTransaction, slotId: string) => {
  clearSlotRows(transaction, slotId);
  transaction.objectStore(TABLES.mapBases).delete(slotRange(slotId));
  const boot = transaction.objectStore(TABLES.boot);
  OWNED_SLOT_VALUES.forEach(key => boot.delete(slotValueKey(slotId, key)));
};

/** Reads every record of `slotId` inside the transaction; `done` runs once all reads succeeded. */
const readSlotRecords = (transaction: IDBTransaction, slotId: string, done: (records: SlotRecords) => void) => {
  const records: SlotRecords = { mapBases: [], ranges: {}, values: {} };
  const reads: IDBRequest[] = [];
  const read = <T>(operation: IDBRequest<T>, keep: (result: T) => void) => {
    reads.push(operation);
    operation.addEventListener("success", () => keep(operation.result));
  };
  const range = slotRange(slotId);
  for (const table of SLOT_RANGE_TABLES)
    read(transaction.objectStore(table).getAll(range), rows => { records.ranges[table] = rows as SlotRow[]; });
  read(transaction.objectStore(TABLES.mapBases).getAll(range), rows => { records.mapBases = rows as SlotRow[]; });
  read(transaction.objectStore(TABLES.players).get(slotId), row => { if (row) records.player = row as KeyedRow; });
  read(transaction.objectStore(TABLES.sessions).get(slotId), row => { if (row) records.session = row as KeyedRow; });
  const boot = transaction.objectStore(TABLES.boot);
  for (const key of COPIED_SLOT_VALUES) read(boot.get(slotValueKey(slotId, key)), value => {
    if (typeof value === "string") records.values[key] = value;
  });
  // Requests of one transaction succeed in the order they were made: the last success sees every result.
  reads.at(-1)!.addEventListener("success", () => done(records));
};

const putSlotRecords = (transaction: IDBTransaction, slotId: string, records: SlotRecords) => {
  for (const [table, rows] of Object.entries(records.ranges))
    rows.forEach(row => transaction.objectStore(table).put(row));
  records.mapBases.forEach(row => transaction.objectStore(TABLES.mapBases).put(row));
  if (records.player) transaction.objectStore(TABLES.players).put(records.player);
  if (records.session) transaction.objectStore(TABLES.sessions).put(records.session);
  const boot = transaction.objectStore(TABLES.boot);
  for (const [key, value] of Object.entries(records.values)) boot.put(value, slotValueKey(slotId, key));
};

const settled = (transaction: IDBTransaction, failure: () => unknown) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(failure() ?? transaction.error ?? new Error("Game database is unavailable"));
  transaction.onabort = () => reject(failure() ?? transaction.error ?? new Error("Game database copy was interrupted"));
});

/** Builds the target's meta value from the copied records; null writes none. */
export type SlotMetaWriter = (records: SlotRecords) => string | null;

/**
 * Replaces slot `to` with a copy of slot `from` in one transaction: rows of every game table, map bases and the
 * copied boot values; `meta` (when given) writes the target's slot meta in the same transaction.
 */
export const copySlotRecords = (database: IDBDatabase, from: string, to: string, meta?: SlotMetaWriter) => {
  if (from === to) return Promise.reject(new Error("A slot cannot be copied onto itself"));
  const transaction = database.transaction([...SLOT_COPY_TABLES], "readwrite");
  let failure: unknown;
  const done = settled(transaction, () => failure);
  clearSlotRecords(transaction, to);
  readSlotRecords(transaction, from, records => {
    try {
      putSlotRecords(transaction, to, retargetSlotRecords(records, to));
      const value = meta?.(records);
      if (value) transaction.objectStore(TABLES.boot).put(value, slotValueKey(to, SLOT_META_KEY));
    } catch (error) {
      failure = error;
      transaction.abort();
    }
  });
  return done;
};

/** Removes everything a slot owns (rows, map bases, its boot values) in one transaction. */
export const removeSlotRecords = (database: IDBDatabase, slotId: string) => {
  const transaction = database.transaction([...SLOT_COPY_TABLES], "readwrite");
  const done = settled(transaction, () => undefined);
  clearSlotRecords(transaction, slotId);
  return done;
};

/** Reads everything slot `slotId` holds in one read-only transaction (OFFLINE-CLOUD uploads it as a dump). */
export const exportSlotRecords = (database: IDBDatabase, slotId: string) => {
  const transaction = database.transaction([...SLOT_COPY_TABLES], "readonly");
  let records: SlotRecords | undefined;
  const done = settled(transaction, () => undefined);
  readSlotRecords(transaction, slotId, read => { records = read; });
  return done.then(() => records!);
};

/** Records from outside this browser (a server dump) name only slot range tables and copied values. */
const assertKnownRecords = (records: SlotRecords) => {
  const unknownTable = Object.keys(records.ranges).find(table => !SLOT_RANGE_TABLES.includes(table as Table));
  const unknownValue = Object.keys(records.values).find(key => !COPIED_SLOT_VALUES.includes(key));
  if (unknownTable ?? unknownValue) throw new Error("The slot records name unknown tables or values");
};

/** Replaces slot `slotId` with `records` (another slot's, retargeted) in one transaction: all or nothing. */
export const replaceSlotRecords = (database: IDBDatabase, slotId: string, records: SlotRecords) => {
  assertKnownRecords(records);
  const transaction = database.transaction([...SLOT_COPY_TABLES], "readwrite");
  const done = settled(transaction, () => undefined);
  clearSlotRecords(transaction, slotId);
  putSlotRecords(transaction, slotId, retargetSlotRecords(records, slotId));
  return done;
};
