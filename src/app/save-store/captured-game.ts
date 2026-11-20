import {
  bytesToBase64, type LiveMap, type MapBases
} from '../../../../island-of-settlers-shared/src/save-map-delta';
import type { CampaignRunKey, CampaignRunState } from "../../shared/campaign/campaign-run";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { Archipelago } from "../../shared/settlement/archipelago";
import type { CommandLogInterval } from "../../shared/settlement/command-log";
import { assembleGameSave, createGameSave, type GameSaveV1 } from "../../shared/settlement/game-save";
import { activeSaveKey, type IslandKey } from "../../shared/settlement/game-save-rows";
import { profileSaveStage, profileSaveStageAsync } from "../../shared/settlement/save-stage-profile";
import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import type { RandomDraw } from "../../shared/settlement/simulation-random";
import { compressMapParts, writeMapParts } from "../../shared/world/save/map-writer";
import { applyWorldPatch, type WorldPatch } from "../../shared/world/save/world-patch";
import type { GameDatabase } from "../settlement/game-database";
import {
  createSnapshotBodyBuilder, type SnapshotBodyBuilder, type SnapshotUpload
} from "./snapshot-body";

/**
 * Everything one save needs, gathered synchronously at a simulation tick boundary on the main thread: the
 * `createGameSave` inputs (world, settlement state, map input, runtime), the filed islands and the player.
 * Turning it into a save document, serializing and writing happen in the game-session worker.
 */
export interface CapturedGame {
  archipelago?: Archipelago;
  /** The campaign run's state when the island on screen is a campaign run (C2); its save goes to the run row. */
  campaignRun?: CampaignRunState;
  /** The island's command log interval this capture ends (D4.2); account saves upload it with the snapshot. */
  commandLog?: CommandLogInterval | null;
  /** The island's RNG draw ring buffer when that interval ended (sent only when the server asks for it). */
  commandLogTrail?: RandomDraw[];
  /** The intervals since the last confirmed upload, as the remote store sends them (set by the store). */
  commandLogs?: CommandLogInterval[];
  player?: PlayerProgress;
  save: Parameters<typeof createGameSave>;
  /**
   * The settlement JSON produced by the same capture as `save[1]` (S14). The worker parses this
   * instead of structured-cloning the snapshot; the page keeps `save[1]` for its in-place reload.
   */
  settlementText?: string;
  /**
   * The world as a journal patch (S06) instead of the live world in `save[0]` (which is then not
   * sent to the worker): the worker applies it to its mirror and writes the map as a delta directly.
   */
  worldPatch?: WorldPatch;
}

/** A composed game whose map is still held as parts: the active island's key and its live map. */
export interface ComposedGame {
  game: GameSaveV1;
  live?: { islandKey: IslandKey | CampaignRunKey; map: LiveMap };
}

/** Where a captured game goes: the browser slot, or a cloud snapshot body (kept locally until confirmed). */
export type PersistTarget =
  | { kind: "local"; slotId: string }
  | { kind: "snapshot"; recoverySlotId: string; confirmedMapBases?: string[];
    /** Content signatures of the islands the server stores: those islands travel as references. */
    serverSignatures?: Record<string, string> };

/** Rehydrates a wire capture whose settlement travelled as text instead of a structured clone. */
export const hydrateCapturedGame = (captured: CapturedGame): CapturedGame => {
  if (!captured.settlementText || captured.save[1]) return captured;
  return { ...captured, save: [captured.save[0], JSON.parse(captured.settlementText) as SettlementSaveV1,
    captured.save[2], captured.save[3]] };
};

/** The captured save with its archipelago, player and campaign run state. */
const attachCaptured = (game: GameSaveV1, { archipelago, campaignRun, player }: CapturedGame): GameSaveV1 =>
  ({ ...game, ...(archipelago ? { archipelago } : {}), player, ...(campaignRun ? { campaignRun } : {}) });

export const composeCapturedGame = async (captured: CapturedGame): Promise<GameSaveV1> =>
  profileSaveStageAsync("save.compose", async () => attachCaptured(await createGameSave(...captured.save), captured));

