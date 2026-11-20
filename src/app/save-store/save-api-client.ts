import type {
  GameSettingsRevision
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { SnapshotRowKey } from "../../../../island-of-settlers-shared/src/island-key";
import type { ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import type { IslandKey } from "../../shared/settlement/game-save-rows";
import type { RandomDraw } from "../../shared/settlement/simulation-random";
import type { AwaySummary } from "../settlement/away-summary";

/**
 * Typed client of the standalone save API (docs/server/save-api.md). Every call carries the identity service's
 * bearer token; writes name the slot revision they replace in `If-Match`, and a stale revision is a conflict
 * result (409), never an exception. Not wired to the game yet (backend plan, step A1).
 */
export interface SaveSlot {
  id: string;
  name: string;
  revision: number;
  slot_no: number;
}
/** One island document as the API stores it (opaque `data`, queryable `metadata`). */
export interface IslandDocument {
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  schemaVersion: number;
}
export interface StoredIsland extends IslandDocument {
  revision: number;
  slotRevision: number;
}
export interface ExpeditionEntry {
  data: Record<string, unknown>;
  expeditionId: number;
}
/** A complete slot: every island, the player, the session and the colony / adventure / evacuation tables. */
export interface SaveSnapshot {
  adventures: ExpeditionEntry[];
  colonies: ExpeditionEntry[];
  evacuations: ExpeditionEntry[];
  /** The islands and the campaign run on screen (its run key, campaign server part 2). */
  islands: { key: SnapshotRowKey; save: IslandDocument }[];
  player: Record<string, unknown>;
  session: Record<string, unknown>;
}
/** An island of a read that the client said it holds: only its signature comes back (research 12 S07). */
export interface UnchangedIsland { key: SnapshotRowKey; unchanged: string }
export interface StoredSnapshot extends SaveSnapshot {
  /** Content signature of every stored island that has one: what an upload may refer to as unchanged. */
  islandSignatures?: Record<string, string>;
  mapBaseHashes?: string[];
  revision: number;
}
/** A snapshot read that named the islands the client holds: those come back as references. */
export interface KnownStoredSnapshot extends Omit<StoredSnapshot, "islands"> {
  islands: (SaveSnapshot["islands"][number] | UnchangedIsland)[];
}
/** Why a revisioned write was refused: the slot moved on, or another device took this account's session. */
export type WriteRefusal = "conflict" | "lease-lost";
/** After a verification mismatch (D4.3) the server asks for the RNG ring buffer of one uploaded interval. */
export interface RandomTrailRequest { endTick: number; island: string; revision: number }
/**
 * The slot's verification state (`GET /v1/saves/:slot/verification`): the last revision the server replayed
 * successfully (the restore point), any mismatch/plausibility flag, and a pending trail request after a mismatch.
 */
export interface SaveVerification {
  flag: Record<string, unknown> | null;
  flaggedAt: string | null;
  randomTrailRequest: RandomTrailRequest | null;
  verifiedRevision: number | null;
}
export type SaveWriteResult = { islandSignatures?: Record<string, string>; ok: true; mapBases?: string[];
  randomTrailRequest?: RandomTrailRequest; revision: number } | { ok: false; reason: WriteRefusal };
/** The server does not hold the islands an upload referred to as unchanged: send these complete (research 12 S07). */
export interface IslandsRequired { keys: string[]; ok: false; reason: "islands-required" }
export type SnapshotWriteResult = IslandsRequired | SaveWriteResult;
/** The server's offline catch-up at login (D4.4): the advanced snapshot (none when no time passed) and summary. */
export type CatchUpResult = { ok: true; revision: number; snapshot?: SaveSnapshot; summary: AwaySummary | null } |
  { ok: false; reason: WriteRefusal | "unavailable" };
export type SlotCreateResult = { ok: true; slot: SaveSlot } | { conflict: true; ok: false };

/** The account's single live session (lease): renewed by heartbeat, taken over explicitly. */
export interface SessionLease {
  expiresAt: string;
  /** The game settings this lease granted (acquire only, GS1): the session's islands adopt their rules (GS2). */
  gameSettings?: GameSettingsRevision;
  leaseId: string;
  /** The server's UTC time (ISO, `…Z`) when it answered: the session's game clock anchor. */
  serverTime?: string;
  ttlSeconds: number;
}
/** The server is at its player cap: how many play, the cap and this player's place in the queue. */
export interface ServerFull {
  active: number;
  capacity: number;
  position: number;
}
export type LeaseResult = { lease: SessionLease; ok: true } | { ok: false; reason: "held" | "lost" } |
  ({ ok: false; reason: "full" } & ServerFull);

/** A failed request other than a revision conflict: the API's code/message/requestId envelope. */
export class SaveApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status: number;
  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.code = code;
    this.name = "SaveApiError";
    this.requestId = requestId;
    this.status = status;
  }
}

