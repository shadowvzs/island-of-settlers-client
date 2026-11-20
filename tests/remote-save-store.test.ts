import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapturedGame } from "../src/app/save-store/captured-game";
import {
  type CloudSaveStatus, createRemoteSaveStore, type RecoveryStore, RUN_END_NOT_SAVED, SaveConflictError,
  SessionTakenOverError
} from "../src/app/save-store/remote-save-store";
import {
  createSaveApiClient, isTransientFailure, SaveApiError, type StoredSnapshot
} from "../src/app/save-store/save-api-client";
import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import type { CommandLogInterval } from "../src/shared/settlement/command-log";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import {
  clearSaveStageProfile, readSaveStageProfile
} from "../src/shared/settlement/save-stage-profile";
import type { RandomDraw } from "../src/shared/settlement/simulation-random";
import { createMemorySaveStore } from "./memory-save-store";
import { completeGame } from "./save-fixtures";

const API = "https://api.example.test";
const SLOT = "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11";
const LEASE = "9d6b8a51-1f0e-4a3e-9a51-2d0f2d1f0b22";

interface Call {
  body: unknown;
  headers: Record<string, string>;
  keepalive?: boolean;
  method: string;
  url: string;
}

const decodeBody = (body: BodyInit | null | undefined) => {
  if (body === undefined || body === null) return undefined;
  if (body instanceof ArrayBuffer) return JSON.parse(gunzipSync(Buffer.from(body)).toString("utf8"));
  return JSON.parse(body as string);
};