const warnHealedLayers = (layers: string[]) => {
  if (layers.length) console.warn(`Save journal self check repaired the world mirror: ${layers.join(", ")}`);
};

/**
 * The game of a patched capture: the worker's mirror of the world gives the map as parts, so no map
 * file is built or inflated (the file is written only when a new base is needed). Without a map
 * delta store (the localStorage fallback) the mirror world is written as a map file as usual.
 */
const composePatchedGame = async (
  captured: CapturedGame & { worldPatch: WorldPatch }, keepParts: boolean
): Promise<ComposedGame> => {
  const [, settlement, input, runtime] = captured.save;
  const { worldPatch } = captured;
  const applied = profileSaveStage("save.mirror.apply", () => applyWorldPatch(worldPatch));
  warnHealedLayers(applied.healed);
  const attach = (game: GameSaveV1) => attachCaptured(game, captured);
  if (!keepParts) return { game: attach(await createGameSave(applied.world, settlement, input, runtime)) };
  const parts = profileSaveStage("save.mirror.parts", () => writeMapParts(applied.world, input));
  const game = assembleGameSave(applied.world, settlement, input, runtime, "");
  const map: LiveMap = { file: async () => bytesToBase64(await compressMapParts(parts)), parts };
  return { game: attach(game), live: { islandKey: activeSaveKey(captured), map } };
};

/** Composes a capture for storage; a patched capture keeps its map as parts where a delta store can use them. */
const composeForStorage = async (captured: CapturedGame, deltaStore: boolean): Promise<ComposedGame> => {
  if (captured.worldPatch)
    return composePatchedGame({ ...captured, worldPatch: captured.worldPatch }, deltaStore);
  return { game: await composeCapturedGame(captured) };
};

/** The save API's complete snapshot of `save` as gzip-compressed JSON (the upload body), with its command logs. */
export const encodeSnapshotBody = async (
  save: GameSaveV1, commandLogs?: readonly CommandLogInterval[], bases?: MapBases, confirmed: readonly string[] = [],
  live?: ComposedGame["live"]
): Promise<ArrayBuffer> =>
  (await createSnapshotBodyBuilder().build({ bases, commandLogs, confirmed, game: save, live })).body;

/** The cloud slots' body builders (the worker keeps one per recovery slot: its encoding cache). */
const bodyBuilders = new Map<string, SnapshotBodyBuilder>();
const bodyBuilderOf = (recoverySlotId: string) => {
  let builder = bodyBuilders.get(recoverySlotId);
  if (!builder) { builder = createSnapshotBodyBuilder(); bodyBuilders.set(recoverySlotId, builder); }
  return builder;
};

/** The last body of a cloud slot again with `keys` complete (the server did not hold those islands). */
export const completeSnapshotBody = (recoverySlotId: string, keys: readonly string[]) =>
  bodyBuilderOf(recoverySlotId).complete(keys);

/**
 * Builds and writes one captured game. Local: the slot's rows. Snapshot: the recovery copy first (so a failed or
 * interrupted upload never loses progress), then the compressed upload body.
 */
export const persistCapturedGame = async (
  input: CapturedGame, target: PersistTarget,
  database: Pick<GameDatabase, "writeGame" | "mapBases"> & { backend?: GameDatabase["backend"] }
): Promise<SnapshotUpload | null> => {
  const captured = hydrateCapturedGame(input);
  const { game, live } = await composeForStorage(captured, database.backend === "indexeddb");
  const written = live && { live: { [live.islandKey]: live.map } };
  if (target.kind === "local") {
    // IndexedDB stores a pinned immutable base plus exact differences.
    await profileSaveStageAsync("save.write.local", () => database.writeGame(target.slotId, game, written));
    return null;
  }
  const rowSignatures = await profileSaveStageAsync("save.write.recovery", () =>
    database.writeGame(target.recoverySlotId, game, written));
  return profileSaveStageAsync("save.encodeAndReport", () => bodyBuilderOf(target.recoverySlotId).build({
    bases: database.mapBases?.(target.recoverySlotId), commandLogs: captured.commandLogs,
    confirmed: target.confirmedMapBases, game, live, rowSignatures: rowSignatures || undefined,
    serverSignatures: target.serverSignatures }));
};