export interface SaveApiOptions {
  apiUrl: string;
  fetch?: typeof fetch;
  /** A current access token for the `api` audience (the identity service refreshes it). */
  getAccessToken: () => Promise<string>;
  /** A token the API refused (401): renew it once before the request fails. */
  renewAccessToken?: () => Promise<unknown>;
}

/** Status 0: the request never reached the API (offline, DNS, CORS, aborted). */
const NETWORK_FAILURE = 0;
const CONFLICT = 409;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const SERVICE_UNAVAILABLE = 503;
const LEASE_HEADER = "X-Session-Lease";

/** Offline, overloaded or briefly unauthorized: retry later; everything else is a real refusal. */
export const isTransientFailure = (error: unknown) => error instanceof SaveApiError &&
  (error.status === NETWORK_FAILURE || error.status === UNAUTHORIZED || error.status === 429 || error.status >= 500);

export const readApiError = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as { code?: string; message?: string; requestId?: string };
  return new SaveApiError(response.status, body.code ?? "REQUEST_FAILED",
    body.message ?? `Save request failed (${response.status})`, body.requestId);
};

/** The bytes of a binary answer; null when the API has no such file (404). */
export const readApiBytes = async (response: Response) => {
  if (response.status === NOT_FOUND) return null;
  if (!response.ok) throw await readApiError(response);
  return new Uint8Array(await response.arrayBuffer());
};

const ISLAND_SIGNATURE_MISMATCH = "ISLAND_SIGNATURE_MISMATCH";
const UNPROCESSABLE = 422;

const refusal = async (response: Response): Promise<WriteRefusal> => {
  const body = await response.json().catch(() => ({})) as { code?: string };
  return body.code === "SESSION_LEASE_LOST" ? "lease-lost" : "conflict";
};

/** `?known=key:signature,...` for a snapshot read; nothing when the client holds no island. */
const knownQuery = (known: Readonly<Record<string, string>> | undefined) => {
  const entries = Object.entries(known ?? {});
  if (!entries.length) return "";
  return `?known=${encodeURIComponent(entries.map(([key, signature]) => `${key}:${signature}`).join(","))}`;
};

/** The ETag form of a revision (the API also accepts it unquoted). */
const ifMatch = (revision: number) => `"${revision}"`;

interface SendOptions {
  /** JSON body, or a gzip-compressed JSON body (ArrayBuffer). */
  body?: unknown;
  /** Outlives the page (a release sent while the tab closes). */
  keepalive?: boolean;
  lease?: string;
  revision?: number;
  /** CHAIN cheap slice: one-use token for a no-command snapshot upload. */
  intervalToken?: string;
}

const requestHeaders = (token: string, { body, intervalToken, lease, revision }: SendOptions) => {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (body instanceof ArrayBuffer) headers["Content-Encoding"] = "gzip";
  if (revision !== undefined) headers["If-Match"] = ifMatch(revision);
  if (lease) headers[LEASE_HEADER] = lease;
  if (intervalToken) headers["X-Interval-Token"] = intervalToken;
  return headers;
};

const requestBody = (body: unknown) => {
  if (body === undefined || body instanceof ArrayBuffer) return body;
  return JSON.stringify(body);
};

