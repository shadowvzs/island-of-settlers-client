import type { PlayerProgress } from "../../shared/progression/player-progress";
import { type ArchivedIslandProof,archivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { profileSaveStage, profileSaveStageAsync } from "../../shared/settlement/save-stage-profile";
import type { StockMoveAdoption } from "../../shared/trade/stock-move";
import { completeSnapshotBodyInWorker, persistCapturedGameInWorker } from "../settlement/game-session-worker";
import { type CapturedGame, encodeSnapshotBody } from "./captured-game";
import { createCommandLogChain } from "./command-log-chain";
import { type ArchivedProofApi,createRemoteArchivedRelief, replaceFiledIslandProof } from "./remote-archived-relief";
import {
  type IslandDocument, isTransientFailure, type KnownStoredSnapshot, type RandomTrailRequest, type SaveApiClient,
  type StoredSnapshot
} from "./save-api-client";
import type { SaveTimers } from "./save-coordinator";
import { fromSaveSnapshot } from "./save-snapshot";
import type { SaveStore } from "./save-store";
import { encodeStoryProgressBody, type SnapshotUpload } from "./snapshot-body";
import { storyProgressOf } from "./story-progress";

/** The end of a run without a home did not reach the server: the player stays on the map (ONLINE-STORY). */
export const RUN_END_NOT_SAVED = "The end of this map could not be saved on the server. Try again.";

/** The cloud slot changed since this client read it (another tab or device saved). */
export class SaveConflictError extends Error {
  constructor() {
    super("This save changed on another device. Load the newer one or keep playing here and overwrite it.");
    this.name = "SaveConflictError";
  }
}

/** Another device took this account's live session over; this one stops saving to the cloud. */
export class SessionTakenOverError extends Error {
  constructor() {
    super("This account is now playing on another device.");
    this.name = "SessionTakenOverError";
  }
}

/** What the cloud save is doing, for the small status indicator and the dialogs. */
export type CloudSaveStatus =
  | { kind: "conflict" }
  /** The server refused the save itself (not a revision or session matter): it stays in this browser. */
  | { kind: "failed" }
  | { kind: "offline"; retryAt: number }
  | { at: number; kind: "saved" }
  | { kind: "saving" }
  | { kind: "taken-over" };

/** The browser side of one cloud slot: startup payload, replay report and the unconfirmed-upload copy. */
export interface RecoveryStore extends SaveStore {
  /** Drops the recovery copy once the server confirmed the save it holds. */
  clearSavedGame(): Promise<void>;
  readonly slotId: string;
}

/** The game applies a committed stock move's local delta (never as a replay command; the base snapshot has it). */
export type StockMoveApply = (move: StockMoveAdoption) => void;

export type StockMoveAdoptResult =
  | { applied: boolean; droppedPending: boolean; ok: true; revision: number }
  | { ok: false; reason: "not-loaded" | "stale" };

const STOCK_MOVE_GAP = "The server moved island goods; the local interval before the new base is not replayable";

export interface RemoteSaveStoreOptions {
  api: Pick<SaveApiClient, "catchUp" | "issueIntervalToken" | "listSlots" | "readSnapshot" | "sendRandomTrail" | "writeSnapshot"> &
    Partial<Pick<SaveApiClient, "readKnownSnapshot">> & ArchivedProofApi;
  /**
   * The same body again with these islands complete: the server did not hold the islands the body referred to
   * as unchanged (game-session worker).
   */
  completeBody?: (recoverySlotId: string, keys: string[]) => Promise<SnapshotUpload>;
  /**
   * Builds the snapshot body off the frame and writes the recovery copy first (game-session worker). Islands whose
   * content signature is in `serverSignatures` are sent as references. A bare body (no signatures) is accepted.
   */
  encodeCaptured?: (captured: CapturedGame, recoverySlotId: string, confirmedMapBases?: string[],
    serverSignatures?: Record<string, string>) => Promise<ArrayBuffer | SnapshotUpload>;
  /** The live session lease every write names. */
  leaseId: () => string | undefined;
  local: RecoveryStore;
  now?: () => number;
  /** A retried upload was refused (conflict or take-over) while no save was waiting for it. */
  onRefused?: (error: SaveConflictError | SessionTakenOverError) => void;
  onStatus: (status: CloudSaveStatus) => void;
  slotId: string;
  timers?: SaveTimers;
}

const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 60_000;
const DEFAULT_TIMERS: SaveTimers = { clear: handle => clearTimeout(handle), set: (run, ms) => setTimeout(run, ms) };
const encodeInWorker = async (captured: CapturedGame, recoverySlotId: string, confirmedMapBases?: string[],
  serverSignatures?: Record<string, string>) =>
  (await persistCapturedGameInWorker(captured, { kind: "snapshot", recoverySlotId, confirmedMapBases,
    serverSignatures }))!;

const asUpload = (encoded: ArrayBuffer | SnapshotUpload): SnapshotUpload =>
  encoded instanceof ArrayBuffer ? { body: encoded, signatures: {} } : encoded;

/** The islands of a read, with the references the server answered filled from `known` (the documents held). */
const resolveReferences = (snapshot: KnownStoredSnapshot, known: ReadonlyMap<string, IslandDocument>) => {
  const islands: StoredSnapshot["islands"] = [];
  for (const island of snapshot.islands) {
    if (!("unchanged" in island)) { islands.push(island); continue; }
    const save = known.get(island.key);
    if (!save) return null;
    islands.push({ key: island.key, save });
  }
  return { ...snapshot, islands } satisfies StoredSnapshot;
};

/**
 * An account's game in a cloud save slot. Every save first lands in the browser (the recovery copy), then
 * uploads as a gzip snapshot against the revision last read or written, naming the session lease:
 * - confirmed: the revision advances and the recovery copy goes;
 * - offline / 5xx / 429 / expired token: the copy stays and the newest body retries with backoff (2 s .. 60 s);
 * - 409 conflict or a lost lease: uploads stop (SaveConflictError / SessionTakenOverError) until resolved.
 */
export const createRemoteSaveStore = (options: RemoteSaveStoreOptions) => {
  const { api, local, slotId } = options, timers = options.timers ?? DEFAULT_TIMERS, now = options.now ?? Date.now;
  const encodeCaptured = options.encodeCaptured ?? encodeInWorker;
  const completeBody = options.completeBody ?? completeSnapshotBodyInWorker;
  let revision: number | null = null, pending: ArrayBuffer | null = null, pendingNeedsToken = false;
  let confirmedBody: ArrayBuffer | null = null;
  const archivedRelief = createRemoteArchivedRelief(api, slotId);
  const pendingArchivedProofs = new Map<string, { save: GameSaveV1; proof: ArchivedIslandProof; revision: number }>();
  let refusal: SaveConflictError | SessionTakenOverError | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, retryDelay = FIRST_RETRY_MS;
  let uploading: Promise<void> | null = null;
  const commandLogs = createCommandLogChain();
  const confirmedMapBases = new Set<string>();
  /**
   * Content signatures of the islands the server stores (its last read or upload answer): an island with the same
   * signature locally is uploaded as a reference. A stale entry only costs one refused upload (never wrong data).
   */
  let serverSignatures: Record<string, string> = {};
  const bodySignatures = new WeakMap<ArrayBuffer, Record<string, string>>();
  /** Island documents of the last read, kept until the first save so a second read may skip unchanged islands. */
  let readIslands: Map<string, IslandDocument> | null = null;
  /** The player progress of the last read or story write: a slot without a home keeps it between runs. */
  let storyProgress: PlayerProgress | null = null;

  const scheduleRetry = () => {
    const delay = retryDelay;
    retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
    options.onStatus({ kind: "offline", retryAt: now() + delay });
    retryTimer = timers.set(() => {
      retryTimer = undefined;
      void upload().catch(error => options.onRefused?.(error as SaveConflictError | SessionTakenOverError));
    }, delay);
  };
  const confirm = async (body: ArrayBuffer, next: number) => {
    revision = next;
    confirmedBody = body;
    commandLogs.confirmed(body, next);
    retryDelay = FIRST_RETRY_MS;
    if (pending === body) {
      pending = null;
      pendingNeedsToken = false;
      await profileSaveStageAsync("save.cloud.clearRecovery", () => local.clearSavedGame());
    }
    options.onStatus({ at: now(), kind: "saved" });
  };
  const refuse = (reason: "conflict" | "lease-lost") => {
    refusal = reason === "conflict" ? new SaveConflictError() : new SessionTakenOverError();
    options.onStatus({ kind: reason === "conflict" ? "conflict" : "taken-over" });
    throw refusal;
  };
  /** Desync debugging only: a lost or refused trail never affects saving. */
  const sendTrail = ({ endTick, island, revision: diverged }: RandomTrailRequest) => {
    const trail = commandLogs.trail(island, endTick);
    if (trail) void api.sendRandomTrail(slotId, diverged, trail).catch(() => undefined);
  };
  /**
   * The server does not hold islands the body referred to as unchanged: the same body goes again with them complete.
   * A newer body that replaced this one is sent next instead (its own references are checked the same way).
   */
  const resendComplete = async (body: ArrayBuffer, keys: string[]) => {
    if (pending !== body) return;
    for (const key of keys) delete serverSignatures[key];
    const upload = await completeBody(local.slotId, keys);
    commandLogs.replaced(body, upload.body);
    bodySignatures.set(upload.body, upload.signatures);
    pending = upload.body;
    await sendPending();
  };
  /** Sends the newest pending body once (single flight); transient failures schedule a retry. */
  const sendPending = async () => {
    const body = pending;
    if (!body) return;
    const currentRevision = revision;
    if (currentRevision === null) throw new SaveConflictError();
    options.onStatus({ kind: "saving" });
    try {
      // A no-command save needs a fresh one-use token; retries fetch a new one because tokens expire.
      const intervalToken = pendingNeedsToken
        ? (await api.issueIntervalToken(slotId, currentRevision, options.leaseId())).token
        : undefined;
      const result = await profileSaveStageAsync("save.cloud.upload", () =>
        api.writeSnapshot(slotId, currentRevision, body, options.leaseId(), intervalToken));
      if (!result.ok && result.reason === "islands-required") await resendComplete(body, result.keys);
      else if (!result.ok) refuse(result.reason);
      else {
        for (const hash of result.mapBases ?? []) confirmedMapBases.add(hash);
        serverSignatures = result.islandSignatures ?? bodySignatures.get(body) ?? {};
        await confirm(body, result.revision);
        if (result.randomTrailRequest) sendTrail(result.randomTrailRequest);
      }
    } catch (error) {
      if (error instanceof SaveConflictError || error instanceof SessionTakenOverError) throw error;
      if (!isTransientFailure(error)) {
        options.onStatus({ kind: "failed" });
        throw error;
      }
      scheduleRetry();
    }
  };
  const upload = async () => {
    while (uploading) await uploading.catch(() => undefined);
    const current = sendPending().finally(() => { uploading = null; });
    uploading = current;
    return current;
  };
  /** A new body replaces any unsent one; while offline the retry timer sends it. */
  const submit = async (body: ArrayBuffer, needsToken = false) => {
    pending = body;
    pendingNeedsToken = needsToken;
    if (refusal) throw refusal;
    if (retryTimer !== undefined) return;
    await upload();
  };
  /**
   * The slot's snapshot. A second read before the first save names the islands already held (with their
   * signatures), and the server answers those as references instead of sending them again.
   */
  const readSnapshot = async (): Promise<StoredSnapshot> => {
    const held = readIslands, known = Object.fromEntries(
      Object.entries(serverSignatures).filter(([key]) => held?.has(key)));
    const answer = held && api.readKnownSnapshot && Object.keys(known).length
      ? await profileSaveStageAsync("save.cloud.read", () => api.readKnownSnapshot!(slotId, known))
      : undefined;
    // A reference without the island it names cannot come from a consistent server: read everything instead.
    const snapshot = (answer && resolveReferences(answer, held!)) ||
      await profileSaveStageAsync("save.cloud.read", () => api.readSnapshot(slotId));
    serverSignatures = snapshot.islandSignatures ?? {};
    readIslands = new Map(snapshot.islands.map(island => [island.key, island.save]));
    storyProgress = storyProgressOf(snapshot.player);
    return snapshot;
  };
  /** Forgets an unconfirmed body: the next capture uploads the game on screen again. */
  const dropPending = () => {
    if (retryTimer !== undefined) timers.clear(retryTimer);
    retryTimer = undefined;
    pending = null;
    pendingNeedsToken = false;
  };
  /**
   * A run without a home ended (ONLINE-STORY): the slot keeps only the player's progress. The upload must be
   * confirmed before the page leaves the map; otherwise it is dropped and the run stays the slot's game.
   */
  const endRunWithoutHome = async (player: PlayerProgress) => {
    if (refusal) throw refusal;
    const body = await encodeStoryProgressBody(player, now());
    // A scheduled offline retry would only send the run again: this body is tried at once instead.
    dropPending();
    readIslands = null;
    pending = body;
    pendingNeedsToken = true;
    try {
      await upload();
    } finally {
      if (pending !== null) dropPending();
    }
    if (confirmedBody !== body) throw new Error(RUN_END_NOT_SAVED);
    storyProgress = player;
  };
  const store: SaveStore = {
    location: "account",
    endRunWithoutHome,
    clearStartupGame: () => local.clearStartupGame(),
    readReplayReport: () => local.readReplayReport(),
    readSavedGame: async () => {
      const snapshot = await readSnapshot();
      for (const hash of snapshot.mapBaseHashes ?? []) confirmedMapBases.add(hash);
      revision = snapshot.revision;
      commandLogs.restart(snapshot.revision);
      const game = profileSaveStage("save.cloud.expand", () => fromSaveSnapshot(snapshot));
      pendingArchivedProofs.clear();
      if (game?.archipelago) {
        const filed = [game.archipelago.home, ...game.archipelago.colonies.map(colony => colony.save),
          ...game.archipelago.reliefReceipts?.map(receipt => receipt.save) ?? []];
        for (const island of filed) {
          if (!island) continue;
          const proof = archivedIslandProof(island);
          if (proof) pendingArchivedProofs.set(proof.island, { save: game, proof, revision: snapshot.revision });
        }
      }
      return game;
    },
    readStartupGame: () => local.readStartupGame(),
    readStoryProgress: async () => storyProgress,
    writeCapturedGame: async captured => {
      const { commandLog, commandLogTrail, ...game } = captured;
      const { intervals, last } = commandLogs.add(commandLog ?? null, commandLogTrail);
      readIslands = null;
      const { body, signatures } = asUpload(await encodeCaptured({ ...game, commandLogs: intervals }, local.slotId,
        [...confirmedMapBases], { ...serverSignatures }));
      bodySignatures.set(body, signatures);
      commandLogs.sent(body, last);
      await submit(body, intervals.length === 0);
      if (confirmedBody === body && pending === null && revision !== null)
        for (const receipt of captured.archipelago?.reliefReceipts ?? []) {
          const proof = archivedIslandProof(receipt.save);
          if (proof) pendingArchivedProofs.set(proof.island, { save: receipt.save, proof, revision });
        }
    },
    writeReplayReport: json => local.writeReplayReport(json),
    writeSavedGame: async (save: GameSaveV1) => {
      readIslands = null;
      commandLogs.restart(null);
      await local.writeSavedGame(save);
      await submit(await encodeSnapshotBody(save), true);
    },
    writeArchivedIslandGame: async (save, proof) => {
      readIslands = null;
      const bound = await archivedRelief.bind(proof, revision ?? undefined);
      const retained = replaceFiledIslandProof(save, bound);
      await local.writeSavedGame(retained);
      const body = await encodeSnapshotBody(retained);
      await submit(body, true);
      if (confirmedBody !== body || pending !== null || revision === null) return retained;
      const canonical = await archivedRelief.acknowledge(retained, bound, revision);
      if (canonical !== retained) {
        pendingArchivedProofs.delete(bound.island);
        await local.writeSavedGame(canonical);
      } else pendingArchivedProofs.set(bound.island, { save: retained, proof: bound, revision });
      return canonical;
    },
    writeStartupGame: json => local.writeStartupGame(json)
  };
  const adoptServerRevision = async (nextRevision:number,apply:(()=>void)|undefined,gapReason:string):Promise<StockMoveAdoptResult> => {
      if (revision === null) return { ok: false, reason: "not-loaded" };
      // A stock move that won serialized before any upload still in flight; let that upload settle first.
      for (let inFlight = uploading; inFlight; inFlight = uploading) await inFlight.catch(() => undefined);
      const current = revision;
      if (current === null) return { ok: false, reason: "not-loaded" };
      if (nextRevision <= current) return nextRevision === current
        ? { applied: false, droppedPending: false, ok: true, revision: current }
        : { ok: false, reason: "stale" };
      if (nextRevision !== current + 1) return { ok: false, reason: "stale" };
      if (retryTimer !== undefined) {
        timers.clear(retryTimer);
        retryTimer = undefined;
      }
      const droppedPending = pending !== null;
      pending = null;
      pendingNeedsToken = false;
      revision = nextRevision;
      refusal = null;
      retryDelay = FIRST_RETRY_MS;
      commandLogs.rebase(nextRevision, droppedPending ? gapReason : undefined);
      apply?.();
      return { applied: true, droppedPending, ok: true, revision: nextRevision };
  };
  return {
    ...store,
    /** Keep playing here: adopt the slot's current revision and upload this device's newest save over it. */
    overwrite: async () => {
      const slot = (await api.listSlots()).find(entry => entry.id === slotId);
      if (!slot) throw new Error("The save slot no longer exists.");
      revision = slot.revision;
      refusal = null;
      readIslands = null;
      await upload();
    },
    /**
     * The tab-return authority gate: settle accepted uploads, then read the slot's revision. A scheduled
     * offline retry keeps the local copy and does not block the check; a refused or unreadable slot is
     * `unknown`, and a slot that moved past this client's revision is a newer authoritative snapshot.
     */
    checkAuthority: async (): Promise<"current" | "newer" | "unknown"> => {
      for (let inFlight = uploading; inFlight; inFlight = uploading) await inFlight.catch(() => undefined);
      if (revision === null || refusal) return "unknown";
      try {
        const slot = (await api.listSlots()).find(entry => entry.id === slotId);
        if (!slot) return "unknown";
        return slot.revision === revision ? "current" : "newer";
      } catch { return "unknown"; }
    },
    hasPendingUpload: () => pending !== null,
    /**
     * The server's offline catch-up of the slot read last (D4.4): the advanced game and what changed, or null when
     * the server cannot (an unknown build, offline): the client then catches up itself as before.
     */
    catchUp: async (sourceVersion: string) => {
      if (revision === null) return null;
      const result = await api.catchUp(slotId, revision, sourceVersion, options.leaseId()).catch(() => null);
      if (!result?.ok) return null;
      revision = result.revision;
      commandLogs.restart(result.revision);
      return { game: result.snapshot ? fromSaveSnapshot(result.snapshot) : null, summary: result.summary };
    },
    /**
     * Adopts a stock move the server committed (docs/server/trade-island-protocol.md): the returned revision is
     * the new save base and the command-log chain restarts there, because the server changed the snapshot outside
     * the client's interval. A local unsent body is already based on the old revision; it is dropped rather than
     * uploaded over the server's storage change. Its recovery copy stays, so local work is not lost, and the next
     * capture starts at the new base (marked not replayable when the dropped interval covered local commands).
     * A response that does not advance the revision is an idempotent retry: nothing is applied twice.
     */
    adoptStockMove: async (move:StockMoveAdoption, apply?:StockMoveApply):Promise<StockMoveAdoptResult> =>
      adoptServerRevision(move.revision,()=>apply?.(move),STOCK_MOVE_GAP),
    /** The server committed a verified personal-item effect; the local state becomes that new baseline. */
    adoptServerMutation: (nextRevision:number,apply:()=>void) => adoptServerRevision(nextRevision,apply,
      "The server applied a personal item; the previous local interval cannot be replayed from the new base"),
    /** The game started from a copy the server never confirmed: its command logs have no verified base. */
    startUnverified: () => commandLogs.restart(null),
    /** The session lease was taken back: uploads may resume. */
    resume: () => { refusal = null; },
    revision: () => revision,
    stop: () => {
      if (retryTimer !== undefined) timers.clear(retryTimer);
      retryTimer = undefined;
    },
    /** Waits for an accepted upload to settle; a scheduled offline retry is not started or awaited. */
    whenIdle: async () => {
      for (let inFlight = uploading; inFlight; inFlight = uploading) await inFlight.catch(() => undefined);
      for (const [island, pending] of pendingArchivedProofs) {
        if (await archivedRelief.verify(pending.proof, pending.revision)) pendingArchivedProofs.delete(island);
      }
    }
  };
};
