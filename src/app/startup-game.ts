import { FORMATS } from "../../../island-of-settlers-shared/src/formats";
import type { SimRules } from "../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { profileAsync } from "../render-common/load-profile";
import { catchUpSubject } from "../shared/campaign/campaign-run-game";
import { translateMessage } from "../shared/i18n/translate";
import { isAdventureIsland } from "../shared/settlement/adventure-rules";
import type { GameSaveV1, LoadedGameSave } from "../shared/settlement/game-save";
import type { WorldData } from "../shared/world/world-data";
import type { AppParams } from "./app-params";
import type { SessionClock } from "./cloud/session-clock";
import { errorMessage } from "./helpers";
import { toIslandCacheGroup } from "./island-world-preparation";
import { LOADING_MESSAGES } from "./loading-messages";
import type { createLoadingScreen } from "./loading-screen";
import { languagePreference } from "./localization/language-store";
import { readStartMap, type StartMap } from "./map-editor/map-startup";
import type { SaveStore } from "./save-store/save-store";
import {
  type AwaySummary, awaySummaryText, discardedAwayText, skippedAwayText, summarizeTimeAway
} from "./settlement/away-summary";
import { sessionSkipsCatchUp } from "./settlement/catch-up-skip";
import {
  type ChartIsland, type ColonyArrival, colonyHomeFallback, planColonyArrival, readColonyVisit
} from "./settlement/colony-boot";
import {
  advanceOfflineGameInWorker, cancelOfflineCatchUp, stageGameSessionInWorker as stageGameSession
} from "./settlement/game-session-worker";
import { type OfflineSkipResult, skipOfflineProgress } from "./settlement/offline-progress";
import type { WorkerPool } from "./worker-pool";

/** Seed of the saved home island; a colony/adventure save keeps home under `archipelago.home`. */
export const savedHomeSeed = (game: GameSaveV1): number | undefined =>
  game.archipelago?.home?.settlement?.world?.seed ?? game.settlement?.world?.seed;

/**
 * The game staged for this page load: a colony visit/return or a continued save (startup slot first).
 *
 * An explicit `?seed=` only continues the save when it names the saved home island's seed. A
 * different seed starts a fresh island; the old slot is not loaded (its next save will replace it).
 * Saves without a recorded seed are still loaded, so pre-seed saves are never discarded silently.
 */
export const readPendingGame = async (
  saveStore: SaveStore,
  continueSavedGame: boolean,
  requestedSeed?: number
) => {
  let pendingGame: string | null = null, seedMismatch = false;
  try {
    pendingGame = await saveStore.readStartupGame();
    if (!pendingGame && continueSavedGame) {
      const saved = await saveStore.readSavedGame();
      if (saved) {
        const savedSeed = savedHomeSeed(saved);
        if (requestedSeed === undefined || savedSeed === undefined || savedSeed === requestedSeed) {
          pendingGame = JSON.stringify(saved);
        } else {
          seedMismatch = true;
        }
      }
    }
    return { gameLoadError: "", pendingGame, seedMismatch };
  }
  catch {
    const gameLoadError = translateMessage(languagePreference.i18n,
      LOADING_MESSAGES.failure.storageUnavailable);
    return { gameLoadError, pendingGame, seedMismatch };
  }
};

interface RestorePendingGameOptions {
  fog: boolean;
  loading: ReturnType<typeof createLoadingScreen>;
  /** Development/acceptance override of D15's 60 s skip delay; builds use the product default. */
  offlineSkipAfterMs: number;
  params: AppParams;
  pendingGame: string | null;
  pool: WorkerPool;
  revealOre: boolean;
  saveStore: SaveStore;
  /** The server already caught the account's game up (D4.4): its save time and what changed. */
  serverCatchUp?: { savedAt: number; summary: AwaySummary | null } | null;
  /** Real UTC time (server-anchored for accounts): catch-up runs up to it, so the clock jumps to it. */
  sessionClock: SessionClock;
  /**
   * The session's game rules, known at boot (plan §10): `catchUp: "skip"` (offline mode) skips the whole save even
   * before the islands pinned them. Absent: the save's own pins decide.
   */
  sessionRules?: Pick<SimRules, "catchUp">;
}