/** Authenticated requests to the API (save and economy clients): bearer token, one renewal on 401. */
export const createApiTransport = ({
  apiUrl, fetch: request = fetch, getAccessToken, renewAccessToken
}: SaveApiOptions) => {
  const attempt = async (method: string, path: string, options: SendOptions) => {
    const token = await getAccessToken();
    try {
      return await request(`${apiUrl}${path}`, { body: requestBody(options.body), cache: "no-store",
        credentials: "omit", headers: requestHeaders(token, options), keepalive: options.keepalive, method });
    } catch (error) {
      throw new SaveApiError(NETWORK_FAILURE, "NETWORK", error instanceof Error ? error.message : "Offline");
    }
  };
  /** One request; a refused token is renewed once (identity rotates tokens every 15 minutes). */
  const send = async (method: string, path: string, options: SendOptions = {}) => {
    const response = await attempt(method, path, options);
    if (response.status !== UNAUTHORIZED || !renewAccessToken) return response;
    await renewAccessToken();
    return attempt(method, path, options);
  };
  const read = async <T>(path: string) => {
    const response = await send("GET", path);
    if (!response.ok) throw await readApiError(response);
    return await response.json() as T;
  };
  return { read, send };
};

export const createSaveApiClient = (options: SaveApiOptions) => {
  const { read, send } = createApiTransport(options);
  /** A revisioned write: the new revision, or why the slot refused it (409). */
  const write = async (method: string, path: string, options: SendOptions): Promise<SaveWriteResult> =>
    settleWrite(await send(method, path, options), options);
  const settleWrite = async (response: Response, options: SendOptions): Promise<SaveWriteResult> => {
    if (response.status === CONFLICT) return { ok: false, reason: await refusal(response) };
    if (!response.ok) throw await readApiError(response);
    if (response.status === 204) return { ok: true, revision: options.revision ?? 0 };
    const { islandSignatures, mapBases, randomTrailRequest, revision } =
      await response.json() as Omit<SaveWriteResult & { ok: true }, "ok">;
    return { ok: true, revision, ...(islandSignatures ? { islandSignatures } : {}), ...(mapBases ? { mapBases } : {}),
      ...(randomTrailRequest ? { randomTrailRequest } : {}) };
  };
  const lease = async (method: string, path: string, body?: unknown): Promise<LeaseResult> => {
    const response = await send(method, path, { body });
    if (response.status === CONFLICT) {
      const code = ((await response.json().catch(() => ({}))) as { code?: string }).code;
      return { ok: false, reason: code === "SESSION_LEASE_HELD" ? "held" : "lost" };
    }
    if (response.status === SERVICE_UNAVAILABLE) {
      const body = await response.clone().json().catch(() => ({})) as Partial<ServerFull> & { code?: string };
      if (body.code === "SERVER_FULL")
        return { active: body.active ?? 0, capacity: body.capacity ?? 0, ok: false, position: body.position ?? 0,
          reason: "full" };
    }
    if (!response.ok) throw await readApiError(response);
    return { lease: await response.json() as SessionLease, ok: true };
  };
  const slotPath = (slotId: string) => `/v1/saves/${encodeURIComponent(slotId)}`;
  const leasePath = (leaseId: string) => `/v1/session-lease/${encodeURIComponent(leaseId)}`;
  return {
    /** The account's live session; an active one elsewhere is `held` unless `takeOver`. */
    acquireLease: (takeOver: boolean) => lease("POST", "/v1/session-lease", { takeOver }),
    /** Creates an empty slot (1..3); a taken slot number is a conflict. */
    createSlot: async (slotNo: number, name: string): Promise<SlotCreateResult> => {
      const response = await send("POST", "/v1/saves", { body: { name, slotNo } });
      if (response.status === CONFLICT) return { conflict: true, ok: false };
      if (!response.ok) throw await readApiError(response);
      return { ok: true, slot: await response.json() as SaveSlot };
    },
    deleteSlot: (slotId: string, revision: number, leaseId?: string) =>
      write("DELETE", slotPath(slotId), { lease: leaseId, revision }),
    listSlots: () => read<SaveSlot[]>("/v1/saves"),
    readIsland: (slotId: string, island: IslandKey) => read<StoredIsland>(`${slotPath(slotId)}/islands/${island}`),
    readSnapshot: (slotId: string) => read<StoredSnapshot>(`${slotPath(slotId)}/snapshot`),
    /** The slot's snapshot; islands named in `known` (key -> signature) come back as references when unchanged. */
    readKnownSnapshot: (slotId: string, known: Readonly<Record<string, string>>) =>
      read<KnownStoredSnapshot>(`${slotPath(slotId)}/snapshot${knownQuery(known)}`),
    readArchivedIslandAnchor: (slotId: string, island: IslandKey) =>
      read<{ revision: number | null; tick?: number; savedAt?: number }>(`/v1/economy/relief/anchors/${encodeURIComponent(slotId)}/${island}`),
    verifyArchivedIsland: async (slotId: string, revision: number, proof: ArchivedIslandProof) => {
      const response = await send("POST", "/v1/economy/relief/verify", { body: { slot: slotId, revision, proof } });
      if (!response.ok) throw await readApiError(response);
      return await response.json() as { verified: true; revision: number; island: IslandKey };
    },
    /** The slot's verified revision, flag and pending trail request (D4.3); no-store on the API. */
    readVerification: (slotId: string) => read<SaveVerification>(`${slotPath(slotId)}/verification`),
    /** Development: removes the signed-in account's cloud saves without touching identity/economy. */
    clearDebugSaves: async () => {
      const response = await send("POST", "/v1/debug/saves/clear", { body: {} });
      if (!response.ok) throw await readApiError(response);
      return await response.json() as { cleared: number };
    },
    /** Development hosts only: truncates every application table and recreates a fresh game state. */
    recreateDebugDatabase: async () => {
      const response = await send("POST", "/v1/debug/database/recreate", { body: {} });
      if (!response.ok) throw await readApiError(response);
      return await response.json() as { recreated: true };
    },
    /** Ends this device's session; `keepalive` lets it finish while the tab closes. */
    releaseLease: async (leaseId: string, keepalive = false) => { await send("DELETE", leasePath(leaseId), { keepalive }); },
    /** Heartbeat: `lost` once another device took the session over (or it expired). */
    renewLease: (leaseId: string) => lease("PUT", leasePath(leaseId)),
    writeIsland: (slotId: string, island: IslandKey, revision: number, save: IslandDocument, leaseId?: string) =>
      write("PUT", `${slotPath(slotId)}/islands/${island}`, { body: save, lease: leaseId, revision }),
    /** Asks the server to catch the slot up to its UTC now with this build's offline progress (D4.4). */
    catchUp: async (slotId: string, revision: number, sourceVersion: string, leaseId?: string): Promise<CatchUpResult> => {
      const response = await send("POST", `${slotPath(slotId)}/catch-up`,
        { body: { sourceVersion }, lease: leaseId, revision });
      if (response.status === CONFLICT) return { ok: false, reason: await refusal(response) };
      if (response.status === SERVICE_UNAVAILABLE) return { ok: false, reason: "unavailable" };
      if (!response.ok) throw await readApiError(response);
      return { ok: true, ...await response.json() as Omit<CatchUpResult & { ok: true }, "ok"> };
    },
    /** The client's RNG ring buffer of an interval whose server replay diverged (`RandomTrailRequest`). */
    sendRandomTrail: async (slotId: string, revision: number, draws: readonly RandomDraw[]) => {
      const response = await send("PUT", `${slotPath(slotId)}/random-trail`, { body: { draws, revision } });
      if (!response.ok) throw await readApiError(response);
    },
    /** A short-lived one-use token for a legitimate no-command snapshot upload. */
    issueIntervalToken: async (slotId: string, revision: number, leaseId?: string) => {
      const response = await send("POST", `${slotPath(slotId)}/interval-token`, { body: {}, lease: leaseId, revision });
      if (!response.ok) throw await readApiError(response);
      return await response.json() as { expiresAt: string; token: string };
    },
    /** A complete snapshot as a gzip-compressed JSON body (snapshot-body.ts), against `revision`. */
    writeSnapshot: async (slotId: string, revision: number, body: ArrayBuffer, leaseId?: string,
      intervalToken?: string): Promise<SnapshotWriteResult> => {
      const options = { body, intervalToken, lease: leaseId, revision };
      const response = await send("PUT", `${slotPath(slotId)}/snapshot`, options);
      if (response.status === UNPROCESSABLE) {
        const refused = await response.clone().json().catch(() => ({})) as { code?: string; keys?: string[] };
        if (refused.code === ISLAND_SIGNATURE_MISMATCH && Array.isArray(refused.keys))
          return { keys: refused.keys, ok: false, reason: "islands-required" };
      }
      return settleWrite(response, options);
    }
  };
};

export type SaveApiClient = ReturnType<typeof createSaveApiClient>;
