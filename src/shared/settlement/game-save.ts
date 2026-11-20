import {
  FORMATS, type FormatVersionIssue, formatVersionIssue
} from "../../../../island-of-settlers-shared/src/formats";
import { base64ToBytes, bytesToBase64 } from "../../../../island-of-settlers-shared/src/save-map-delta";
import { type CampaignRunState, campaignRunStateError, runMatchesMarker } from "../campaign/campaign-run";
import { migratePlayerProgress, type PlayerProgress,validatePlayerProgress } from "../progression/player-progress";
import { validMapProvenance } from "../world/save/map-provenance";
import { type LoadedMap,readMapFile } from "../world/save/map-reader";
import { type MapSaveInput,writeMapFile } from "../world/save/map-writer";
import { FOG, type WorldData } from "../world/world-data";
import { type Archipelago,validateArchipelago } from "./archipelago";
import { packBits, type PackedBits, type PackedFog, packFog, unpackBitCells, unpackFog } from "./save-cell-codecs";
import type { SettlementSaveV1 } from "./settlement-save-state";

export interface GameSaveV1 {
  format: typeof FORMATS.gameSave.id;
  version: typeof FORMATS.gameSave.current;
  savedAt: number;
  map: string;
  /** Exact shared-catalog revision this game was started from, when it has one. */
  mapProvenance?: import("../world/save/map-provenance").MapProvenance;
  progress: { fog: PackedFog; permanentSight?: PackedBits; surveyed: [number, boolean][] };
  settlement: SettlementSaveV1;
  /** Renderer-owned trees, wildlife, camera and selected island metadata. */
  runtime?: unknown;
  /** Home island and colonies that are not on screen; absent before the first colony. */
  archipelago?: Archipelago;
  /** Player level, gems and daily quests, shared by every island. */
  player?: PlayerProgress;
  /**
   * The save on screen is this campaign run (C2): home is filed under `archipelago.home`, never a copy here. A
   * home-less run (no home island, GS3a) files nothing and its island pins `homeIsland: false`.
   */
  campaignRun?: CampaignRunState;
  /** "offline": saved by an offline-mode slot; never uploaded or imported into an account (GS3a). */
  origin?: "offline";
}
export interface LoadedGameSave {
  map: LoadedMap;
  mapProvenance?: import("../world/save/map-provenance").MapProvenance;
  settlement: SettlementSaveV1;
  runtime?: unknown;
  archipelago?: Archipelago;
  player?: PlayerProgress;
  campaignRun?: CampaignRunState;
}
/**
 * The save document around an already written map (`map` is empty when the caller keeps the map as
 * parts and stores it as a delta directly: `compactIsland` with a live map).
 */
export const assembleGameSave = (
  world: WorldData,
  settlement: SettlementSaveV1,
  input: MapSaveInput,
  runtime: unknown,
  map: string
): GameSaveV1 => {
  const progress = {
    fog: packFog(world.fog),
    permanentSight: world.permanentFog && packBits(world.permanentFog, FOG.visible),
    surveyed: (world.surveyedBeforeReveal ?? world.mineZones.map(
      (zone) => [zone.id, zone.surveyed] as [number, boolean]))
  };
  const runtimeSnapshot = runtime === undefined ? undefined : JSON.parse(JSON.stringify(runtime));
  return {
    format: FORMATS.gameSave.id,
    version: FORMATS.gameSave.current,
    savedAt: input.savedAt,
    map,
    mapProvenance: input.provenance && { ...input.provenance },
    progress,
    settlement,
    runtime: runtimeSnapshot
  };
};

/** A game embeds the actual edited world; loading never relies on regenerating the same seed. */
export const createGameSave = async (
  world: WorldData,
  settlement: SettlementSaveV1,
  input: MapSaveInput,
  runtime?: unknown
): Promise<GameSaveV1> => {
  // Progress and runtime are read before the first await, as the map's own layers are.
  const game = assembleGameSave(world, settlement, input, runtime, "");
  return { ...game, map: bytesToBase64(await writeMapFile(world, input)) };
};

const GAME_SAVE_VERSION_ERRORS: Readonly<Record<FormatVersionIssue, string>> = {
  invalidVersion: "Invalid game save version",
  newerVersion: "Game save was created by a newer version",
  unsupportedVersion: "Unsupported game save version"
};

const isSavedSurvey = (zones: WorldData["mineZones"]) => (entry: unknown) =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  Number.isSafeInteger(entry[0]) &&
  typeof entry[1] === "boolean" &&
  zones.some((zone) => zone.id === entry[0]);

