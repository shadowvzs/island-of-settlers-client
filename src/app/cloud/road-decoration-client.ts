import { validPlayerInventory } from "../../../../island-of-settlers-shared/src/player-inventory";
import { isRoadDecorationCustodyRequest, type RoadDecorationAction, type RoadDecorationCustodyReceipt,
  type RoadDecorationCustodyRequest, type RoadDecorationIslandKey } from "../../../../island-of-settlers-shared/src/road-decoration-custody";
import { PREFERENCE_FAMILIES } from "../preferences/keys";
import { createApiTransport, readApiError, SaveApiError, type SaveApiOptions } from "../save-store/save-api-client";

type Answer = ({ ok: true } & RoadDecorationCustodyReceipt) | { ok: false; code?: string; reason: string };
export interface RoadDecorationTransport { mutate(body: RoadDecorationCustodyRequest): Promise<Answer> }
export const createRoadDecorationTransport = (options: SaveApiOptions & { leaseId(): string | undefined }): RoadDecorationTransport => {
  const request = options.fetch ?? globalThis.fetch;
  const boundedFetch: typeof fetch = async (input, init) => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
    try { return await request(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  };
  const { send } = createApiTransport({ ...options, fetch: boundedFetch });
  return { mutate: async body => {
    const response = await send("POST", "/v1/economy/items/road-decoration", { body, lease: options.leaseId() });
    if (response.status === 409) {
      const error = await readApiError(response); return { ok: false, code: error.code, reason: error.message };
    }
    if (!response.ok) throw await readApiError(response);
    return { ok: true, ...await response.json() as RoadDecorationCustodyReceipt };
  } };
};

interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface Options {
  accountId: string;
  slotId: string;
  storage: StoragePort;
  transport: RoadDecorationTransport;
  revision(): number | null;
  adopt(revision: number, apply: () => void): Promise<{ ok: boolean }>;
  newKey?: () => string;
}
export type RoadDecorationOutcome = { ok: true; receipt: RoadDecorationCustodyReceipt; reload: boolean } |
  { ok: false; reason: string; pending?: boolean };
const PENDING = "Road decoration is awaiting server confirmation";

/** One durable exact request prevents retries, reloads and island switches from duplicating an owned unit. */
export const createRoadDecorationClient = ({ accountId, adopt, newKey = () => crypto.randomUUID(), revision, slotId, storage,
  transport }: Options) => {
  const key = `${PREFERENCE_FAMILIES.inventoryRequest.prefix}${accountId}:${slotId}:road-decoration`;
  let busy = false;
  const pending = (): RoadDecorationCustodyRequest | null => {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (isRoadDecorationCustodyRequest(value) && value.slotId === slotId) return value;
    } catch { /* Invalid local data cannot authorize a mutation. */ }
    storage.removeItem(key); return null;
  };
  const valid = (answer: RoadDecorationCustodyReceipt, request: RoadDecorationCustodyRequest) =>
    answer.slotId === slotId && answer.islandKey === request.islandKey && answer.revision === request.revision + 1 &&
    Number.isSafeInteger(answer.result?.returned) && answer.result.returned >= 0 &&
    Number.isSafeInteger(answer.wallet?.gems) && answer.wallet.gems >= 0 && validPlayerInventory(answer.wallet.items);
  const execute = async (request: RoadDecorationCustodyRequest, retry: boolean, ambiguous?: () => void) => {
    try { return await transport.mutate(request); }
    catch (error) {
      if (!retry || (error instanceof SaveApiError && error.status >= 400 && error.status < 500)) throw error;
      ambiguous?.(); return transport.mutate(request);
    }
  };
  return {
    reconcile: async () => {
      const request = pending(); if (!request) return { confirmed: false };
      const answer = await execute(request, false);
      if (!answer.ok) {
        if (answer.code === "SESSION_LEASE_LOST") throw new Error(PENDING);
        storage.removeItem(key); return { confirmed: false };
      }
      if (!valid(answer, request)) throw new Error(PENDING);
      storage.removeItem(key); return { confirmed: true, receipt: answer };
    },
    mutate: async (islandKey: RoadDecorationIslandKey, action: RoadDecorationAction,
      apply: (settlement: unknown) => void): Promise<RoadDecorationOutcome> => {
      if (busy) return { ok: false, reason: "Another inventory action is in progress" };
      const previous = pending();
      if (previous && (previous.islandKey !== islandKey || JSON.stringify(previous.action) !== JSON.stringify(action)))
        return { ok: false, pending: true, reason: PENDING };
      const current = revision();
      if (current === null || current < 1) return { ok: false, reason: "Save the island before placing this item" };
      const request = previous ?? { islandKey, action, idempotencyKey: newKey(), revision: current, slotId };
      storage.setItem(key, JSON.stringify(request)); busy = true;
      let uncertain = Boolean(previous);
      try {
        const answer = await execute(request, true, () => { uncertain = true; });
        if (!answer.ok) {
          if (uncertain && answer.code === "SESSION_LEASE_LOST") return { ok: false, pending: true, reason: PENDING };
          storage.removeItem(key); return answer;
        }
        if (!valid(answer, request)) return { ok: false, pending: true, reason: PENDING };
        let reload = answer.settlement == null;
        if (!reload) {
          try { reload = !(await adopt(answer.revision, () => apply(answer.settlement))).ok; }
          catch { reload = true; }
        }
        if (!reload) storage.removeItem(key);
        return { ok: true, receipt: answer, reload };
      } catch (error) {
        if (!uncertain && error instanceof SaveApiError && error.status >= 400 && error.status < 500) {
          storage.removeItem(key); return { ok: false, reason: error.message };
        }
        return { ok: false, pending: true, reason: PENDING };
      } finally { busy = false; }
    }
  };
};
export type RoadDecorationClient = ReturnType<typeof createRoadDecorationClient>;
