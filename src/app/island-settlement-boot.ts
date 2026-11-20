import { isBuildingDetailed } from "../render-common/buildings/building-detail";
import type { createCamera } from "../render-common/camera-state";
import type { createCritterManager } from "../render-common/critters/critter-manager";
import { profileStep } from "../render-common/load-profile";
import type { TerrainRenderer } from "../render-common/renderer-contract";
import type { createWorkerGroup } from "../render-common/workers/worker-group";
import type { WorkerNation } from "../render-common/workers/worker-unit";
import { translateDomainText } from "../shared/i18n/domain";
import { translateMessage } from "../shared/i18n/translate";
import { customExpiryNotice } from "../shared/settlement/archipelago-colony-quests";
import type { LoadedGameSave } from "../shared/settlement/game-save";
import type { GameSaveV1 } from "../shared/settlement/game-save";
import { islandKey } from "../shared/settlement/game-save-rows";
import { ownedDecorationFrames } from "../shared/settlement/map-scenery";
import { countOwnedPlacedRoadDecorations } from "../shared/settlement/road-decoration-owned";
import { profileSaveStage } from "../shared/settlement/save-stage-profile";
import { isOwnBuilding } from "../shared/settlement/settlement-home";
import { validateMapScenario } from "../shared/settlement/settlement-map-scenario";
import { adoptSessionRules, type SimRules } from "../shared/settlement/sim-rules";
import { writeMapFile } from "../shared/world/save/map-writer";
import type { WorldData } from "../shared/world/world-data";
import type { AppParams } from "./app-params";
import type { createBuildOverlay } from "./build-overlay/build-overlay";
import type { CloudSession } from "./cloud/cloud-boot";
import type { ServerEconomy } from "./cloud/server-economy";
import type { ServerMarket } from "./cloud/server-market";
import type { SessionClock } from "./cloud/session-clock";
import type { ExternalStore } from "./components/ui-store";
import type { createEnvironmentController } from "./environment-controller";
import { titlePageUrl } from "./game-settings/session-mode";
import { errorMessage } from "./helpers";
import type { createIslandAnimals } from "./island-animals";
import type { createIslandDevelopmentTools } from "./island-development-tools";
import type { createIslandFelling } from "./island-felling";
import type { createIslandGrowth } from "./island-growth";
import type { IslandHandoffRequest, IslandHandoffResult } from "./island-handoff";
import type { createIslandMapEditor } from "./island-map-editor";
import { LOADING_MESSAGES } from "./loading-messages";
import { languagePreference } from "./localization/language-store";
import { downloadBytes, toMapFileName } from "./map-editor/helpers";
import { type StartMap, toEditorMap } from "./map-editor/map-startup";
import type { IslandChoice } from "./map-generator/helpers";
import type { createMinimap } from "./minimap/minimap";
import type { createObservationPanel } from "./observation/observation-panel";
import { reloadPage } from "./page-reload";
import { createPlayerInventoryControls } from "./player-inventory/inventory-controls";
import { inventoryMapKind } from "./player-inventory/map-context";
import type { CapturedGame } from "./save-store/captured-game";
import { createIdleMoments } from "./save-store/idle-moments";
import { clearAllLocalGameSaves, recreateLocalGameDatabase } from "./save-store/local-save-store";
import type { SaveCoordinator } from "./save-store/save-coordinator";
import type { SaveStore } from "./save-store/save-store";
import { bindSettlementSaving } from "./save-store/settlement-saving";
import { isTestPlay } from "./script/test-play/helpers";
import { startTestPlayLog } from "./script/test-play/test-play-layer";
import { createIslandScriptUi, type IslandScriptUiOptions } from "./script/ui/island-script-ui";
import { createSessionLifecycle, SessionTransitionCancelled } from "./session-lifecycle";
import { SESSION_MESSAGES } from "./session-messages";
import type { createCameraBookmarkControls } from "./settings/camera/bookmark-controls";
import { DEVELOPMENT_MESSAGES as DEVELOPMENT } from "./settings/development/messages";
import { type readGraphicsOptions, settingsStorage } from "./settings/graphics-settings";
import type { createSettingsPanel } from "./settings/settings-panel";
import { createMainSelectionShortcuts, type WindowShortcut } from "./settings/window-shortcut";
import { type ArchipelagoSession, createArchipelagoSession } from "./settlement/archipelago-session";
import { archivedOwnedIslands } from "./settlement/archived-island-access";
import { createBackgroundSession } from "./settlement/background-session";
import { createCampaignDepartureSources } from "./settlement/campaign-departure-sources";
import { announceCampaignEndNotice, keepCampaignEndNotice } from "./settlement/campaign-end-notice";
import { campaignRunOptions } from "./settlement/campaign-run-end";
import {
  type ColonyArrival, colonySettlementOptions, islandArchipelago, islandDifficulty, islandStartPoint,
  type readColonyVisit, settleArrivingColony
} from "./settlement/colony-boot";
import { createCommandLogSession } from "./settlement/command-log-session";
import { createCommanderRecoverySession } from "./settlement/commander-recovery-session";
import type { createDebugClickModes } from "./settlement/debug-click-modes";
import type { GameRuntimeState } from "./settlement/game-session";
import {
  createGameSaveInWorker as createGameSave, rethemeExpeditionInWorker, stageGameSessionInWorker as stageGameSession
} from "./settlement/game-session-worker";
import { createHeldFrameJobs } from "./settlement/held-frame-jobs";
import { createHomeClaimSubmitter } from "./settlement/home-claim-submitter";
import { createIslandResources } from "./settlement/island-resource-hooks";
import { createIslandSettlement, type IslandSettlement } from "./settlement/island-settlement";
import type { createMilitaryAiDebug, MilitaryAiDebug } from "./settlement/military-ai-debug";
import type { MilitaryDebugControls } from "./settlement/military-debug/helpers";
import { createPlayerSession, type PlayerSession } from "./settlement/player-session";
import { createReliefIslandPort, type ReliefIslandPort } from "./settlement/relief-island-port";
import { createRoadDecorationSession } from "./settlement/road-decoration-session";
import type { createSettlementDebugActions } from "./settlement/settlement-debug-actions";
import { settlementBuildingFrameId } from "./settlement/settlement-render-frames";
import { createSettlementSaveController, getImportQuestion } from "./settlement/settlement-save";
import {
  decideTabResume, hiddenSecondsBetween, sameTabResumeContext, type TabResumeAuthority,
  type TabResumeContext, usesSavedTabResumeHandoff
} from "./settlement/tab-resume";
import type { createShipObservation } from "./ship-observation";
import { rememberTitleLanding } from "./title/title-landing";

