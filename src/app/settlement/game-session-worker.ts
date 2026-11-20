import type { SlotMeta } from "../../../../island-of-settlers-shared/src/offline-slots";
import type { createGameSave, GameSaveV1, LoadedGameSave } from "../../shared/settlement/game-save";
import type { ExpeditionTheme } from "../../shared/settlement/island-discovery-policy";
import {
  appendSaveStageSamples, profileSaveStage, profileSaveStageAsync, saveStageProfilingEnabled,
  type SaveStageSample
} from "../../shared/settlement/save-stage-profile";
import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import { invalidateAllWorldMirrors } from "../../shared/world/save/world-change-journal";
import {
  captureWorldPatch, forgetWorldPatches, MIRROR_OUT_OF_SYNC, type WorldPatch
} from "../../shared/world/save/world-patch";
import type { WorldData } from "../../shared/world/world-data";
import type { SlotCopyRequest } from "../save-slots/slot-copy";
import type { SlotDumpUpload } from "../save-slots/slot-dump";
import type { SlotMetaInput } from "../save-slots/slot-meta";
import type { CapturedGame, PersistTarget } from "../save-store/captured-game";
import { markCapturedSettlementCopied } from "../save-store/captured-ownership";
import type { SnapshotUpload } from "../save-store/snapshot-body";
import type { OfflineEconomyMetrics } from "./offline-economy";
import type { OfflineIslandMetrics } from "./offline-island-replay";
import type { OfflineProgress, OfflineReplayFlags } from "./offline-progress";

/** The full catch-up run of an instrumented request, as the worker posts it back. */
export interface OfflineWorkerRun {
  economy?: OfflineEconomyMetrics[];
  metrics: OfflineIslandMetrics[];
  save: GameSaveV1;
  wallMs: number;
  workerWallMs: number;
}

export type GameSessionRequest =
  | { id: number; kind: "theme"; value: GameSaveV1; theme: ExpeditionTheme }
  | {
    id: number; kind: "offline"; value: GameSaveV1; now: number; options?: OfflineReplayFlags;
    /** Collect per-island metrics and answer an `OfflineWorkerRun` instead of the save. */
    metrics?: boolean;
  }
  | { id: number; kind: "load"; value: unknown }
  | { id: number; kind: "save"; arguments: Parameters<typeof createGameSave> }
  | { id: number; kind: "persist"; captured: CapturedGame; target: PersistTarget;
    /** Ask the worker to return its own stage samples (main-thread profiling is opt-in). */
    profile?: boolean }
  /** The cloud slot's last body again with these islands complete (the server did not hold them). */
  | { id: number; kind: "complete"; keys: string[]; recoverySlotId: string }
  /** A Save/Load slot copy (SAVE-SLOTS): one IndexedDB transaction, away from the frame. */
  | { id: number; kind: "copySlot"; request: SlotCopyRequest }
  /** OFFLINE-CLOUD: a slot's server dump body (gzip JSON) and meta. */
  | { id: number; kind: "exportSlot"; meta: SlotMetaInput; slotId: string }
  /** OFFLINE-CLOUD: replaces a slot with a downloaded dump (its decompressed JSON bytes). */
  | { id: number; json: ArrayBuffer; kind: "importSlot"; slotId: string };
type SessionValue = LoadedGameSave | GameSaveV1 | SnapshotUpload | OfflineWorkerRun | SlotDumpUpload | SlotMeta |
  null;
export type GameSessionResponse = { id: number; value: SessionValue; stages?: SaveStageSample[] } |
  { id: number; error: string; stages?: SaveStageSample[] } | { id: number; progress: OfflineProgress };
const progressListeners = new Map<number, (progress: OfflineProgress) => void>();
let worker: Worker | undefined, nextId = 0, offlineRequestId: number | undefined;
const pending = new Map<number, { resolve(value: SessionValue): void; reject(error: Error): void }>();