interface LocalCatchUp {
  caughtUp: GameSaveV1;
  /** The game rules skip catch-up (offline mode): nothing was due, so nothing was discarded. */
  rulesSkip?: boolean;
  /** The player chose D15's discard, or the rules skip, instead of the replay. */
  skipped?: OfflineSkipResult;
  summary?: AwaySummary;
}

/** Offline mode (plan §10): the clock moves to now, the islands keep their state, the calendar still ages. */
const skipByRules = (value: GameSaveV1, { sessionClock }: RestorePendingGameOptions): LocalCatchUp => {
  const skipped = skipOfflineProgress(value, sessionClock());
  return { caughtUp: skipped.save, rulesSkip: true, skipped };
};

/** D15: the explicit discard commits only the last save at `now`, never the partially replayed state. */
const discardOfflineProgress = async (
  value: GameSaveV1, { loading, sessionClock }: RestorePendingGameOptions
): Promise<LocalCatchUp> => {
  await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.discard));
  loading.setProgress(null);
  const skipped = skipOfflineProgress(value, sessionClock());
  return { caughtUp: skipped.save, skipped };
};

/** The client's own catch-up (guests, or when the server could not): the time away replayed in a worker. */
const catchUpLocally = async (value: GameSaveV1, options: RestorePendingGameOptions): Promise<LocalCatchUp> => {
  const { loading, offlineSkipAfterMs, saveStore, sessionClock } = options;
  await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.catchUp.step));
  loading.setProgress(0);
  let skipRequested = false;
  // A server-owned save stays authoritative (D15): only a browser-owned guest save may discard locally.
  const stopSkip = saveStore.location === "browser"
    ? loading.showSkipOption(() => {
      skipRequested = true;
      cancelOfflineCatchUp();
    }, offlineSkipAfterMs)
    : () => {};
  try {
    const now = sessionClock();
    const caughtUp = await advanceOfflineGameInWorker(value, now, progress => {
      const percent = progress.totalSeconds > 0
        ? Math.min(100, Math.floor(100 * progress.completedSeconds / progress.totalSeconds))
        : 0;
      loading.setMessage(translateMessage(languagePreference.i18n, LOADING_MESSAGES.catchUp.progress, { percent }));
      loading.setProgress(percent);
    });
    if (skipRequested) return await discardOfflineProgress(value, options);
    loading.setProgress(null);
    return { caughtUp, summary: summarizeTimeAway(catchUpSubject(value), catchUpSubject(caughtUp), now) };
  }
  catch (error) {
    if (!skipRequested) throw error;
    return await discardOfflineProgress(value, options);
  }
  finally { stopSkip(); }
};

/** The login notice: a discard never borrows the normal away-gains wording. */
const catchUpNotice = ({ caughtUp, rulesSkip, skipped, summary }: LocalCatchUp, value: GameSaveV1) => {
  const { i18n } = languagePreference;
  if (skipped && rulesSkip) return skippedAwayText(skipped.endedColonies, i18n);
  if (skipped) return discardedAwayText(skipped.awaySeconds, skipped.endedColonies, i18n);
  if (caughtUp === value) return "";
  return awaySummaryText(summary!, i18n);
};

/**
 * A continued save: caught up (by the server for accounts, else here) and staged. A locally caught up save is
 * committed only after it validated, so reloading cannot award the same interval twice.
 */