interface IslandSettlementBootOptions {
  animals: ReturnType<typeof createIslandAnimals>;
  bookmarks: ReturnType<typeof createCameraBookmarkControls>;
  /**
   * The session rules of a game without a lease (guest, standalone, offline; GS3a): undefined keeps today's rules.
   * A cloud session adopts its lease grant instead.
   */
  browserSessionRules?: SimRules;
  buildOverlay: ReturnType<typeof createBuildOverlay>;
  camera: ReturnType<typeof createCamera>;
  canvas: HTMLCanvasElement;
  colonyArrival: ColonyArrival | null;
  colonyVisit: ReturnType<typeof readColonyVisit>;
  critters: ReturnType<typeof createCritterManager>;
  /** Admin/local-dev map-click modes; absent: inert player controls. */
  createDebugClickModes?: typeof createDebugClickModes;
  /** Admin/local-dev military AI overlay; absent: no overlay. */
  createMilitaryAiDebug?: typeof createMilitaryAiDebug;
  /** Admin/local-dev state-changing debug actions; absent: inert player actions. */
  createSettlementDebugActions?: typeof createSettlementDebugActions;
  developmentTools?: ReturnType<typeof createIslandDevelopmentTools>;
  environment: ReturnType<typeof createEnvironmentController>;
  felling: ReturnType<typeof createIslandFelling>;
  gameLoadError: string;
  /** The signed-in account's cloud session (slot, lease and authority) for a retained tab resume. */
  cloud?: CloudSession;
  /** The game time a continued save starts at (its caught-up save time); else the session clock's now. */
  clockStart?: number;
  /** Owner 2026-10-15: Development tools are for administrators (or a dev-build guest). */
  developmentAllowed: boolean;
  /** False while exploration owns normal map input; simulation ticks continue. */
  inputAllowed?: () => boolean;
  /** CIN3: a paused campaign sequence holds the simulation tick (render frames and presentation continue). */
  simulationHeld?: () => boolean;
  /** "While you were away": what the catch-up at login changed (empty: nothing to tell). */
  awayNotice?: string;
  graphicsOptions: ReturnType<typeof readGraphicsOptions>;
  growth: ReturnType<typeof createIslandGrowth>;
  /** In-page return home; absent keeps the reload path. */
  handoff?: (request: IslandHandoffRequest) => Promise<IslandHandoffResult<unknown, unknown>>;
  islandChoice: IslandChoice;
  mapEditor: ReturnType<typeof createIslandMapEditor>;
  militaryAiDebug: ExternalStore<MilitaryAiDebug | null>;
  militaryDebug: ExternalStore<MilitaryDebugControls | null>;
  minimap: ReturnType<typeof createMinimap>;
  minimapShown: boolean;
  observation: ReturnType<typeof createObservationPanel>;
  params: AppParams;
  playerNation: WorkerNation;
  renderer: TerrainRenderer;
  /** Resets the render loop's frame and service time origins after a retained tab resume. */
  resetFrameTime?: () => void;
  restoredGame: LoadedGameSave | null;
  saveStore: SaveStore;
  saving: SaveCoordinator;
  /** Real UTC time (server-anchored for accounts): the game clock's anchor. */
  sessionClock: SessionClock;
  /** A signed-in player's server economy (gems, rewards, purchases); absent for guests. */
  economy?: ServerEconomy;
  /** The account's server-backed Player Market; absent for guests and offline play. */
  market?: ServerMarket;
  settings: ReturnType<typeof createSettingsPanel>;
  shipObservation: ReturnType<typeof createShipObservation>;
  startMap: StartMap | null;
  viewport: HTMLElement;
  workerNation: WorkerNation;
  workers: ReturnType<typeof createWorkerGroup>;
  world: WorldData;
  /** Called as soon as the settlement exists, before travel, saves and debug panels bind to it. */
  onCreated: (settlement: IslandSettlement) => void;
}