/** The player chose D15's safe discard: the running replay's result must never be committed. */
class OfflineCatchUpCancelled extends Error {
  constructor() {
    super("Offline catch-up was discarded");
    this.name = "OfflineCatchUpCancelled";
  }
}

const request = (message: GameSessionRequest, transfer: Transferable[] = []) =>
  new Promise<SessionValue>((resolve, reject) => {
  if (!worker) {
    worker = new Worker(new URL("../../workers/game-session-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<GameSessionResponse>) => {
      const result = event.data, task = pending.get(result.id);
      if (!task) return;
      if ("progress" in result) { progressListeners.get(result.id)?.(result.progress); return; }
      if (result.stages?.length) appendSaveStageSamples(result.stages);
      progressListeners.delete(result.id);
      pending.delete(result.id);
      if ("error" in result) task.reject(new Error(result.error)); else task.resolve(result.value);
    };
    worker.onerror = () => {
      for (const task of pending.values()) task.reject(new Error("Saved game processing failed"));
      pending.clear(); progressListeners.clear(); worker?.terminate(); worker = undefined;
      invalidateAllWorldMirrors();
    };
  }
  pending.set(message.id, { resolve, reject });
  try { worker.postMessage(message, transfer); }
  catch (error) { pending.delete(message.id); reject(error instanceof Error ? error : new Error(String(error))); }
});

/** Decode, check and rebuild large map layers away from animation and input. */
export const stageGameSessionInWorker = async (value: unknown): Promise<LoadedGameSave> => {
  if (typeof Worker === "undefined") {
    const { stageGameSession } = await import("./game-session");
    return stageGameSession(typeof value === "string" ? JSON.parse(value) : value);
  }
  return await request({ id: nextId++, kind: "load", value }) as LoadedGameSave;
};

/** postMessage copies the live world immediately; its buffers remain attached and usable. */
export const createGameSaveInWorker = async (...args: Parameters<typeof createGameSave>): Promise<GameSaveV1> => {
  if (typeof Worker === "undefined") {
    // Match postMessage's synchronous snapshot even when module loading yields to live gameplay.
    const snapshot = structuredClone(args);
    const { createGameSave } = await import("../../shared/settlement/game-save"); return createGameSave(...snapshot);
  }
  return await request({ id: nextId++, kind: "save", arguments: args }) as GameSaveV1;
};

/**
 * Stops the running catch-up (D15). Terminating the shared worker is safe here: startup has no other
 * task in flight, and a replay that is already past its last yield cannot be interrupted otherwise.
 * The caller still commits only the explicit discard-to-save state.
 */
export const cancelOfflineCatchUp = () => {
  const id = offlineRequestId;
  if (id === undefined) return false;
  offlineRequestId = undefined;
  const task = pending.get(id);
  pending.delete(id);
  progressListeners.delete(id);
  worker?.terminate();
  worker = undefined;
  invalidateAllWorldMirrors();
  for (const [pendingId, pendingTask] of pending) {
    pending.delete(pendingId);
    progressListeners.delete(pendingId);
    pendingTask.reject(new Error("The game session worker was stopped"));
  }
  task?.reject(new OfflineCatchUpCancelled());
  return true;
};

/**
 * Runs one catch-up on the shared worker. An instrumented run also collects the per-island metrics
 * the browser acceptance harness reports; the game's normal path asks only for the save.
 */
const runOfflineGame = async (
  value: GameSaveV1, now: number, progress: (progress: OfflineProgress) => void,
  options: OfflineReplayFlags, metrics: boolean
): Promise<OfflineWorkerRun> => {
  const started = performance.now();
  if (typeof Worker === "undefined") {
    const { advanceOfflineGame } = await import("./offline-progress");
    const collected: OfflineIslandMetrics[] = [];
    const economy: OfflineEconomyMetrics[] = [];
    const save = await advanceOfflineGame(value, now, progress, metrics
      ? { ...options, onIslandMetrics: entry => collected.push(entry), onEconomyMetrics: entry => economy.push(entry) } : options);
    const wallMs = performance.now() - started;
    return { economy, metrics: collected, save, wallMs, workerWallMs: wallMs };
  }
  const id = nextId++;
  offlineRequestId = id;
  progressListeners.set(id, progress);
  try {
    const result = await request({ id, kind: "offline", metrics, now, options, value });
    const wallMs = performance.now() - started;
    return metrics
      ? { ...(result as OfflineWorkerRun), wallMs }
      : { metrics: [], save: result as GameSaveV1, wallMs, workerWallMs: wallMs };
  }
  finally {
    if (offlineRequestId === id) offlineRequestId = undefined;
    progressListeners.delete(id);
  }
};

/** Economy replay uses the same worker as save decoding; progress messages never block input. */
export const advanceOfflineGameInWorker = async (
  value: GameSaveV1, now: number, progress: (progress: OfflineProgress) => void,
  options: OfflineReplayFlags = {}
): Promise<GameSaveV1> => (await runOfflineGame(value, now, progress, options, false)).save;

/**
 * The instrumented catch-up used by the acceptance harness: same worker and same
 * `advanceOfflineGame`, plus per-island wall/fixed-tick/fallback metrics. Instrumentation only; no
 * game path calls it.
 */
export const advanceOfflineGameInWorkerMeasured = (
  value: GameSaveV1, now: number, progress: (progress: OfflineProgress) => void,
  options: OfflineReplayFlags = {}
): Promise<OfflineWorkerRun> => runOfflineGame(value, now, progress, options, true);

export const rethemeExpeditionInWorker = async (value: GameSaveV1, theme: ExpeditionTheme): Promise<GameSaveV1> => {
  if (typeof Worker === "undefined") {
    const { rethemeExpedition } = await import("./expedition-retheme"); return rethemeExpedition(value, theme);
  }
  return await request({ id: nextId++, kind: "theme", value, theme }) as GameSaveV1;
};

/** Debug A/B switch: `window.__saveJournal = false` sends the whole live world again (structured clone). */
const journalEnabled = () => (globalThis as { __saveJournal?: boolean }).__saveJournal !== false;

/** The live world is replaced by its journal patch on the wire; the worker supplies its mirror world. */
const NO_WORLD_ON_WIRE = null as unknown as WorldData;
/** A settlement that travels as `settlementText` is parsed once in the worker, not cloned here. */
const NO_SETTLEMENT_ON_WIRE = null as unknown as SettlementSaveV1;

interface WireCapture { captured: CapturedGame; transfer: ArrayBuffer[]; world: WorldData }

/**
 * The capture with a journal patch instead of the live world (S06), or null when the world cannot be
 * mirrored (the editor's terrain stamps are stored as XOR layers against the live ground).
 */
const toWireCapture = (captured: CapturedGame): WireCapture | null => {
  const [world, settlement, input, runtime] = captured.save;
  if (!journalEnabled() || input.terrain?.stamps?.length) return null;
  const snapshot = captureWorldPatch(world, { forceKeyframe: worker === undefined });
  if (!snapshot) return null;
  const wireSettlement = captured.settlementText ? NO_SETTLEMENT_ON_WIRE : settlement;
  const wire: CapturedGame = { ...captured, save: [NO_WORLD_ON_WIRE, wireSettlement, input, runtime],
    worldPatch: snapshot.patch satisfies WorldPatch };
  return { captured: wire, transfer: snapshot.transfer, world };
};

const forgetFailedPatch = (world: WorldData, error: unknown) => {
  forgetWorldPatches(world);
  if (error instanceof Error && error.message === MIRROR_OUT_OF_SYNC) invalidateAllWorldMirrors();
};

/**
 * Builds, serializes and writes a captured game away from the frame (save hitch): the local slot's rows, or the
 * recovery copy plus the gzip snapshot body for the cloud. Without workers (tests) it runs here. The main
 * thread copies only the changed world chunks (journal patch) and transfers them; it never clones the world.
 */
export const persistCapturedGameInWorker = async (captured: CapturedGame, target: PersistTarget) => {
  if (typeof Worker === "undefined") {
    return profileSaveStageAsync("save.worker.persist.main", async () => {
      const [{ persistCapturedGame }, { openGameDatabase }] = await Promise.all([
        import("../save-store/captured-game"), import("./game-database")]);
      return persistCapturedGame(structuredClone(captured), target, await openGameDatabase());
    });
  }
  const profile = saveStageProfilingEnabled();
  const wire = profileSaveStage("save.capture.worldPatch", () => toWireCapture(captured));
  // `postMessage` clones the captured graph synchronously; timing it separately from the worker
  // round trip shows the caller-side copy cost that the worker stage receipt cannot see.
  let pending: Promise<SessionValue>;
  try {
    pending = profileSaveStage("save.worker.postMessage", () => request(
      { captured: wire?.captured ?? captured, id: nextId++, kind: "persist", profile, target }, wire?.transfer));
  } catch (error) {
    if (wire) forgetFailedPatch(wire.world, error);
    throw error;
  }
  // The worker owns a full independent copy from this point, so the in-place reload may transfer
  // the page-side settlement snapshot instead of cloning it once more.
  markCapturedSettlementCopied(captured.save[1]);
  return profileSaveStageAsync("save.worker.persist.roundTrip", async () => {
    try { return await pending as SnapshotUpload | null; }
    catch (error) {
      if (wire) forgetFailedPatch(wire.world, error);
      throw error;
    }
  });
};

/** The cloud slot's last upload body again with `keys` sent complete (answer to an unknown-island refusal). */
export const completeSnapshotBodyInWorker = async (recoverySlotId: string, keys: string[]): Promise<SnapshotUpload> => {
  if (typeof Worker === "undefined") {
    const { completeSnapshotBody } = await import("../save-store/captured-game");
    return completeSnapshotBody(recoverySlotId, keys);
  }
  return await request({ id: nextId++, keys, kind: "complete", recoverySlotId }) as SnapshotUpload;
};

/**
 * Copies one browser slot onto another at table level (SAVE-SLOTS, plan §5.6) in the game-session worker, so the
 * structured clone of large rows never lands on the frame. Without workers (tests) it runs here.
 */
export const copyGameSlotInWorker = async (copy: SlotCopyRequest): Promise<void> => {
  if (typeof Worker === "undefined") {
    const [{ copyGameSlot }, { openGameDatabase }] = await Promise.all([
      import("../save-slots/slot-copy"), import("./game-database")]);
    await copyGameSlot(await openGameDatabase(), copy);
    return;
  }
  await request({ id: nextId++, kind: "copySlot", request: copy });
};

/** Reads a slot and builds its server dump (OFFLINE-CLOUD) in the game-session worker; here without workers. */
export const buildSlotDumpInWorker = async (slotId: string, meta: SlotMetaInput): Promise<SlotDumpUpload> => {
  if (typeof Worker === "undefined") {
    const [{ buildSlotDumpUpload }, { openGameDatabase }] = await Promise.all([
      import("../save-slots/slot-dump"), import("./game-database")]);
    return buildSlotDumpUpload(await openGameDatabase(), slotId, meta);
  }
  return await request({ id: nextId++, kind: "exportSlot", meta, slotId }) as SlotDumpUpload;
};

/** Replaces a slot with a downloaded dump in the game-session worker (the bytes move, never copied). */
export const importSlotDumpInWorker = async (slotId: string, json: ArrayBuffer): Promise<SlotMeta> => {
  if (typeof Worker === "undefined") {
    const [{ importSlotDump }, { openGameDatabase }] = await Promise.all([
      import("../save-slots/slot-dump"), import("./game-database")]);
    return importSlotDump(await openGameDatabase(), slotId, json);
  }
  return await request({ id: nextId++, json, kind: "importSlot", slotId }, [json]) as SlotMeta;
};