/** A mocked fetch answering every request with the next queued response (a thrown Error: offline). */
const mockFetch = (...responses: (Response | Error)[]) => {
  const calls: Call[] = [], renew = vi.fn(async () => undefined);
  const request = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ body: decodeBody(init.body), headers: init.headers as Record<string, string>,
      keepalive: init.keepalive, method: init.method!, url: url.slice(API.length) });
    // The token endpoint is infrastructure, not one of the scripted save responses.
    if (url.endsWith("/interval-token")) return json({ expiresAt: "2026-10-30T12:05:00.000Z", token: "token-1" });
    const next = responses.shift() ?? new Response(null, { status: 500 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const client = createSaveApiClient({ apiUrl: API, fetch: request, getAccessToken: async () => "token-1",
    renewAccessToken: renew });
  return { calls, client, renew };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const conflict = () => json({ code: "SAVE_CONFLICT", message: "Save changed", requestId: "r1" }, 409);
const leaseLost = () => json({ code: "SESSION_LEASE_LOST", message: "Taken over", requestId: "r2" }, 409);
const gzipBody = async (value: unknown) =>
  new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();

/** A home island with trade lists: the API has no trade tables, so they stay inside the island document. */
const tradingGame = (): GameSaveV1 => {
  const game = completeGame();
  const trade = { history: [{ id: "h1", wares: 3 }], offers: [{ id: "o1", give: "stone" }] };
  const home = { ...game.archipelago!.home!, settlement: { trade } as unknown as GameSaveV1["settlement"] };
  return { ...game, archipelago: { ...game.archipelago!, home } };
};

describe("save API client", () => {
  it("sends the bearer token, gzip snapshot bodies, quoted If-Match revisions and the session lease", async () => {
    const { calls, client } = mockFetch(json([]), json({ id: SLOT, name: "Main", revision: 0, slot_no: 1 }, 201),
      json({ revision: 4 }), json({ revision: 5 }), new Response(null, { status: 204 }));
    await client.listSlots();
    expect(await client.createSlot(1, "Main")).toMatchObject({ ok: true, slot: { id: SLOT } });
    const snapshot = toSaveSnapshot(completeGame());
    expect(await client.writeSnapshot(SLOT, 3, await gzipBody(snapshot), LEASE)).toEqual({ ok: true, revision: 4 });
    const island = snapshot.islands[0]!.save;
    expect(await client.writeIsland(SLOT, "home", 4, island)).toEqual({ ok: true, revision: 5 });
    expect(await client.deleteSlot(SLOT, 5)).toEqual({ ok: true, revision: 5 });
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      "GET /v1/saves", "POST /v1/saves", `PUT /v1/saves/${SLOT}/snapshot`, `PUT /v1/saves/${SLOT}/islands/home`,
      `DELETE /v1/saves/${SLOT}`
    ]);
    expect(calls.every(call => call.headers.Authorization === "Bearer token-1")).toBe(true);
    expect(calls.map(call => call.headers["If-Match"])).toEqual([undefined, undefined, "\"3\"", "\"4\"", "\"5\""]);
    expect(calls[1]!.body).toEqual({ name: "Main", slotNo: 1 });
    expect(calls[2]!.body).toEqual(snapshot);
    expect(calls[2]!.headers).toMatchObject({ "Content-Encoding": "gzip", "Content-Type": "application/json",
      "X-Session-Lease": LEASE });
    expect(calls[3]!.headers["Content-Encoding"]).toBeUndefined();
    expect(calls[3]!.body).toEqual(island);
  });

  it("acquires, renews and releases the session lease", async () => {
    const lease = { expiresAt: "2026-10-22T12:00:00.000Z", leaseId: LEASE, ttlSeconds: 90 };
    const { calls, client } = mockFetch(json(lease), json({ code: "SESSION_LEASE_HELD" }, 409), json(lease),
      json({ code: "SESSION_LEASE_LOST" }, 409), new Response(null, { status: 204 }));
    expect(await client.acquireLease(false)).toEqual({ lease, ok: true });
    expect(await client.acquireLease(false)).toEqual({ ok: false, reason: "held" });
    expect(await client.renewLease(LEASE)).toEqual({ lease, ok: true });
    expect(await client.renewLease(LEASE)).toEqual({ ok: false, reason: "lost" });
    await client.releaseLease(LEASE, true);
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual(["POST /v1/session-lease",
      "POST /v1/session-lease", `PUT /v1/session-lease/${LEASE}`, `PUT /v1/session-lease/${LEASE}`,
      `DELETE /v1/session-lease/${LEASE}`]);
    expect(calls[0]!.body).toEqual({ takeOver: false });
    expect(calls[4]!.keepalive).toBe(true);
  });

  it("tells a stale revision from a lost lease, renews a refused token once and classifies failures", async () => {
    const { calls, client, renew } = mockFetch(conflict(), leaseLost(), new Response(null, { status: 401 }),
      json([]), json({ code: "NOT_FOUND", message: "Save slot or island not found", requestId: "r2" }, 404),
      new TypeError("Failed to fetch"), json({ code: "SERVICE_NOT_READY" }, 503));
    const body = await gzipBody(toSaveSnapshot(completeGame()));
    expect(await client.writeSnapshot(SLOT, 1, body)).toEqual({ ok: false, reason: "conflict" });
    expect(await client.writeSnapshot(SLOT, 1, body, LEASE)).toEqual({ ok: false, reason: "lease-lost" });
    expect(await client.listSlots()).toEqual([]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(calls.slice(2).map(call => call.url)).toEqual(["/v1/saves", "/v1/saves"]);
    await expect(client.readSnapshot(SLOT)).rejects.toMatchObject({ code: "NOT_FOUND", requestId: "r2", status: 404 });
    const offline = await client.listSlots().catch((error: unknown) => error);
    expect(offline).toBeInstanceOf(SaveApiError);
    expect(isTransientFailure(offline)).toBe(true);
    const unavailable = await client.listSlots().catch((error: unknown) => error);
    expect(isTransientFailure(unavailable)).toBe(true);
    expect(isTransientFailure(new SaveApiError(404, "NOT_FOUND", "gone"))).toBe(false);
  });
});

describe("save snapshot", () => {
  it("round trips every island, expedition, evacuation, player and session row", () => {
    expect(fromSaveSnapshot(toSaveSnapshot(completeGame()))).toEqual(completeGame());
    expect(fromSaveSnapshot(toSaveSnapshot(tradingGame()))).toEqual(tradingGame());
  });

  it("matches the API's complete snapshot input", () => {
    const snapshot = toSaveSnapshot(completeGame());
    expect(snapshot.islands.map(island => island.key).sort()).toEqual(["adventure-5", "colony-2", "home"]);
    expect(snapshot.islands[0]!.save).toEqual(expect.objectContaining({ metadata: { savedAt: 50 }, schemaVersion: 4 }));
    expect(snapshot.colonies.map(entry => entry.expeditionId)).toEqual([2]);
    expect(snapshot.adventures.map(entry => entry.expeditionId)).toEqual([5]);
    expect(snapshot.evacuations.map(entry => entry.expeditionId)).toEqual([3]);
    expect(snapshot.player).toMatchObject({ gems: 42 });
    expect(snapshot.session).toMatchObject({ active: 2, released: [7] });
    expect(snapshot.session).not.toHaveProperty("id");
  });

  it("reads an empty slot as no game", () => {
    const empty: StoredSnapshot = { adventures: [], colonies: [], evacuations: [], islands: [], player: {},
      revision: 0, session: {} };
    expect(fromSaveSnapshot(empty)).toBeNull();
  });
});

describe("RemoteSaveStore", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { __saveStageProfile?: boolean }).__saveStageProfile;
    clearSaveStageProfile();
  });

  const stored = () => json({ ...toSaveSnapshot(completeGame()), revision: 3 });
  /** A remote store whose captured games encode to numbered bodies; the recovery copy lives in memory. */
  const remoteStore = (...responses: (Response | Error)[]) => {
    const mocked = mockFetch(...responses), memory = createMemorySaveStore(), statuses: CloudSaveStatus[] = [];
    let encoded = 0, cleared = 0;
    const local: RecoveryStore = { ...memory.store, clearSavedGame: async () => { cleared++; }, slotId: "rec" };
    const store = createRemoteSaveStore({ api: mocked.client, leaseId: () => LEASE, local, now: () => 0,
      onStatus: status => statuses.push(status), slotId: SLOT,
      encodeCaptured: async (_captured, slotId) => {
        expect(slotId).toBe("rec");
        encoded++;
        return gzipBody({ write: encoded });
      } });
    return { ...mocked, captured: {} as CapturedGame, cleared: () => cleared, encoded: () => encoded, memory,
      statuses, store };
  };

  it("attributes cloud read, upload and recovery-clear stages when profiling is opted in", async () => {
    const { captured, store } = remoteStore(stored(), json({ revision: 4 }));
    (globalThis as { __saveStageProfile?: boolean }).__saveStageProfile = true;
    await store.readSavedGame();
    await store.writeCapturedGame(captured);
    expect(readSaveStageProfile().map(sample => sample.name)).toEqual([
      "save.cloud.read", "save.cloud.expand", "save.cloud.upload", "save.cloud.clearRecovery"
    ]);
  });

  it("keeps a local copy first, uploads against the revision it read and drops the copy once confirmed", async () => {
    const { calls, captured, cleared, encoded, statuses, store } = remoteStore(stored(), json({ revision: 4 }),
      json({ revision: 5 }));
    expect(await store.readSavedGame()).toEqual(completeGame());
    await store.writeCapturedGame(captured);
    await store.writeCapturedGame(captured);
    expect(encoded()).toBe(2);
    const uploads = calls.filter(call => call.method === "PUT");
    expect(uploads.map(call => call.headers["If-Match"])).toEqual(["\"3\"", "\"4\""]);
    expect(uploads[0]!.headers["X-Session-Lease"]).toBe(LEASE);
    expect(uploads[0]!.headers["X-Interval-Token"]).toBe("token-1");
    expect(uploads[1]!.body).toEqual({ write: 2 });
    expect(cleared()).toBe(2);
    expect(store.revision()).toBe(5);
    expect(statuses.map(status => status.kind)).toEqual(["saving", "saved", "saving", "saved"]);
  });

  describe("unchanged islands (S07)", () => {
    const SIGNATURES = { colony: "c".repeat(64), home: "a".repeat(64) };
    const refusal = () => json({ code: "ISLAND_SIGNATURE_MISMATCH", keys: ["colony-2"], message: "Send these",
      requestId: "r9" }, 422);
    const signedStore = (...responses: (Response | Error)[]) => {
      const mocked = mockFetch(...responses), memory = createMemorySaveStore();
      const known: (Record<string, string> | undefined)[] = [], completed: string[][] = [];
      const store = createRemoteSaveStore({ api: mocked.client, leaseId: () => LEASE, now: () => 0, onStatus: () => {},
        local: { ...memory.store, clearSavedGame: async () => {}, slotId: "rec" }, slotId: SLOT,
        completeBody: async (_slot, keys) => {
          completed.push(keys);
          return { body: await gzipBody({ complete: keys }), signatures: SIGNATURES };
        },
        encodeCaptured: async (_captured, _slot, _bases, serverSignatures) => {
          known.push(serverSignatures);
          return { body: await gzipBody({ slim: known.length }), signatures: SIGNATURES };
        } });
      return { ...mocked, completed, known, store };
    };

    it("hands the server's signatures from the read and from each upload answer to the next encoding", async () => {
      const { known, store } = signedStore(
        json({ ...toSaveSnapshot(completeGame()), islandSignatures: { home: "1".repeat(64) }, revision: 3 }),
        json({ islandSignatures: SIGNATURES, revision: 4 }), json({ revision: 5 }));
      await store.readSavedGame();
      await store.writeCapturedGame({} as CapturedGame);
      await store.writeCapturedGame({} as CapturedGame);
      expect(known).toEqual([{ home: "1".repeat(64) }, SIGNATURES]);
    });

    it("sends the islands again, complete, when the server does not hold the referenced ones", async () => {
      const { calls, completed, store } = signedStore(stored(), refusal(),
        json({ islandSignatures: SIGNATURES, revision: 4 }));
      await store.readSavedGame();
      await store.writeCapturedGame({} as CapturedGame);
      expect(completed).toEqual([["colony-2"]]);
      const uploads = calls.filter(call => call.method === "PUT");
      expect(uploads.map(call => call.body)).toEqual([{ slim: 1 }, { complete: ["colony-2"] }]);
      expect(uploads.map(call => call.headers["If-Match"])).toEqual(["\"3\"", "\"3\""]);
      expect(store.revision()).toBe(4);
      expect(store.hasPendingUpload()).toBe(false);
    });

    it("reads a second time with the islands it holds and fills the references from them", async () => {
      const base = toSaveSnapshot(completeGame());
      const signatures = Object.fromEntries(base.islands.map((island, index) => [island.key, String(index).repeat(64)]));
      const references = base.islands.slice(1).map(island => ({ key: island.key, unchanged: signatures[island.key]! }));
      const { calls, store } = signedStore(
        json({ ...base, islandSignatures: signatures, revision: 3 }),
        json({ ...base, islandSignatures: signatures, islands: [base.islands[0], ...references], revision: 3 }));
      const first = await store.readSavedGame();
      expect(await store.readSavedGame()).toEqual(first);
      const reads = calls.filter(call => call.method === "GET");
      expect(reads[0]!.url).toBe(`/v1/saves/${SLOT}/snapshot`);
      expect(decodeURIComponent(reads[1]!.url.split("known=")[1]!).split(",").sort())
        .toEqual(Object.entries(signatures).map(([key, signature]) => `${key}:${signature}`).sort());
    });

    it("reads everything again once a save was written (the held documents may have changed)", async () => {
      const base = toSaveSnapshot(completeGame());
      const { calls, store } = signedStore(
        json({ ...base, islandSignatures: { home: "1".repeat(64) }, revision: 3 }), json({ revision: 4 }),
        json({ ...base, revision: 4 }));
      await store.readSavedGame();
      await store.writeCapturedGame({} as CapturedGame);
      await store.readSavedGame();
      expect(calls.filter(call => call.method === "GET").map(call => call.url))
        .toEqual([`/v1/saves/${SLOT}/snapshot`, `/v1/saves/${SLOT}/snapshot`]);
    });
  });

  it("sends the command logs since the last confirmed revision and the ring buffer the server asks for", async () => {
    const mocked = mockFetch(stored(), json({ randomTrailRequest: { endTick: 40, island: "home", revision: 4 },
      revision: 4 }), new Response(null, { status: 204 }));
    const encodedLogs: unknown[] = [];
    const memory = createMemorySaveStore();
    const store = createRemoteSaveStore({ api: mocked.client, leaseId: () => LEASE, now: () => 0, onStatus: () => {},
      local: { ...memory.store, clearSavedGame: async () => {}, slotId: "rec" }, slotId: SLOT,
      encodeCaptured: async captured => { encodedLogs.push(captured.commandLogs); return gzipBody({}); } });
    await store.readSavedGame();
    const interval = { baseRevision: null, endTick: 40, island: "home" } as unknown as CommandLogInterval;
    const draws = [{ entity: 1, sequence: 0, site: "a", state: 2, stream: "military", tick: 39 }] as RandomDraw[];
    await store.writeCapturedGame({ commandLog: interval, commandLogTrail: draws } as CapturedGame);
    await vi.runAllTimersAsync();
    expect(encodedLogs).toEqual([[{ ...interval, baseRevision: 3 }]]);
    expect(mocked.calls.map(call => `${call.method} ${call.url}`).at(-1)).toBe(`PUT /v1/saves/${SLOT}/random-trail`);
    expect(mocked.calls.at(-1)!.body).toEqual({ draws, revision: 4 });
  });

  it("adopts a stock move's revision, keeps local work and restarts the command log at the new base", async () => {
    const offline = new TypeError("Failed to fetch");
    const mocked = mockFetch(stored(), offline, json({ revision: 5 }));
    const memory = createMemorySaveStore(), encodedLogs: unknown[] = [], applied: unknown[] = [];
    let cleared = 0;
    const store = createRemoteSaveStore({ api: mocked.client, leaseId: () => LEASE, now: () => 0, onStatus: () => {},
      local: { ...memory.store, clearSavedGame: async () => { cleared++; }, slotId: "rec" }, slotId: SLOT,
      encodeCaptured: async captured => {
        encodedLogs.push(captured.commandLogs);
        return gzipBody({ write: encodedLogs.length });
      } });
    await store.readSavedGame();
    const first = { baseRevision: null, endTick: 10, island: "home" } as unknown as CommandLogInterval;
    await store.writeCapturedGame({ commandLog: first } as CapturedGame);
    expect(encodedLogs).toEqual([[{ ...first, baseRevision: 3 }]]);
    expect(mocked.calls).toHaveLength(2);
    const move = { direction: "deposit" as const, goods: { logs: 40 }, revision: 4,
      storage: { fish: 5, logs: 60 } };
    expect(await store.adoptStockMove(move, adopted => applied.push(adopted)))
      .toEqual({ applied: true, droppedPending: true, ok: true, revision: 4 });
    expect(applied).toEqual([move]);
    expect(cleared).toBe(0);
    expect(store.revision()).toBe(4);
    // The same committed response is an idempotent retry: no second local delta, no revision move.
    expect(await store.adoptStockMove(move, adopted => applied.push(adopted)))
      .toEqual({ applied: false, droppedPending: false, ok: true, revision: 4 });
    expect(applied).toHaveLength(1);
    expect(await store.adoptStockMove({ ...move, goods: { logs: 1 }, revision: 3 }))
      .toEqual({ ok: false, reason: "stale" });
    expect(await store.adoptStockMove({ ...move, revision: 6 }))
      .toEqual({ ok: false, reason: "stale" });
    expect(store.revision()).toBe(4);
    const second = { baseRevision: null, endTick: 20, island: "home" } as unknown as CommandLogInterval;
    await store.writeCapturedGame({ commandLog: second } as CapturedGame);
    expect(encodedLogs[1]).toEqual([{ ...second, baseRevision: 4,
      gaps: [expect.stringContaining("server moved")] }]);
    expect(mocked.calls.at(-1)).toMatchObject({ body: { write: 2 }, headers: { "If-Match": "\"4\"" } });
    expect(cleared).toBe(1);
  });

  it("does not adopt a stock move before the slot was read", async () => {
    const { store } = remoteStore();
    expect(await store.adoptStockMove({ direction: "deposit", goods: { logs: 1 }, revision: 4, storage: {} }))
      .toEqual({ ok: false, reason: "not-loaded" });
  });

  it("lets the server catch the read slot up at login, and falls back when it cannot", async () => {
    const caughtUp = toSaveSnapshot({ ...completeGame(), savedAt: 99_000 });
    const summary = { awaySeconds: 60, capped: false, endedColonies: [], experience: 0, goods: { logs: 3 } };
    const { calls, store } = remoteStore(stored(), json({ revision: 4, snapshot: caughtUp, summary }),
      json({ code: "CATCH_UP_UNAVAILABLE", message: "Unknown build" }, 503));
    await store.readSavedGame();
    const result = await store.catchUp("abc123");
    expect(result).toEqual({ game: fromSaveSnapshot(caughtUp), summary });
    expect(store.revision()).toBe(4);
    expect(calls[1]).toMatchObject({ body: { sourceVersion: "abc123" }, method: "POST",
      url: `/v1/saves/${SLOT}/catch-up` });
    expect(calls[1]!.headers["If-Match"]).toBe("\"3\"");
    expect(await store.catchUp("abc123")).toBeNull();
    expect(store.revision()).toBe(4);
  });

  it("offline: keeps the copy and retries the newest save with backoff until confirmed", async () => {
    const offline = new TypeError("Failed to fetch");
    const { calls, captured, cleared, statuses, store } = remoteStore(stored(), offline, offline,
      json({ revision: 4 }));
    await store.readSavedGame();
    await store.writeCapturedGame(captured);
    expect(statuses.at(-1)).toEqual({ kind: "offline", retryAt: 2000 });
    await store.writeCapturedGame(captured);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(statuses.at(-1)).toEqual({ kind: "offline", retryAt: 4000 });
    expect(cleared()).toBe(0);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls.filter(call => call.method === "PUT").map(call => call.body))
      .toEqual([{ write: 1 }, { write: 2 }, { write: 2 }]);
    expect(statuses.at(-1)?.kind).toBe("saved");
    expect(cleared()).toBe(1);
    expect(store.revision()).toBe(4);
  });

  it("checks the tab-return authority against the slot revision", async () => {
    const offline = new TypeError("Failed to fetch");
    const slot = { id: SLOT, name: "Slot 1", revision: 3, slot_no: 1 };
    const { store } = remoteStore(stored(), json([slot]), json([{ ...slot, revision: 4 }]), offline);
    await store.readSavedGame();
    expect(await store.checkAuthority()).toBe("current");
    expect(await store.checkAuthority()).toBe("newer");
    expect(await store.checkAuthority()).toBe("unknown");
    expect(store.hasPendingUpload()).toBe(false);
  });

  it("keeps a pending upload classified without adopting a retry", async () => {
    const offline = new TypeError("Failed to fetch");
    const slot = { id: SLOT, name: "Slot 1", revision: 3, slot_no: 1 };
    const { calls, captured, store } = remoteStore(stored(), offline, json([slot]));
    await store.readSavedGame();
    await store.writeCapturedGame(captured);
    expect(store.hasPendingUpload()).toBe(true);
    expect(await store.checkAuthority()).toBe("current");
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      "GET /v1/saves/5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11/snapshot",
      "POST /v1/saves/5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11/interval-token",
      "PUT /v1/saves/5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11/snapshot",
      "GET /v1/saves"
    ]);
    expect(store.hasPendingUpload()).toBe(true);
  });

  it("stops uploading on a conflict until the player overwrites; the local copy keeps every save", async () => {
    const { calls, captured, encoded, statuses, store } = remoteStore(stored(), conflict(),
      json([{ id: SLOT, name: "Slot 1", revision: 9, slot_no: 1 }]), json({ revision: 10 }));
    await store.readSavedGame();
    await expect(store.writeCapturedGame(captured)).rejects.toBeInstanceOf(SaveConflictError);
    expect(statuses.at(-1)).toEqual({ kind: "conflict" });
    await expect(store.writeCapturedGame(captured)).rejects.toBeInstanceOf(SaveConflictError);
    expect(encoded()).toBe(2);
    expect(calls.filter(call => call.method === "PUT")).toHaveLength(1);
    await store.overwrite();
    expect(calls.at(-1)).toMatchObject({ body: { write: 2 }, headers: { "If-Match": "\"9\"" } });
    expect(store.revision()).toBe(10);
  });

  it("stops on a lost lease until the session is taken back; refuses a write before any read", async () => {
    const { captured, statuses, store } = remoteStore(stored(), leaseLost(), json({ revision: 4 }));
    await expect(store.writeCapturedGame(captured)).rejects.toBeInstanceOf(SaveConflictError);
    await store.readSavedGame();
    await expect(store.writeCapturedGame(captured)).rejects.toBeInstanceOf(SessionTakenOverError);
    expect(statuses.at(-1)).toEqual({ kind: "taken-over" });
    store.resume();
    await store.writeCapturedGame(captured);
    expect(store.revision()).toBe(4);
  });

  it("marks a save the server refused as failed and keeps it in this browser", async () => {
    const { captured, cleared, statuses, store } = remoteStore(stored(),
      json({ code: "VALIDATION_FAILED", message: "Invalid save document", requestId: "r3" }, 400));
    await store.readSavedGame();
    await expect(store.writeCapturedGame(captured)).rejects.toBeInstanceOf(SaveApiError);
    expect(statuses.at(-1)).toEqual({ kind: "failed" });
    expect(cleared()).toBe(0);
  });

  it("a run without a home ends with the player row only, confirmed before the page leaves (ONLINE-STORY)",
    async () => {
      const player = createPlayerProgress(3);
      const between = json({ adventures: [], colonies: [], evacuations: [], islands: [], player, revision: 5,
        session: { active: null, savedAt: 0 } });
      const { calls, cleared, store } = remoteStore(stored(), json({ revision: 4 }), between);
      await store.readSavedGame();
      await store.endRunWithoutHome!(player);
      expect(calls.at(-1)!.body).toEqual({ adventures: [], colonies: [], evacuations: [], islands: [], player,
        session: { active: null, savedAt: 0 } });
      expect(cleared()).toBe(1);
      expect(await store.readStoryProgress!()).toEqual(player);
      expect(await store.readSavedGame()).toBeNull();
      expect(await store.readStoryProgress!()).toEqual(player);
    });

  it("keeps the player on the map when the end of a run without a home cannot reach the server", async () => {
    const offline = new TypeError("Failed to fetch");
    const { captured, statuses, store } = remoteStore(stored(), offline, offline, json({ revision: 4 }));
    await store.readSavedGame();
    await store.writeCapturedGame(captured);
    expect(store.hasPendingUpload()).toBe(true);
    await expect(store.endRunWithoutHome!(createPlayerProgress(3))).rejects.toThrow(RUN_END_NOT_SAVED);
    expect(store.hasPendingUpload()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses.at(-1)?.kind).toBe("offline");
    await store.writeCapturedGame(captured);
    expect(store.revision()).toBe(4);
  });

  it("keeps the startup payload and replay report in this browser", async () => {
    const { calls, memory, store } = remoteStore();
    await store.writeStartupGame("startup");
    await store.writeReplayReport("report");
    expect(await store.readStartupGame()).toBe("startup");
    expect(await store.readReplayReport()).toBe("report");
    await store.clearStartupGame();
    expect([...memory.values.keys()]).toEqual(["replay"]);
    expect(calls).toHaveLength(0);
  });
});