/** Lands an arriving colony, frames the start point and binds the debug panels to the new settlement. */
const finishIslandSettlement = (
  settlement: IslandSettlement,
  savedGames: ReturnType<typeof createSettlementSaveController>,
  options: IslandSettlementBootOptions,
  monumentBonus: boolean
) => {
  const {
    animals, camera, cloud, colonyArrival, developmentTools, felling, growth, mapEditor, militaryAiDebug,
    militaryDebug, params, renderer, restoredGame, saveStore, saving, settings, viewport, world
  } = options;
  let gameLoadError = options.gameLoadError;
  if (colonyArrival) {
    const landed = settleArrivingColony(settlement.simulation, colonyArrival, monumentBonus);
    if (landed.ok) void options.saving.flush("manual");
    else gameLoadError = landed.reason;
  }
  settings.hideSettingsButton();
  viewport.classList.add("has-settlement");
  const startPoint = islandStartPoint(settlement.simulation);
  if (!params.view && !restoredGame?.runtime && startPoint) {
    camera.centerX = startPoint.x;
    camera.centerZ = startPoint.z;
  }
  Object.assign(settlement, { focusGround: (x: number, z: number, zoom?: number) => {
    if (Number.isFinite(x) && Number.isFinite(z)) { camera.centerX = x; camera.centerZ = z; }
    if (zoom !== undefined && Number.isFinite(zoom)) camera.zoom = zoom;
  } });
  militaryDebug.set(settlement.militaryDebugControls);
  const militaryAi = options.createMilitaryAiDebug?.({
    getSimulation: () => settlement.simulation, renderer, viewport, world
  });
  if (militaryAi) militaryAiDebug.set(militaryAi);
  /** Development export: the same canonical `.island` file the standalone editor imports. */
  const exportMapFile = async () => {
    try {
      const map = toEditorMap(options.startMap, options.islandChoice, world.seed);
      const bytes = await writeMapFile(world, {
        ...mapEditor.saveInput(), name: map.name, provenance: options.startMap?.provenance,
        source: map.source, savedAt: settlement.simulation.gameNow()
      });
      downloadBytes(bytes, toMapFileName(map.name));
      settlement.message("Map exported as an .island file.");
    } catch (error) {
      settlement.message(errorMessage(error, "The map could not be exported."), true);
    }
  };
  if (options.developmentAllowed && developmentTools) {
    developmentTools.hooks.exportMap = () => void exportMapFile();
    developmentTools.hooks.exportSave = () => void savedGames.exportFile();
    developmentTools.hooks.importSave = savedGames.importFile;
    const stopAndSettle = async () => {
      saving.stop();
      await saving.whenIdle();
      await saveStore.whenIdle?.();
    };
    developmentTools.hooks.clearSaves = async () => {
      await stopAndSettle();
      if (saveStore.location === "account") await cloud?.debug.clearSaves();
      await clearAllLocalGameSaves();
      cloud?.discardUnsent();
      reloadPage();
    };
    developmentTools.hooks.recreateDatabase = async () => {
      await stopAndSettle();
      if (saveStore.location === "account") await cloud?.debug.recreateDatabase();
      await recreateLocalGameDatabase();
      reloadPage();
    };
    developmentTools.exportMap.update({ disabled: false, title: DEVELOPMENT.title.exportMap });
    developmentTools.exportSave.update({ disabled: false, title: "Download the current game as a file." });
    developmentTools.importSave.update({ disabled: false, title: "Replace the current game with a game file." });
    developmentTools.clearSaves.update({ disabled: false, title: DEVELOPMENT.title.clearSaves });
    developmentTools.recreateDatabase.update({ disabled: false, title: DEVELOPMENT.title.recreateDatabase });
  }
  Object.assign(settlement, { savedGames, growth, felling, animals: animals.manager, mapEditor,
    saving: options.saving });
  if (import.meta.env.DEV)
    (window as Window & { __settlement?: typeof settlement }).__settlement = settlement;
  if (developmentTools) {
    if (settlement.simulation.colony() || settlement.simulation.home()?.colonyHome)
      developmentTools.buildAll.update({ disabled: true, title: "Build every building is disabled while viewing a colony." });
    settlement.watchEnemySpawnMode(active => developmentTools.enemySpawn.update({ active }));
    settlement.watchShipSpawnMode(active => developmentTools.shipSpawn.update({ active }));
    settlement.watchBuildingLevelMode(active => developmentTools.buildingLevel.update({ active }));
    if (options.developmentAllowed) developmentTools.npcTraders.apply();
  }
  if (gameLoadError) settlement.message(gameLoadError);
  if (options.awayNotice) settlement.message(options.awayNotice);
  return () => { militaryAi?.dispose(); militaryAiDebug.set(null); militaryDebug.set(null); };
};

export interface IslandSettlementSession {
  /** Captures the current island and its archipelago for an in-page refresh. */
  capture: () => Promise<GameSaveV1>;
  /** Releases every owner retained by this session (background listener, cloud UI, island UI). */
  dispose: () => void;
  /** Releases the departing island only; explicit page owners survive an in-page replacement. */
  disposeIsland: () => void | Promise<void>;
  /** The island travel session, once travel exists (the render loop reads it). */
  getTravel: () => ArchipelagoSession | undefined;
  /** The player's local level: the ceiling of a server level claim. */
  level: () => number;
  /** Re-claims the player's levels from the server (after verification); a no-op for guests. */
  claimServerLevel: () => void;
  /** Retains one more island owner (background session, exploration) for the next teardown. */
  retain: (dispose: () => void) => void;
  /** Retains one more island owner for the next in-page island teardown. */
  retainIsland: (dispose: () => void) => void;
  /** Retains a page owner across replacements; cloud UI binds to the current island instead. */
  retainPage: (dispose: () => void) => void;
  /** Settles accepted saves/uploads without starting a new save (discard-before-load-newer). */
  settle: () => Promise<void>;
  /** The page's one session transition guard (cloud conflict load-newer joins it). */
  transition: ReturnType<typeof createSessionLifecycle>;
}