/** The permanent sight cells of a save (decoded and range checked; none when the save has none). */
const readPermanentSight = (progress: GameSaveV1["progress"], cellCount: number) => {
  if (progress.permanentSight === undefined) return [];
  try {
    return unpackBitCells(progress.permanentSight, cellCount);
  } catch {
    throw new Error("Invalid permanent exploration");
  }
};

const readSavedFog = (progress: GameSaveV1["progress"], cellCount: number) => {
  try {
    return unpackFog(progress.fog, cellCount);
  } catch {
    throw new Error("Invalid saved island progress");
  }
};

/**
 * Applies the saved fog, permanent sight and survey flags to a freshly decoded world; everything is
 * validated before the world changes. Map decoding rebuilds permanent starting sight. Saved
 * temporary sight is remembered as exploration; restored live sight sources reveal it again when
 * they update.
 */
const applySavedProgress = (world: WorldData, progress: GameSaveV1["progress"]) => {
  const permanentCells = readPermanentSight(progress, world.fog.length);
  const fog = readSavedFog(progress, world.fog.length);
  const { surveyed } = progress;
  if (!Array.isArray(surveyed) || !surveyed.every(isSavedSurvey(world.mineZones)))
    throw new Error("Invalid saved island progress");
  const permanentFog = world.fog.slice();
  for (const cell of permanentCells) permanentFog[cell] = FOG.visible;
  world.permanentFog = permanentFog;
  for (let cell = 0; cell < fog.length; cell += 1) {
    const startingSight = permanentFog[cell] === FOG.visible;
    world.fog[cell] = startingSight ? FOG.visible : Math.min(fog[cell]!, FOG.discovered);
  }
  for (const [id, flag] of surveyed) world.mineZones.find((zone) => zone.id === id)!.surveyed = flag;
};

/** A run whose island pinned rules without a home (GS3a, rev H1) files no home island. */
const playsWithoutHome = (settlement: SettlementSaveV1) => settlement.gameRules?.homeIsland === false;

/**
 * A campaign run on screen needs its archipelago marker and the filed home island (C2); a home-less run (its island
 * pinned `homeIsland: false`) needs the marker only.
 */
const campaignRunError = (
  run: CampaignRunState | undefined, archipelago: Archipelago | undefined, settlement: SettlementSaveV1
) => {
  if (run === undefined) return null;
  const stateError = campaignRunStateError(run);
  if (stateError) return stateError;
  const homeFiled = Boolean(archipelago?.home) || playsWithoutHome(settlement);
  if (!archipelago || archipelago.active !== null || !homeFiled || !runMatchesMarker(run, archipelago.campaign))
    return "The campaign run has no filed home island";
  return null;
};

/** Decode into a separate world. The caller validates its settlement before committing the session. */
export const readGameSave = async (value: unknown): Promise<LoadedGameSave> => {
  if (!value || typeof value !== "object") throw new Error("Invalid game save");
  const saved = value as GameSaveV1;
  if (
    saved.format !== FORMATS.gameSave.id ||
    typeof saved.map !== "string" ||
    !Number.isFinite(saved.savedAt) ||
    !saved.settlement ||
    !saved.progress
  )
    throw new Error("Unsupported game save format");
  const versionIssue = formatVersionIssue(FORMATS.gameSave, saved.version);
  if (versionIssue) throw new Error(GAME_SAVE_VERSION_ERRORS[versionIssue]);
  if (saved.mapProvenance !== undefined && !validMapProvenance(saved.mapProvenance))
    throw new Error("Invalid map provenance");
  const loaded = await readMapFile(base64ToBytes(saved.map));
  applySavedProgress(loaded.world, saved.progress);
  if (
    saved.settlement.world?.seed !== loaded.world.seed ||
    saved.settlement.world?.cellsX !== loaded.world.cellsX ||
    saved.settlement.world?.cellsZ !== loaded.world.cellsZ
  )
    throw new Error("Settlement and island data do not match");
  // Decoded copies: callers may change the loaded save without touching the stored one.
  const archipelago = structuredClone(saved.archipelago) as Archipelago | undefined;
  const archipelagoError = validateArchipelago(archipelago) ??
    campaignRunError(saved.campaignRun, archipelago, saved.settlement);
  if (archipelagoError) throw new Error(archipelagoError);
  const player = migratePlayerProgress(saved.player);
  if (player !== undefined && !validatePlayerProgress(player)) throw new Error("Invalid player progress");
  const settlement = structuredClone(saved.settlement) as SettlementSaveV1;
  const campaignRun = saved.campaignRun && structuredClone(saved.campaignRun);
  return { archipelago, map: loaded, mapProvenance: saved.mapProvenance && { ...saved.mapProvenance },
    player: player as PlayerProgress | undefined, settlement, runtime: saved.runtime,
    ...(campaignRun ? { campaignRun } : {}) };
};
