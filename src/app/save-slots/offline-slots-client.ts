import {
  OFFLINE_SLOTS_PATH, type OfflineSlotMode, type OfflineSlotSummary
} from "../../../../island-of-settlers-shared/src/offline-slots";
import { HTTP_NOT_FOUND } from "../campaign-storage/constants";
import {
  createApiTransport, readApiError, type SaveApiOptions
} from "../save-store/save-api-client";
import { OFFLINE_WRITE_SPACING_MS } from "./constants";

/**
 * The api's unverified offline store (OFFLINE-CLOUD): signed-in offline players' working slot (0) and Save/Load slots
 * (1-10). Uploads are gzip JSON bodies built in the game-session worker; downloads answer the decompressed bytes.
 */
export interface OfflineSlotsClient {
  /** The decompressed dump JSON of a slot, or null when it is empty. */
  download(mode: OfflineSlotMode, slotNo: number): Promise<ArrayBuffer | null>;
  list(mode: OfflineSlotMode): Promise<OfflineSlotSummary[]>;
  remove(mode: OfflineSlotMode, slotNo: number): Promise<void>;
  upload(mode: OfflineSlotMode, slotNo: number, body: ArrayBuffer): Promise<OfflineSlotSummary>;
}


/** Runs writes one at a time, `spacingMs` apart: a Save right after a working-copy upload is not refused. */
const spacedWrites = (spacingMs: number, now: () => number) => {
  let queue: Promise<unknown> = Promise.resolve(), last = -Infinity;
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  return <T>(write: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(async () => {
      const delay = last + spacingMs - now();
      if (delay > 0) await wait(delay);
      last = now();
      return write();
    });
    queue = next;
    return next;
  };
};

const slotPath = (mode: OfflineSlotMode, slotNo: number) => `${OFFLINE_SLOTS_PATH}/${mode}/${slotNo}`;

export const createOfflineSlotsClient = (
  options: SaveApiOptions, now: () => number = Date.now
): OfflineSlotsClient => {
  const { read, send } = createApiTransport(options);
  const spaced = spacedWrites(OFFLINE_WRITE_SPACING_MS, now);
  const expectOk = async (response: Response) => {
    if (!response.ok) throw await readApiError(response);
    return response;
  };
  return {
    download: async (mode, slotNo) => {
      const response = await send("GET", slotPath(mode, slotNo));
      if (response.status === HTTP_NOT_FOUND) return null;
      return (await expectOk(response)).arrayBuffer();
    },
    list: async mode =>
      (await read<{ slots: OfflineSlotSummary[] }>(`${OFFLINE_SLOTS_PATH}?mode=${mode}`)).slots,
    remove: (mode, slotNo) => spaced(async () => {
      await expectOk(await send("DELETE", slotPath(mode, slotNo)));
    }),
    upload: (mode, slotNo, body) => spaced(async () =>
      await (await expectOk(await send("PUT", slotPath(mode, slotNo), { body }))).json() as OfflineSlotSummary)
  };
};