/**
 * Starts the player's settlement on the island: progression, saves, background progress, island travel
 * and the development hooks. Returns the island travel session getter.
 */
// oxlint-disable-next-line max-lines-per-function -- one boot factory owns the settlement wiring
export const startIslandSettlement = (options: IslandSettlementBootOptions): IslandSettlementSession => {
  const {
    animals, bookmarks, buildOverlay, camera, canvas, cloud, colonyArrival, colonyVisit, critters,
    developmentTools, environment, felling, graphicsOptions, growth, islandChoice, mapEditor, minimap,
    observation, playerNation, renderer, resetFrameTime, restoredGame, saveStore, saving, settings,
    shipObservation, startMap, viewport, workers, world
  } = options;
  const i18n = languagePreference.i18n;
  const t = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  const devHooks: NonNullable<typeof developmentTools>["hooks"] = developmentTools?.hooks ?? {};
  const heldJobs = createHeldFrameJobs();
  let commandsFrozen = false, releaseTicks: (() => void) | undefined;
  const lifecycle = createSessionLifecycle({ onFrozen: (frozen, key) => {
    commandsFrozen = frozen;
    if (frozen && key !== "tab-resume") settlement?.cancelInteractions();
    // A tab resume owns its autosave pause (hide .. one release); a handoff keeps the existing behavior.
    if (key !== "tab-resume") {
      saving.setPaused(frozen);
      saving.setSuspended(frozen);
    }
    if (frozen) releaseTicks ??= heldJobs.hold();
    else { releaseTicks?.(); releaseTicks = undefined; }
  } });
  let minimapShown = options.minimapShown;
  let islandTravel: ArchipelagoSession | undefined;
  let reliefIslandPort: ReliefIslandPort | undefined;
  let playerSessionAlive = true;
  const playerSessionGeneration = lifecycle.generation();
  lifecycle.retainIsland(() => { playerSessionAlive = false; });
  const initialArchipelago = islandArchipelago(restoredGame, colonyArrival ? colonyVisit : null);
  const initialOwnedReliefArchives = initialArchipelago ? archivedOwnedIslands(initialArchipelago).map(island => island.save) : [];
  const initialReliefArchives = [...initialOwnedReliefArchives,
    ...(initialArchipelago?.reliefReceipts?.map(receipt => receipt.save) ?? [])];
  let settlement: IslandSettlement | undefined;
  let commandLog: ReturnType<typeof createCommandLogSession> | undefined;
  let settleSaves: () => Promise<void> = async () => undefined;
  const gameNow = () => settlement?.simulation.gameNow() ?? options.sessionClock();
  const recovery=createCommanderRecoverySession({ cloud,getSettlement:()=>settlement,lifecycle,saving,
    settle:()=>settleSaves(),rebase:()=>commandLog?.rebase("home"),reload:reloadPage });
  const roadDecorations = createRoadDecorationSession({ cloud, getSettlement: () => settlement, lifecycle, saving,
    settle: () => settleSaves(), rebase: key => commandLog?.rebase(key), reload: reloadPage,
    islandKey: () => {
      const group = islandTravel?.groupForSave() ?? initialArchipelago, active = group?.active ?? null;
      return islandKey(active, Boolean(group?.adventures?.some(row => row.expeditionId === active)));
    } });
  /** Road decoration custody is keyed by island; a campaign run is not one (C2). */
  const mutateRoadDecoration: typeof roadDecorations = action => islandTravel?.campaignRun()
    ? Promise.resolve({ ok: false, reason: "Road decorations cannot be moved on a campaign map" })
    : roadDecorations(action);
  const player = createPlayerSession({ mutateRoadDecoration,
    recoverCommanderWithItem:recovery,developmentAllowed: options.developmentAllowed, economy: options.economy,
    roadDecorationOwnedUnits: item => countOwnedPlacedRoadDecorations(item,
      ownedDecorationFrames(settlement?.simulation.roadDecorations() ?? []),
      settlement?.simulation.pendingRoadDecorationReturns() ?? [], islandTravel?.groupForSave() ?? initialArchipelago),
    localize: text => translateDomainText(text, i18n),
    initial: restoredGame?.player ?? colonyVisit?.player, nation: playerNation, now: gameNow, seed: world.seed,
    reliefIslands: () => reliefIslandPort, initialReliefArchives,
    isCurrent: () => playerSessionAlive && !commandsFrozen && lifecycle.generation() === playerSessionGeneration,
    beforeReliefClaim: async () => {
      if (!(await saving.flush("manual"))) return "Save the completed relief voyage before claiming its reward";
      await saving.whenIdle(); await settleSaves(); await saveStore.whenIdle?.();
      return true;
    },
    withReliefClaim: async (id, claim) => {
      const result = await lifecycle.run({ key: `relief-claim:${id}`, keepSession: true,
        run: async token => {
          if (!token.current()) throw new SessionTransitionCancelled();
          const answer = await claim();
          if (!token.current()) throw new SessionTransitionCancelled();
          return answer;
        } });
      return result.ok ? result.value : "The relief reward is waiting for the current island operation";
    },
    hasArchivedReliefHarbour: () => (islandTravel?.archivedOwnedIslands().map(island => island.save) ?? initialOwnedReliefArchives)
      .some(save => save.settlement.buildings.some(building => building.typeId === 39 &&
        building.construction === 1 && isOwnBuilding(building))),
    onLevelUp: levelUps => settlement?.announceLevelUp(levelUps),
    queueHomeGrant: (id, goods) => { void islandTravel?.queueHomeGrant(id, goods); } });
  /** The island's save inputs, gathered synchronously; account progress belongs to the same boundary. */
  const captureIslandInputs = (): CapturedGame => profileSaveStage("capture.inputs", () => {
    const { centerX, centerZ, tilt, yaw, zoom } = camera;
    const progress = profileSaveStage("capture.player", () => structuredClone(player.progress()));
    const settlementCapture = profileSaveStage("capture.settlement", () =>
      settlement!.simulation.saveStateWithText());
    const mapInput = profileSaveStage("capture.map", () => ({
      ...mapEditor.saveInput(), name: `Island ${world.seed}`, provenance: startMap?.provenance,
      source: toEditorMap(startMap, islandChoice, world.seed).source, savedAt: gameNow()
    }));
    const runtime = profileSaveStage("capture.runtime", () => ({ animals: animals.manager.saveState(),
      bookmarks: bookmarks.saveState(), environment: environment.saveState(),
      viewMode: renderer.getViewMode(),
      growth: growth.saveState(), felling: felling.saveState(), stone: resources.saveStoneLedger(),
      camera: { centerX, centerZ, zoom, yaw, tilt } } satisfies GameRuntimeState));
    return { player: progress, save: [world, settlementCapture.snapshot, mapInput, runtime],
      settlementText: settlementCapture.text };
  });
  const captureIsland = async () => {
    const { player: progress, save } = captureIslandInputs();
    return { ...(await createGameSave(...save)), player: progress };
  };
  const captureCurrentGame = async () => {
    const save = await captureIsland();
    return islandTravel ? islandTravel.attach(save) : save;
  };
  devHooks.captureReplayBaseline = captureIsland;
  const savedGames = createSettlementSaveController({
    i18n,
    store: saveStore,
    captureGame: () => {
      const captured: CapturedGame = { ...captureIslandInputs(), archipelago: islandTravel?.groupForSave(),
        campaignRun: islandTravel?.campaignRun() };
      return { ...captured, ...commandLog?.capture(captured) };
    },
    captureSession: async () => {
      const save = await captureIsland();
      return islandTravel ? islandTravel.attach(save) : save;
    },
    restoreSession: async (value) => {
      if (options.handoff) {
        const outcome = await options.handoff({
          destination: { kind: "import", targetKey: "import", value },
          key: "import",
          saveDeparture: false,
          trigger: "import-game"
        });
        if (outcome.ok) return { ok: true as const };
        if (outcome.reason === "reload-required") {
          reloadPage();
          return { ok: true as const };
        }
        if (outcome.reason === "busy") return { ok: false, reason: t(SESSION_MESSAGES.common.busy) };
        if (outcome.reason === "cancelled" || outcome.reason === "stale")
          return { ok: false, reason: t(SESSION_MESSAGES.resume.importChanged) };
        return { ok: false, reason: errorMessage(outcome.error, t(LOADING_MESSAGES.failure.loadGame)) };
      }
      const result = await lifecycle.run({
        key: "import",
        run: async token => {
          // Import replaces the current branch on purpose: settle its writes, never flush it over the new game.
          await settleSaves();
          if (!token.current()) throw new SessionTransitionCancelled();
          await stageGameSession(value);
          if (!token.current()) throw new SessionTransitionCancelled();
          await saveStore.writeStartupGame(JSON.stringify(value));
          saves.stop(); reloadPage();
          return { ok: true as const };
        }
      });
      if (result.ok) return result.value;
      if (result.reason === "busy") return { ok: false, reason: t(SESSION_MESSAGES.common.busy) };
      if (result.reason === "cancelled" || result.reason === "stale")
        return { ok: false, reason: t(SESSION_MESSAGES.resume.importChanged) };
      return { ok: false, reason: errorMessage(result.error, t(LOADING_MESSAGES.failure.loadGame)) };
    },
    confirmImport: () => new Promise<boolean>(resolve => settlement?.showPopup({
      ...getImportQuestion(saveStore.location, i18n), tone: "question", actions: [
        { label: t(SESSION_MESSAGES.common.replaceCurrent), onSelect: () => resolve(true), primary: true },
        { label: t(SESSION_MESSAGES.common.cancel), onSelect: () => resolve(false) }
      ] })),
    notify: (message) => settlement?.message(message)
  });
  const idleMoments = createIdleMoments({ camera, isInteracting: () => settlement?.isInteracting() ?? false,
    isMenuOpen: settings.isMenuOpen, target: window });
  lifecycle.retainIsland(idleMoments.dispose);
  lifecycle.retainIsland(player.dispose);
  const saves = bindSettlementSaving(saving, savedGames, { idleMoment: idleMoments.whenIdle, jobs: heldJobs });
  settleSaves = savedGames.whenIdle;
  const settleStore = async () => {
    await saving.whenIdle();
    await settleSaves();
    await saveStore.whenIdle?.();
  };
  /**
   * A signed-in victory claim needs the won run on the server: the run's save (with its command log) is uploaded
   * first, so the verifier can replay the victory (campaign server part 2). It runs inside the travel transition.
   */
  const claimCampaignVictory: typeof player.claimCampaignVictory = async run => {
    if (options.economy) {
      await saving.flushTransition(() => true);
      await settleStore();
    }
    return player.claimCampaignVictory(run);
  };
  const tabResumeContext = (): TabResumeContext => ({
    accountId: cloud?.accountId ?? null,
    generation: lifecycle.generation(),
    islandId: islandTravel?.active() ?? null,
    location: saveStore.location,
    slotId: cloud?.slot.id ?? null,
    worldSeed: world.seed
  });
  const sameResumeContext = (context: TabResumeContext) =>
    sameTabResumeContext(context, tabResumeContext());
  /**
   * Home-only sessions own their whole timeline; archived islands still need the worker catch-up reload. A
   * campaign run never catches up: its resume reloads, catching up home and colonies, and the run boots at its tick.
   */
  const canRetainTimeline = () => !islandTravel?.campaignRun() && islandTravel?.groupForSave() === undefined;
  /** Finish any active bug recording before the current island is replaced or reloaded. */
  const finishIslandRecording = async () => {
    await devHooks.replayCapturePending;
    if (!settlement?.bugReplay.recording()) return;
    settlement.bugReplay.unsupported("Island change: this recording ends before the destination island loads");
    await saveStore.writeReplayReport(JSON.stringify(settlement.bugReplay.report()));
  };
  const stageSavedGameAndReload = async () => {
    await finishIslandRecording();
    const value = await saveStore.readSavedGame();
    if (!value) throw new Error(t(SESSION_MESSAGES.resume.missingSaved));
    await saveStore.writeStartupGame(JSON.stringify(value)); saves.stop(); reloadPage();
  };
  const resumeUploadState = (ran: boolean): "confirmed" | "failed" | "none" | "pending" => {
    if (!ran) return "none";
    if (saveStore.hasPendingUpload?.() === true) return "pending";
    return cloud?.status.getSnapshot()?.kind === "failed" ? "failed" : "confirmed";
  };
  const resumeAuthority = async (ran: boolean): Promise<TabResumeAuthority> => {
    if (saveStore.location === "browser") return { kind: "browser" };
    if (!cloud || !saveStore.checkAuthority)
      return { kind: "account", lease: "unknown", revision: "unknown", upload: "failed" };
    const lease = await cloud.lease.verify();
    const revision = await saveStore.checkAuthority();
    return { kind: "account", lease, revision, upload: resumeUploadState(ran) };
  };
  const background = createBackgroundSession({
    context: tabResumeContext,
    gameNow: () => settlement?.simulation.gameNow() ?? options.sessionClock(),
    i18n,
    notify: text => settlement?.message(text),
    page: window,
    pauseAutosave: paused => saving.setPaused(paused),
    reload: stageSavedGameAndReload,
    resetFrameTime,
    save: () => saving.checkpoint("hidden"),
    sameContext: sameResumeContext,
    resume: async attempt => {
      const contextChanged = !sameResumeContext(attempt.context);
      const liveNow = settlement?.simulation.gameNow() ?? attempt.gameNow;
      const hiddenSeconds = hiddenSecondsBetween(liveNow, options.sessionClock());
      const supported = canRetainTimeline();
      // Long absences and archived-island groups are prepared by the same in-page saved
      // destination boundary as travel. The worker catch-up is therefore not forced back
      // through a document reload; authority changes still use the reload reference.
      if (options.handoff && !contextChanged) {
        const authority = await resumeAuthority(attempt.save.ran);
        const authoritySafe = authority.kind === "browser" ||
          (authority.lease === "current" && authority.revision === "current");
        const decision = decideTabResume({ authority, contextChanged, hiddenSeconds,
          save: attempt.save, supported });
        if (usesSavedTabResumeHandoff({ authoritySafe, decision, handoffEnabled: true })) {
          try {
            const save = await captureCurrentGame();
            const outcome = await options.handoff({
              departure: save,
              destination: {
                kind: "saved",
                payload: save,
                targetKey: `tab-resume:${lifecycle.generation()}`
              },
              key: "tab-resume",
              saveDeparture: false,
              trigger: "tab-resume"
            });
            if (outcome.ok) return "reloaded";
            if (outcome.reason === "reload-required") {
              reloadPage();
              return "reloaded";
            }
            return "retained";
          } catch (error) {
            settlement?.message(errorMessage(error, t(SESSION_MESSAGES.background.resumeFailed)));
            return "retained";
          }
        }
      }
      const result = await lifecycle.run({
        key: "tab-resume",
        keepSession: true,
        run: async token => {
          const authority = supported && !contextChanged ? await resumeAuthority(attempt.save.ran)
            : { kind: "browser" } as const;
          if (!token.current()) throw new SessionTransitionCancelled();
          const decision = decideTabResume({ authority, contextChanged, hiddenSeconds,
            save: attempt.save, supported });
          if (decision.mode === "reload") {
            await stageSavedGameAndReload();
            return { mode: "reloaded" } as const;
          }
          if (decision.hiddenSeconds >= 0.5)
            settlement?.message(t(SESSION_MESSAGES.resume.updating));
          await settlement?.catchUp(decision.cappedSeconds);
          if (!token.current()) throw new SessionTransitionCancelled();
          heldJobs.discardHeldTime();
          resetFrameTime?.();
          return { mode: "retained" } as const;
        }
      });
      if (result.ok) return result.value.mode;
      if (result.reason === "busy") {
        settlement?.message(t(SESSION_MESSAGES.common.busy));
        return "handled";
      }
      if (result.reason === "cancelled" || result.reason === "stale") {
        settlement?.message(t(SESSION_MESSAGES.common.changedBeforeResume));
        return "handled";
      }
      throw result.error ?? new Error(t(SESSION_MESSAGES.resume.failed));
    }
  });
  lifecycle.retainIsland(background.dispose);
  const scenarioProblems = restoredGame ? [] : validateMapScenario(world);
  if (scenarioProblems.length) mapEditor.setEnabled(true);
  const resources = createIslandResources({ world, renderer, animals, felling, growth, critters,
    playerNation: options.workerNation,
    savedStone: (restoredGame?.runtime as GameRuntimeState | undefined)?.stone });
  const menuShortcuts = createMainSelectionShortcuts(viewport, options.workerNation, i18n,
    options.settings.setWorkerNation);
  const inventory = createPlayerInventoryControls({
    container: viewport, i18n,
    mapKind: () => inventoryMapKind({ adventure: settlement?.simulation.adventure(),
      colony: settlement?.simulation.colony(), scenarioKind: world.scenario?.kind }),
    setNation: options.settings.setWorkerNation,
    placeDecoration: item => settlement?.selectRoadDecoration(item), refresh: player.refreshInventory,
    recovery: {
      use: () => player.useCommanderRecovery(),
      status: () => {
        const commander = settlement?.simulation.commanderSnapshot();
        if (!commander) return null;
        return { name: commander.name, hp: commander.hp, maximum: commander.maximumHp,
          blocked: Boolean(settlement?.simulation.commanderRecoveryProblem(commander.id)) };
      }
    }
  });
  lifecycle.retainIsland(() => { inventory.dispose(); for (const shortcut of menuShortcuts) shortcut.dispose?.(); });
  const campaignSources = createCampaignDepartureSources({ economy: options.economy,
    localAllowed: options.developmentAllowed, now: options.sessionClock });
  settlement = profileStep("settlement setup", () => createIslandSettlement({
    createDebugClickModes: options.createDebugClickModes,
    createSettlementDebugActions: options.createSettlementDebugActions,
    developmentAllowed: options.developmentAllowed,
    inputAllowed: options.inputAllowed,
    simulationHeld: options.simulationHeld,
    trafficWear: graphicsOptions.quality.trafficWear,
    clockStart: options.clockStart ?? options.sessionClock(),
    scenarioDraft: scenarioProblems.length > 0,
    unlockAllBuildings: options.params.unlockAll,
    playerNation: options.workerNation,
    world,
    renderer,
    canvas,
    viewport,
    workerFrames: workers.frames,
    initialState: restoredGame?.settlement,
    afterTick: saves.afterTick,
    canCommand: () => !commandsFrozen,
    heldJobs,
    i18n,
    checkSaveEvents: saves.checkEvents,
    ...colonySettlementOptions(restoredGame, colonyArrival, player.talentModifiers().colonyStartSettlers,
      islandDifficulty(restoredGame, colonyVisit)),
    getIslandTravel: () => islandTravel,
    ...campaignRunOptions(restoredGame?.campaignRun, outcome => islandTravel?.recordCampaignOutcome(outcome)),
    market: options.market,
    campaign: campaignSources,
    player,
    saveBeforeMarketMove: () => saving.flush("manual"),
    onVisitorLoaded: goods => islandTravel?.receiveAbroad(goods),
    onTroopsReturned: troops => islandTravel?.receiveReturnedTroops(troops),
    ...resources.hooks,
    onSettings: settings.toggle,
    menuShortcuts,
    onOpenInventory: inventory.open,
    onMinimap: () => {
      minimapShown = !minimapShown;
      minimap.setVisible(minimapShown);
      settingsStorage.writeMinimap(minimapShown);
    },
    pickPlacementPreview: buildOverlay.pickPreview,
    getMinimapVisible: () => minimapShown,
    isBuildingDetailed: building => renderer.isBuildingDetailed?.(settlementBuildingFrameId(building.uid)) ??
      isBuildingDetailed(!graphicsOptions.quality.liteGround, camera.zoom),
    shipObservation,
    onFocusShip: (ship) => {
      observation.follower.stop();
      camera.centerX = ship.x;
      camera.centerZ = ship.z;
    },
    onFocusBuilding: (building) => {
      camera.centerX = building.x;
      camera.centerZ = building.z;
    }
  }));
  options.onCreated(settlement);
  commandLog = createCommandLogSession(settlement, heldJobs);
  // A confirmed account preference may be newer than the restored island. Reconcile through the
  // existing recorded command after binding the log, so the baseline is never silently rewritten.
  const confirmedNation = options.economy?.startNation;
  if (confirmedNation && settlement.simulation.playerNation() !== confirmedNation) {
    if (!settlement.simulation.setPlayerNation(confirmedNation)) throw new Error("Nation replacement failed");
  }
  // GS2: the island adopts the lease's game rules the same way, as a recorded command (plan §12.1); a game without
  // a lease adopts the browser's session rules (GS3a), which are undefined (nothing adopted) for today's settings.
  // PROG: rules that switch talents back on need the applied ranks again (plan §9.1).
  const sessionRules = cloud ? cloud.lease.gameRules() : options.browserSessionRules;
  if (adoptSessionRules(settlement.simulation, sessionRules)) player.syncTalentRanks();
  const { economy } = options;
  let homeClaims: ReturnType<typeof createHomeClaimSubmitter> | undefined;
  islandTravel = createArchipelagoSession({ capture: captureIsland,
    onReliefReturned: player.returnReliefQuests,
    acceptClosedRoadDecorationReturns: player.acceptClosedRoadDecorationReturns,
    campaignRun: restoredGame?.campaignRun,
    sourceVersion: SOURCE_VERSION,
    acceptArchivedProgress: player.acceptArchivedProgress,
    prepareArchivedProgress: player.prepareArchivedProgress,
    claimAdventure: economy && ((island, bonus) => economy.claimAdventure({ adventureId: island.id, bonus,
      difficulty: island.difficulty, seed: island.seed })),
    claimCampaignVictory,
    reportCampaignEnd: economy?.endCampaignAttempt,
    onCampaignEndReported: (run, report) => keepCampaignEndNotice(run, report),
    startCampaignAttempt: economy?.startCampaignAttempt,
    flushHomeClaims: () => homeClaims?.flush() ?? Promise.resolve(),
    handoff: options.handoff,
    leaveWithoutHome: saveStore.endRunWithoutHome && (async (progress, ended) => {
      await finishIslandRecording();
      // Saving holds while the slot drops the run: a cloud slot that cannot store the end keeps playing the map.
      saving.setSuspended(true);
      await saving.whenIdle();
      try {
        await saveStore.endRunWithoutHome!(progress);
      } catch (error) {
        saving.setSuspended(false);
        throw error;
      }
      saves.stop();
      rememberTitleLanding(ended);
      location.assign(titlePageUrl(location.href));
    }),
    i18n,
    initial: initialArchipelago,
    notify: text => settlement?.message(text), player: player.progress, onIslandEnded: saving.request,
    settle: () => settleStore(),
    transition: lifecycle,
    reload: async () => {
      await finishIslandRecording();
      saves.stop();
      reloadPage();
    },
    simulation: settlement.simulation, store: saveStore });
  lifecycle.retainIsland(islandTravel.dispose);
  // BR4: a campaign run's stored end (path kept, ending reached) is told once the home island is on screen.
  if (!restoredGame?.campaignRun && !settlement.simulation.colony() && !settlement.simulation.adventure())
    void announceCampaignEndNotice({ i18n, notify: text => settlement?.message(text),
      openRepositories: campaignSources.openRepositories });
  reliefIslandPort = createReliefIslandPort(islandTravel);
  devHooks.applyExpeditionTheme = async theme => {
    if (!theme || (!settlement!.simulation.colony() && !settlement!.simulation.adventure())) return;
    if (!(await savedGames.saveWhenIdle("Updating the expedition theme…"))) return;
    try {
      const source = await saveStore.readSavedGame();
      if (!source) throw new Error("No expedition save is available.");
      const next = await rethemeExpeditionInWorker(source, theme);
      await savedGames.importJson(JSON.stringify(next));
    } catch (error) { settlement?.message(errorMessage(error, "Unable to change theme.")); }
  };
  lifecycle.retainIsland(startScriptUi(settlement, islandTravel, {
    audioUploads: assetId => world.audioAssets?.find(asset => asset.id === assetId), camera: options.camera, i18n,
    inventory,
    language: menuShortcuts.find(shortcut => shortcut.id === "language"), player, settings: options.settings }));
  if (isTestPlay(location.search)) lifecycle.retainIsland(startTestPlayLog(settlement.simulation));
  if (economy?.claimHomeReward) {
    homeClaims = createHomeClaimSubmitter({ claim: economy.claimHomeReward,
      grantExperience: player.grantRewardExperience,
      rewardsOn: () => settlement!.simulation.effectiveGameRules().rewards, simulation: settlement.simulation });
    lifecycle.retainIsland(homeClaims.dispose);
  }
  lifecycle.retainIsland(finishIslandSettlement(settlement, savedGames, options, player.monumentBonusActive()));
  return {
    capture: async () => {
      const save = await captureIsland();
      return islandTravel ? islandTravel.attach(save) : save;
    },
    claimServerLevel: () => player.claimServerLevel(),
    dispose: () => {
      commandLog?.dispose();
      saves.stop();
      settlement?.dispose();
      lifecycle.dispose();
    },
    disposeIsland: async () => {
      try { await finishIslandRecording(); }
      finally {
        commandLog?.dispose();
        saves.stop();
        settlement?.dispose();
        lifecycle.disposeIsland();
      }
    },
    getTravel: () => islandTravel,
    level: () => player.accountLevel(),
    retain: (dispose: () => void) => { lifecycle.retainIsland(dispose); },
    retainIsland: (dispose: () => void) => { lifecycle.retainIsland(dispose); },
    retainPage: (dispose: () => void) => { lifecycle.retainPage(dispose); },
    settle: settleStore,
    transition: lifecycle
  };
};
import { SOURCE_VERSION } from "virtual:source-version";