const continueGame = async (value: GameSaveV1, options: RestorePendingGameOptions) => {
  const server = options.serverCatchUp;
  if (value.format !== FORMATS.gameSave.id) {
    const restoredGame = await stageGameSession(value);
    await options.saveStore.writeSavedGame(value);
    return { awayNotice: "", restoredGame, savedAt: undefined };
  }
  if (server && server.savedAt === value.savedAt) {
    const restoredGame = await profileAsync("restore saved game (worker)", () => stageGameSession(value));
    return { awayNotice: server.summary ? awaySummaryText(server.summary, languagePreference.i18n) : "", restoredGame,
      savedAt: value.savedAt };
  }
  const local = sessionSkipsCatchUp(value, options.sessionRules)
    ? skipByRules(value, options) : await catchUpLocally(value, options);
  const { caughtUp } = local;
  const restoredGame = await profileAsync("restore saved game (worker)", () => stageGameSession(caughtUp));
  // Start the full-slot write before the renderer/UI build, but await it before the first ready frame.
  // This hides most of the 512² save rewrite under asset preparation without exposing an uncommitted
  // catch-up to autosave.
  const pendingSave = options.saveStore.writeSavedGame(caughtUp);
  // The runtime awaits this before ready; mark a failure handled if staging throws before that point.
  void pendingSave.catch(() => undefined);
  const awayNotice = catchUpNotice(local, value);
  // A campaign run keeps its own saved tick (C2): its clock starts there, while home and colonies caught up.
  return { awayNotice, pendingSave, restoredGame, savedAt: caughtUp.savedAt };
};

/** Charts a visited colony island, or replays time away and stages a continued save. */
export const restorePendingGame = async (options: RestorePendingGameOptions) => {
  const { fog, loading, params, pendingGame, pool, revealOre, saveStore } = options;
  let restoredGame: LoadedGameSave | null = null;
  let gameLoadError = "", awayNotice = "", savedAt: number | undefined;
  let pendingSave: Promise<void> | undefined;
  const colonyVisit = readColonyVisit(pendingGame);
  let colonyArrival: ColonyArrival | null = null;
  if (colonyVisit) {
    await loading.setStep(translateMessage(languagePreference.i18n, LOADING_MESSAGES.colony.charting));
    const chart: ChartIsland = (expeditionIsland, key) =>
      pool.chartIsland(expeditionIsland, toIslandCacheGroup(params, fog, revealOre, key));
    try { colonyArrival = await profileAsync("chart the island (worker)", () => planColonyArrival(colonyVisit, chart)); }
    catch (error) {
      gameLoadError = errorMessage(error, translateMessage(languagePreference.i18n,
        LOADING_MESSAGES.failure.colonyUnreachable));
      restoredGame = await stageGameSession(colonyHomeFallback(colonyVisit));
    }
    await saveStore.clearStartupGame();
  } else if (pendingGame) {
    try {
      const continued = await continueGame(JSON.parse(pendingGame) as GameSaveV1, options);
      ({ awayNotice, pendingSave, restoredGame, savedAt } = continued);
    }
    catch (error) {
      gameLoadError = errorMessage(error, translateMessage(languagePreference.i18n,
        LOADING_MESSAGES.failure.loadGame));
    }
    await saveStore.clearStartupGame();
  }
  /** `savedAt`: the continued save's game time, where its session's game clock starts (the server's replay too). */
  return { awayNotice, colonyArrival, colonyVisit, gameLoadError, pendingSave, restoredGame, savedAt };
};

/**
 * The map the island starts from: a restored save's own map, an explicit `?map=` slot, or the
 * published shared starter. An explicit `?seed=` still generates a new island, so the shared map
 * never overrides a reproduction or benchmark request.
 */
export const loadStartMap = async (
  restoredGame: LoadedGameSave | null, params: AppParams, starter: StartMap | null = null
) => {
  if (restoredGame) return { error: "", loaded: restoredGame.map, provenance: restoredGame.mapProvenance } satisfies StartMap;
  if (params.map) return await readStartMap(params.map);
  return params.seedFromUrl ? null : starter;
};

/** Which expedition the island is: the arriving visit decides, else the restored settlement. */
export const expeditionKindOf = (
  arrivingIsland: ColonyArrival["record"]["island"] | undefined,
  restoredGame: LoadedGameSave | null
): WorldData["expeditionKind"] => {
  if (arrivingIsland) return isAdventureIsland(arrivingIsland) ? "adventure" : "colony";
  if (restoredGame?.settlement.adventure) return "adventure";
  return restoredGame?.settlement.colony ? "colony" : undefined;
};
