import type { SlotMeta } from "../../../../island-of-settlers-shared/src/offline-slots";
import { base64ToBytes, bytesToBase64 } from "../../../../island-of-settlers-shared/src/save-map-delta";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import type { GameDatabase } from "../settlement/game-database";
import type { SlotRecords } from "../settlement/game-slot-copy";
import { DUMP_BYTES_TAG, SLOTS_NEED_INDEXEDDB } from "./constants";
import { slotStorageError } from "./slot-copy";
import { buildSlotMeta, type SlotMetaInput, slotSourceOf } from "./slot-meta";

/**
 * The server slot dump (OFFLINE-CLOUD): a browser slot's records as stored plus its meta, as gzip JSON. Records hold
 * byte arrays (map bases), which travel as `{ "$bytes": base64 }`; any other binary value refuses the dump. Built
 * and read in the game-session worker, never on the frame.
 */
export interface SlotDump {
  meta: SlotMeta;
  records: SlotRecords;
}

/** What the worker answers for an upload: the gzip body and the meta it carries. */
export interface SlotDumpUpload {
  body: ArrayBuffer;
  meta: SlotMeta;
}

const encodeValue = (_key: string, value: unknown) => {
  if (value instanceof Uint8Array) return { [DUMP_BYTES_TAG]: bytesToBase64(value) };
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
    throw new Error("Only byte arrays can travel in a slot dump");
  return value;
};

const isBytesTag = (value: unknown): value is { [DUMP_BYTES_TAG]: string } => isPlainObject(value) &&
  Object.keys(value).length === 1 && typeof value[DUMP_BYTES_TAG] === "string";

const decodeValue = (_key: string, value: unknown) => isBytesTag(value) ? base64ToBytes(value[DUMP_BYTES_TAG]) : value;

/** Dump JSON of any slot body (byte arrays tagged). */
export const encodeDumpJson = (value: object) => JSON.stringify(value, encodeValue);
export const parseDumpJson = (text: string): unknown => JSON.parse(text, decodeValue);

export const encodeSlotDump = (dump: SlotDump) => encodeDumpJson(dump);

/** The dump of a download; throws when it is not one. */
export const decodeSlotDump = (text: string): SlotDump => {
  const dump = parseDumpJson(text) as Partial<SlotDump> | null;
  const records = dump?.records;
  if (!records || typeof records.ranges !== "object" || typeof records.values !== "object" ||
    !Array.isArray(records.mapBases)) throw new Error("The downloaded slot is malformed");
  return dump as SlotDump;
};

export const gzipText = (text: string) =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();

type DumpDatabase = Pick<GameDatabase, "exportGame" | "importGame">;

/** Reads slot `slotId` and builds its upload body; the meta comes from the read rows, as a slot copy builds it. */
export const buildSlotDumpUpload = async (
  database: DumpDatabase, slotId: string, input: SlotMetaInput
): Promise<SlotDumpUpload> => {
  if (!database.exportGame) throw new Error(SLOTS_NEED_INDEXEDDB);
  const records = await database.exportGame(slotId);
  const meta = buildSlotMeta(input, slotSourceOf(records));
  return { body: await gzipText(encodeSlotDump({ meta, records })), meta };
};

/** Replaces slot `slotId` with a downloaded dump (the decompressed JSON bytes); answers the dump's meta. */
export const importSlotDump = async (database: DumpDatabase, slotId: string, json: ArrayBuffer) => {
  if (!database.importGame) throw new Error(SLOTS_NEED_INDEXEDDB);
  const dump = decodeSlotDump(new TextDecoder().decode(json));
  try {
    await database.importGame(slotId, dump.records);
  } catch (error) {
    throw slotStorageError(error);
  }
  return dump.meta;
};