/** TRG9: the island's map-script presentation (UI targets, highlights, mails, multiboards, colony-lost notice). */
const startScriptUi = (
  settlement: IslandSettlement, travel: ArchipelagoSession | undefined,
  parts: Pick<IslandScriptUiOptions, "audioUploads" | "camera" | "i18n" | "inventory"> & {
    language?: WindowShortcut; player: PlayerSession; settings: ReturnType<typeof createSettingsPanel>;
  }
) => {
  const conquered = () => (travel?.colonies() ?? []).filter(colony => colony.status === "conquered")
    .map(colony => ({ id: colony.expeditionId, name: colony.island.name, notice: customExpiryNotice(colony),
      ore: colony.island.ore }));
  const ui = createIslandScriptUi({
    audioUploads: parts.audioUploads, camera: parts.camera, colonies: travel && conquered, deliverMails: parts.player.deliverScriptMails,
    homeSeed: parts.player.progress().seed, i18n: parts.i18n, inventory: parts.inventory,
    islandName: () => travel?.colonies().find(colony => colony.expeditionId === travel.active())?.island.name ?? "",
    language: { close: () => parts.language?.close?.(), open: () => parts.language?.open() },
    settings: { close: parts.settings.closeSettings, open: parts.settings.openSection },
    showPopup: settlement.showPopup, simulation: settlement.simulation, windows: settlement.scriptWindows
  });
  return ui.dispose;
};
