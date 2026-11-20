import type { GameSettings } from "../../../island-of-settlers-shared/src/game-settings/game-settings";
import { createCamera } from "../render-common/camera-state";
import type { SharedContentBuilders } from "../render-common/content-builders";
import { installGpuMemoryLedger } from "../render-common/gpu-memory-ledger";
import {
  profileAsync,
  profileFirstFrame,
  profileStep,
  reportLoadProfile
} from "../render-common/load-profile";
import { createHorseTrial } from "../render-common/mounts/horse-trial";
import { createPresentationScheduler } from "../render-common/presentation-scheduler";
import {
  getSeasonClimate,
  resolveSeasonWeights,
  type SeasonClimate
} from "../render-common/seasonal-appearance/season-weights";
import { playerColorFromHex } from "../render-common/settlement/player-color";
import { createStressEntities } from "../render-common/stress/stress-world";
import type { PaintedTexture } from "../render-common/trees/atlas-canvas";
import { randomWorkerAppearances } from "../render-common/workers/worker-appearance";
import { getWorkerColorHex } from "../render-common/workers/worker-colors";
import { createWorkerGroup } from "../render-common/workers/worker-group";
import type { WorkerNation } from "../render-common/workers/worker-unit";
import { createExplorationFogAdapter } from "../renderers/three/exploration-fog";
import { setExplorationPrewarm } from "../renderers/three/exploration-prewarm-mode";
import { setFarPropsMode } from "../renderers/three/worker-far-props-mode";
import { setCrowdMode } from "../renderers/three/worker-gpu-mode";
import { setWorkerRingMode } from "../renderers/three/worker-ring-mode";
import { START_SETTLERS } from "../shared/balance/population";
import { DEFAULT_WORLD_OPTIONS } from "../shared/world/generation/generate-world";
import { DEFAULT_SUN } from "../shared/world/lighting";
import type { WorldData } from "../shared/world/world-data";
import { startPlayer, startScrollUrl } from "./account/account-boot";
import { createAccountSession } from "./account/account-session";
import type { AppParams } from "./app-params";
import { createExplorationThunderAudio, type ExplorationWeatherAudioSink } from "./audio/exploration-weather";
import { createBuildOverlay } from "./build-overlay/build-overlay";
import { noSpaceMessage } from "./build-overlay/no-space-notice";
import { PREVIEW_CAP } from "./build-overlay/placement-previews";
import { createCinematicEffects } from "./campaign/cinematics/cinematic-effects";
import {
  type CinematicDevReview, type CinematicRuntime,
createCinematicRuntime} from "./campaign/cinematics/cinematic-runtime";
import { endCloudSession } from "./cloud/cloud-boot";
import { bindCloudSession } from "./cloud/cloud-ui";
import type { SessionClock } from "./cloud/session-clock";
import { createIslandCommander } from "./commander-control/integration";
import { closeAllLazyReactWindows } from "./components/lazy-react-window";
import { createExternalStore } from "./components/ui-store";
import type { DevelopmentAccess } from "./development-access";
import type { DevelopmentModules } from "./development-modules";
import { createEnvironmentController } from "./environment-controller";
import { createExplorationInputGate } from "./exploration/input";
import { createIslandExploration } from "./exploration/integration";
import { connectFlyers } from "./flyer-sheet";
import { browserSessionRules } from "./game-settings/browser-session-rules";
import { coordinatorSaving } from "./game-settings/session-mode";
import { createHudVisibilityInput } from "./hud-visibility-input";
import { type IslandAssets, loadIslandAssets, loadRenderer } from "./island-assets";
import { toIslandBuildGroup } from "./island-build-keys";
import { createForestFrameUpdates } from "./island-forest-frames";
import type { IslandHandoffRequest, IslandHandoffResult } from "./island-handoff";
import { createIslandMapEditor } from "./island-map-editor";
import { createIslandObservation, type ObservedShips } from "./island-observation";
import { createIslandPregeneration } from "./island-pregeneration";
import { createIslandSettings } from "./island-settings";
import { startIslandSettlement } from "./island-settlement-boot";
import { createIslandWildlife } from "./island-wildlife";
import { prepareIslandWorld, toIslandCacheGroup } from "./island-world-preparation";
import { LOADING_MESSAGES } from "./loading-messages";
import type { createLoadingScreen } from "./loading-screen";
import { showLoadingFailure } from "./loading-screen";
import { languagePreference } from "./localization/language-store";
import { createInGameDecorationPreview } from "./map-editor/in-game-decoration-preview";
import { getMapIslandChoice, type StartMap,toMapCacheKey } from "./map-editor/map-startup";
import { createScenarioRenderPreview } from "./map-editor/scenario-render-preview";
import { toWorldOptions } from "./map-generator/helpers";
import { createMapPanelContent, describeCurrentIsland } from "./map-generator/panel";
import { createMinimap } from "./minimap/minimap";
import { mountNotificationHost } from "./notifications/host";
import { reloadPage } from "./page-reload";
import { createPoolBuilders, type IslandBuilders } from "./pool-builders";
import { createRenderBudget } from "./render-budget/render-budget";
import { startRenderLoop } from "./render-loop";
import type { OfflineCloud } from "./save-slots/offline-cloud";
import { createSaveCoordinator } from "./save-store/save-coordinator";
import { createSaveStatus } from "./save-store/save-status";
import type { SaveStore } from "./save-store/save-store";
import { saveScreenshot } from "./screenshot/capture";
import { createScreenshotInput } from "./screenshot/input";
import { isTestPlay } from "./script/test-play/helpers";
import { createCameraBookmarkControls } from "./settings/camera/bookmark-controls";
import { chooseGraphics } from "./settings/choose-graphics";
import { createGameSectionOptions } from "./settings/game-section/game-section-options";
import {
  applyResolution,
  createResolutionSession,
  readGraphicsOptions,
  settingsStorage
} from "./settings/graphics-settings";
import { getShownSeasonPhase, seasonalAppearance } from "./settings/seasonal-appearance/store";
import { prewarmCoastalGeometry } from "./settlement/coastal-geometry-prewarm";
import { loadComputerNationNavigation } from "./settlement/computer-nation-navigation";
import { createFlagDemo } from "./settlement/flag-demo";
import { openGameDatabase } from "./settlement/game-database";
import type { GameRuntimeState } from "./settlement/game-session";
import type { IslandSettlement } from "./settlement/island-settlement";
import type { MilitaryAiDebug } from "./settlement/military-ai-debug";
import type { MilitaryDebugControls } from "./settlement/military-debug/helpers";
import { placementRevisionKey } from "./settlement/placement-check";
import { setShipIconNation } from "./settlement-ui/icons";
import { expeditionKindOf, restorePendingGame } from "./startup-game";
import { exposeProfileDetails, readFrameProfileDetails } from "./stats-overlay/frame-profile-details";
import { STATS_MESSAGES } from "./stats-overlay/messages";
import { createStatsOverlay } from "./stats-overlay/stats-overlay";
import { createViewModeInput } from "./view-mode-input";
import { createWeatherControls } from "./weather-controls";
import { connectWorkerDebugHooks } from "./worker-debug-hooks";
import { createWorkerInput } from "./worker-input";
import type { WorkerPool } from "./worker-pool";
import { followWorldEnvironment, isWorldEnvironmentLocked } from "./world-environment-follow";

type GraphicsOptions = ReturnType<typeof readGraphicsOptions>;
type ResolutionSession = ReturnType<typeof createResolutionSession>;
type StartPlayerResult = Awaited<ReturnType<typeof startPlayer>>;
type GraphicsProbe = Awaited<ReturnType<typeof chooseGraphics>>;
type RestoreResult = Awaited<ReturnType<typeof restorePendingGame>>;

/** The island's season look from the shown global phase (summer while this browser ignores it). */
const getShownSeasonWeights = (climate: SeasonClimate) => {
  const snapshot = seasonalAppearance.getSnapshot();
  const mode = snapshot.ignoreGlobalWinter ? undefined : snapshot.season.mode;
  return resolveSeasonWeights(getShownSeasonPhase(snapshot), climate, mode);
};

/** Apply the saved Daylight choice after a restored runtime environment has loaded. */
const applyDayMode = (
  environment: ReturnType<typeof createEnvironmentController>,
  world: WorldData,
  theme: string
) => {
  environment.setSnowy(theme === "snowy" || world.expeditionTheme === "winter");
  const climate = getSeasonClimate(world.expeditionTheme, theme === "snowy");
  environment.setSeasonSource(() => getShownSeasonWeights(climate));
  environment.setDayMode(settingsStorage.readDayMode());
};

let thunderPlayer: () => void = () => {};
const playThunder = () => thunderPlayer();

export interface PreparedIslandContent {
  assets: IslandAssets;
  builders?: IslandBuilders;
  world: WorldData;
}

export interface IslandRuntimeOptions {
  /** Page-level assets; reused across an in-page island switch. */
  assets?: IslandAssets;
  canvas: HTMLCanvasElement;
  cloud: StartPlayerResult["cloud"];
  developmentAccess: DevelopmentAccess;
  /** Local dev/test hooks or the verified admin module set; absent in the production player entry. */
  developmentModules?: DevelopmentModules;
  fog: boolean;
  /** The deployment's game settings known at boot (GS3a); null = today's game. */
  gameSettings: GameSettings | null;
  /** A signed-in offline player's server saves (OFFLINE-CLOUD); null keeps the slots in this browser. */
  offlineCloud: OfflineCloud | null;
  graphics: GraphicsProbe;
  graphicsOptions: GraphicsOptions;
  glDebug: { showGlDebugView: (viewport: HTMLElement, gl: WebGL2RenderingContext, size: number) => void } | null;
  /** In-page island replacement passed to travel and replacement controls. */
  handoff?: (request: IslandHandoffRequest) => Promise<IslandHandoffResult<unknown, unknown>>;
  /** Standalone map editor: no settlement and the authoring panel opens on arrival. */
  editorOnly?: boolean;
  /** Full-generation replacement; absent keeps the validated reload path. */
  onRecreate?: (choice: import("./map-generator/helpers").IslandChoice, seed?: number) => void;
  /** Editor replacement map; absent keeps the validated reload path. */
  onGenerateMap?: (choice: import("./map-generator/helpers").IslandChoice, seed?: number) => void;
  /** Editor map-library load; absent keeps the validated `?map=` reload. */
  onLoadMap?: (slotId: string) => boolean | Promise<boolean>;
  /** Apply Detail without a page reload; absent keeps the setting's reload path. */
  applyDetail?: import("./settings/graphics-settings").ApplyDetail;
  /** Apply Reveal Ore without a page reload; absent keeps the setting's reload path. */
  setRevealOre?: (revealed: boolean) => void;
  /** False when the handoff coordinator owns the loading-screen lifetime. */
  hideLoadingOnReady?: boolean;
  loading: ReturnType<typeof createLoadingScreen>;
  params: AppParams;
  playerAccount: StartPlayerResult["account"];
  playerNation: WorkerNation;
  /** Full-slot write of a locally caught-up save; awaited before the first ready frame. */
  pendingSave?: Promise<void>;
  pool: WorkerPool;
  prepared?: PreparedIslandContent;
  resolution: ResolutionSession;
  restore: RestoreResult;
  revealOre: boolean;
  saveStore: SaveStore;
  sessionClock: SessionClock;
  settlementEnabled: boolean;
  shared: SharedContentBuilders;
  foliage: Promise<PaintedTexture>;
  startMap: StartMap | null;
  startedAt: number;
  toolRun: boolean;
  /** The global season can show snow: the GPU snow path is armed (T1). */
  seasonSnow?: boolean;
  /** Cached cosmetic season, independent of the world's authored climate and simulation. */
  visualWinter?: boolean;
  viewport: HTMLElement;
}

/**
 * Builds one island runtime on the page shell: world/content, renderer, controls, wildlife, UI,
 * settlement, exploration and the render loop. The caller owns page services and must dispose the
 * previous runtime before starting another one.
 */
// oxlint-disable-next-line max-lines-per-function -- one factory owns the island runtime wiring
export const startIslandRuntime = async (options: IslandRuntimeOptions) => {
  const {
    canvas, cloud, developmentAccess, developmentModules, editorOnly, fog, foliage, glDebug, graphics,
    graphicsOptions, handoff, hideLoadingOnReady, loading, params, pendingSave, playerAccount, playerNation,
    pool, resolution, restore, revealOre, saveStore, sessionClock, settlementEnabled, shared, startedAt,
    startMap, toolRun, viewport
  } = options;
  /** Debug simulation hooks are local-dev/test or admin only; the player build has no factories. */
  const debugHooksAllowed = Boolean(developmentModules);
  const { colonyArrival, colonyVisit, restoredGame } = restore;
  const gameLoadError = restore.gameLoadError;
  const savedWorld = options.prepared?.world ?? colonyArrival?.world ?? startMap?.loaded?.world ?? null;
  const mapKey = colonyArrival?.mapKey ?? toMapCacheKey(params.map, startMap?.loaded ?? null);
  const island = toIslandCacheGroup(params, fog, revealOre, mapKey, playerNation);
  const buildingNation = settlementEnabled ? playerNation : undefined;
  const [assets, world, rendererModule] = await Promise.all([
    profileAsync("load island assets", async () => options.assets ?? loadIslandAssets(pool, foliage)),
    profileAsync("generate content (workers, wall)", async () => savedWorld ??
      pool.generateWorld({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(params.island), nation: playerNation,
        seed: params.seed }, island)),
    profileAsync("load renderer chunk", () => loadRenderer(params.renderer))
  ]);
  rendererModule.prefetch?.({
    buildingNation,
    builders: shared,
    foliageAtlas: foliage,
    quality: graphicsOptions.quality,
    sun: DEFAULT_SUN
  });
  const { animalModels, flyerAtlas, foliageAtlas, materials, microDetail, rockTexture } = assets;
  let settlement: IslandSettlement | undefined;
  let flagDemo: ReturnType<typeof createFlagDemo> | undefined;
  let renderLoop: ReturnType<typeof startRenderLoop> | undefined;
  let settlementSession: ReturnType<typeof startIslandSettlement> | undefined;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  const arrivingIsland = colonyArrival?.record.island;
  const restoredIsland = restoredGame?.settlement.adventure?.island ?? restoredGame?.settlement.colony?.island;
  const expeditionIsland = arrivingIsland ?? restoredIsland;
  world.expeditionKind = expeditionKindOf(arrivingIsland, restoredGame);
  world.expeditionTheme = expeditionIsland?.theme;
  world.adventureTheme = world.expeditionKind === "adventure" ? expeditionIsland?.theme : undefined;
  prepareIslandWorld(world, params, fog, revealOre, settlementEnabled ? playerNation : undefined);
  if (settlementEnabled) await loadComputerNationNavigation(world, playerNation);
  setShipIconNation(playerNation);
  const stress = params.stress ? createStressEntities(world) : null;
  const explorationFog = createExplorationFogAdapter(world);
  await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.building));
  // Builds follow the prepared world content, not the world-generation cache group (which carries
  // the URL/map slot): a generated island and the same island loaded from a save share them.
  const builders = options.prepared?.builders ??
    createPoolBuilders(pool, shared, world, toIslandBuildGroup(world));
  const navBuild = builders.islandNav();
  // The standalone editor is a map-authoring surface: it must not spawn settlers on the ground.
  const workerAppearances = randomWorkerAppearances(
    settlementEnabled ? START_SETTLERS : 0,
    playerNation
  );
  const horseTrial = params.horse ? createHorseTrial(world) : null;
  let soundscape: ReturnType<typeof createIslandWildlife>["sound"]["soundscape"] | undefined;
  let thunderSink: ReturnType<typeof createExplorationThunderAudio> | null = null;
  const explorationAudio: ExplorationWeatherAudioSink = {
    dispose: () => { thunderSink?.dispose(); thunderSink = null; },
    play: request => {
      const context = soundscape?.audioContext();
      const destination = soundscape?.environmentBus();
      if (!thunderSink && context && destination)
        // The environment bus already carries master × environment volume; do not apply it twice.
        thunderSink = createExplorationThunderAudio({ context, destination,
          enabled: soundscape!.audioEnabled, maxVoices: 2 });
      return thunderSink?.play(request) ?? false;
    },
    stats: () => thunderSink?.stats() ?? { bufferReady: false, disposed: false, maxVoices: 2, played: 0,
      rejected: 0, voices: 0 }
  };
  // Before the renderer's context exists: the ledger sees every allocation (R01, ?passes=1).
  if (params.passProfile) installGpuMemoryLedger();
  setCrowdMode(params.crowdMode);
  setExplorationPrewarm(params.explorationPrewarm);
  setFarPropsMode(params.farPropsMode);
  setWorkerRingMode(params.workerRingMode);
  /** Leftover-time presentation work (R23): the renderer queues GPU warm-up, the loop runs it. */
  const presentation = createPresentationScheduler();
  const renderer = await profileAsync("build renderer", () =>
    rendererModule.create({
      ambientOcclusion: params.ambientOcclusion ?? undefined,
      animals: animalModels,
      bloom: params.bloom ?? undefined,
      buildingNation,
      builders,
      explorationAudio,
      explorationFog,
      canvas,
      characterDetail: graphicsOptions.characterDetail,
      colorOutput: params.colorOutput ?? undefined,
      colorTone: settingsStorage.readTone(),
      flyerAtlas,
      foliageAtlas,
      groundShader: graphicsOptions.groundShader,
      highlights: settingsStorage.readHighlights(),
      materials,
      microDetail,
      mounts: horseTrial?.appearances, onLightning: playThunder,
      presentation,
      quality: params.shadowCascades === null
        ? graphicsOptions.quality
        : { ...graphicsOptions.quality, shadowCascadesFps: params.shadowCascades },
      rendererMode: params.renderer,
      resolution: resolution.state.profile,
      spikeNoOffscreen: params.spikeNoOffscreen,
      sceneDepth: params.sceneDepth,
      sceneTarget: params.sceneTarget ?? undefined,
      rockTexture,
      stress,
      workers: workerAppearances,
      seasonSnow: options.seasonSnow,
      visualWinter: options.visualWinter,
      waterReflections: params.waterReflections ?? undefined,
      world
    })
  );
  pool.disposeWhenIdle();
  glDebug?.showGlDebugView(
    viewport,
    renderer.gl,
    graphicsOptions.quality.groundTileSize
  );
  const workerColor = settingsStorage.readWorkerColor();
  renderer.setWorkerColor(getWorkerColorHex(workerColor));
  const view = params.view ?? { x: world.start.x, z: world.start.z, zoom: 1 };
  const camera = createCamera(view.x, view.z, view.zoom);
  // Map defaults seed only a new settlement; loading a game keeps its runtime environment authoritative.
  const environmentDefaults = restoredGame ? undefined : world.environmentDefaults;
  const environment = createEnvironmentController(world.sun, {
    hour: environmentDefaults?.hour ?? params.hour,
    rain: environmentDefaults?.rain ?? params.rain,
    seed: world.seed,
    snow: environmentDefaults?.snow ?? params.snow,
    cycling: environmentDefaults?.cycling ?? false
  });
  const weather = createWeatherControls(environment, () => isWorldEnvironmentLocked(settlement?.simulation));
  const viewMode = createViewModeInput(renderer);
  const hudVisibility = createHudVisibilityInput();
  const overlay = createStatsOverlay(viewport, {
    detail: graphics.detail,
    gl: renderer.gl,
    help: settlementEnabled ? STATS_MESSAGES.help.settlement : undefined,
    i18n: languagePreference.i18n,
    visible: settingsStorage.readInfoBox(),
    onVisibilityChange: settingsStorage.writeInfoBox
  });
  const minimapShown = settingsStorage.readMinimap();
  const minimap = profileStep("minimap setup", () => createMinimap({
    camera,
    viewport,
    showTerritoryToggle: settlementEnabled,
    visible: minimapShown,
    world,
    getSettlement: () =>
      settlement && {
        buildings: settlement.simulation.buildings(),
        roads: settlement.roads.segments(),
        territory: settlement.simulation.territory(),
        playerColor: playerColorFromHex(getWorkerColorHex(settingsStorage.readWorkerColor()))
      }
  }));
  const buildOverlay = profileStep("placement overlay setup", () => createBuildOverlay({
    camera,
    previewCap: graphicsOptions.quality.liteGround ? PREVIEW_CAP.minimal : PREVIEW_CAP.high,
    renderer,
    viewport,
    world,
    getCursorGhost: () => settlement?.controls.ghost() ?? null,
    getNation: () => settlement?.simulation.playerNation() ?? "roman",
    getOwnership: () => settlement?.simulation.territory().owned,
    getPlacement: () => {
      const controls = settlement?.controls;
      const typeId = controls?.selectedBuilding();
      return controls && typeId != null ? { rotation: controls.rotation(), typeId } : null;
    },
    getPlacementRevision: () => (settlement ? placementRevisionKey(settlement.simulation) : ""),
    onNoSpace: (typeId) => settlement?.notice(noSpaceMessage(typeId, settlement.simulation.playerNation()), true),
    showsMineLand: () => settlement?.controls.selectedSurvey() === "Geologist",
    validatePlacement: (typeId, x, z, rotation) =>
      settlement ? settlement.simulation.validatePlacement(typeId, x, z, rotation) : "No settlement"
  }));
  await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.placingAnimals));
  const nav = await profileAsync("wait for animal nav", () => navBuild);
  const workers = createWorkerGroup(world, nav, workerAppearances, !settlementEnabled);
  /** The first worker: the one the critters watch (absent in the standalone editor). */
  const workerNation = workers.units[0]?.frame.nation ?? playerNation;
  const workerInput = createWorkerInput({
    enabled: () => !settlementEnabled,
    canBoxSelect: () => !settlementEnabled && !mapEditor.isToolActive(),
    canvas,
    group: workers,
    renderer,
    viewport
  });
  connectWorkerDebugHooks(workers, renderer, world);
  const islandChoice = getMapIslandChoice(startMap, params.island);

  const { animals, birds, butterflies, critters, critterSetting, dispose: disposeWildlife, felling, growth, homes, sound } = createIslandWildlife({
    camera, environment, minimap, nav, navDebug: params.navDebug, renderer, restoredGame, startMap, viewport,
    workers, world, getSettlement: () => settlement
  });
  thunderPlayer = sound.playThunder;
  soundscape = sound.soundscape;
  applyDayMode(environment, world, islandChoice.theme);
  const mapEditor = createIslandMapEditor({ animals, builders, critters, felling, growth, homes, islandChoice, minimap,
    renderer, startMap, viewport, workers, world, getSettlement: () => settlement,
    loadMap: options.onLoadMap, onGenerateMap: options.onGenerateMap });
  let mapEditorVisible = false;
  const stopMapEditorVisibility = mapEditor.onEnabledChange(visible => { mapEditorVisible = visible; });
  const mapPanel = createMapPanelContent(
    describeCurrentIsland(islandChoice, world), languagePreference.i18n, options.onRecreate
  );
  const sceneReplayRuntime = developmentModules?.createSceneReplayRuntime?.({
    nation: playerNation, renderer, world,
    getWorkerColor: () => getWorkerColorHex(settingsStorage.readWorkerColor())
  });
  void sceneReplayRuntime?.resume().catch(error => settlement?.message(String(error)));
  const developmentTools = developmentAccess.allowed
    ? developmentModules?.createIslandDevelopmentTools?.({
        access: developmentAccess, expeditionTheme: expeditionIsland?.theme, getSettlement: () => settlement,
        i18n: languagePreference.i18n, saveStore, sceneReplay: sceneReplayRuntime,
        settlementEnabled, world
      })
    : undefined;
  // Tool runs keep saving on tab hide only (no interval), as before; automatic saving off ignores key events.
  const saveStatus = createSaveStatus();
  // SAVE-SLOTS: the localStorage fallback holds no slot copies, so automatic saving stays on there (rev I12).
  const browserBackend = (await openGameDatabase()).backend;
  const saving = settlementEnabled ? createSaveCoordinator({
    ...coordinatorSaving(options.gameSettings, toolRun, browserBackend, Boolean(cloud)),
    status: saveStatus }) : null;
  // An admin play-test never writes a save: the tested map must not replace the browser's own game.
  if (isTestPlay(location.search)) saving?.stop();
  /** Settings > Account: Log out and Export account save first (once the settlement's save controller exists). */
  const leaveToStart = () => location.assign(startScrollUrl(location.href));
  const accountSession = playerAccount ? createAccountSession({ leave: leaveToStart, player: playerAccount,
    releaseSession: cloud ? () => endCloudSession(cloud) : undefined, saving }) : null;
  // GS3b/SAVE-SLOTS: Exit game, Save and Load wherever a title page exists (never in tool runs).
  const gameSection = settlementEnabled && !toolRun ? createGameSectionOptions({
    account: playerAccount, backend: browserBackend, cloud, container: viewport, i18n: languagePreference.i18n,
    offlineCloud: options.offlineCloud, place: () => startMap?.loaded?.meta.name, saving,
    settings: options.gameSettings
  }) : undefined;
  const observed: ObservedShips = { ships: [] };
  const { observation, shipObservation } = createIslandObservation({ camera, canvas, observed, renderer, viewport,
    workers, world, getSettlement: () => settlement });
  const bookmarks = createCameraBookmarkControls({
    camera, initial: (restoredGame?.runtime as GameRuntimeState | undefined)?.bookmarks,
    mapSize: [world.cellsX, world.cellsZ],
    getViewMode: () => renderer.getViewMode(), onRestore: observation.follower.stop,
    setViewMode: mode => renderer.setViewMode(mode)
  });
  const militaryDebug = createExternalStore<MilitaryDebugControls | null>(null);
  const militaryAiDebug = createExternalStore<MilitaryAiDebug | null>(null);
  const historicalBenchmark = developmentModules?.createMilitaryBenchmarkWindow?.(viewport);
  const economyAiWindow = developmentModules?.createEconomyAiWindow?.({
    renderer, viewport, world, getSimulation: () => settlement?.simulation
  });
  const explorationGate = createExplorationInputGate();
  /** CIN3 campaign cinematics; created once the possessed/commander views exist (they are suspended by it). */
  let cinematics: CinematicRuntime | undefined;
  const renderBudget = createRenderBudget({
    decoration: critterSetting, quality: graphicsOptions.quality, renderer, resolution: resolution.state,
    settings: settingsStorage.readAdaptivePerformance(),
    getView: () => commanderControl?.owns() || exploration?.controllerInputEnabled() === false
      ? "fps" : renderer.getViewMode(),
    saveSettings: settingsStorage.writeAdaptivePerformance
  });
  const settings = createIslandSettings(viewport, {
    i18n: languagePreference.i18n,
    account: accountSession?.settings, applyResolution: mode => { applyResolution(resolution, mode); },
    bookmarks, budget: renderBudget.controls, camera, critters: critterSetting.enabled,
    debugGroups: developmentTools && historicalBenchmark && economyAiWindow
      ? developmentTools.debugGroups({ benchmarkTool: historicalBenchmark.tool,
        economyAiTool: economyAiWindow.tool, militaryAiDebug, militaryDebug })
      : [],
    detail: graphics.detail, development: Boolean(developmentTools), fog, game: gameSection?.options, infoTool: overlay.tool, loading, map: mapPanel,
    seasonalAdmin: developmentAccess.reason === "admin",
    minimap, observation,
    recommended: graphics.recommended, renderer, resolution: resolution.mode, revealOre,
    sound: sound.controls, weather, workerColor, workerNation, workers, world,
    getSettlement: () => settlement, setCritters: critterSetting.set, toggleCinematic: viewMode.toggle,
    applyDetail: options.applyDetail, setRevealOre: options.setRevealOre
  });
  if (editorOnly) mapEditor.setEnabled(true);
  const editorPreview = editorOnly ? createScenarioRenderPreview(world, mapEditor) : undefined;
  const inGameDecorations = createInGameDecorationPreview(mapEditor);
  if (settlementEnabled && saving) {
    settlementSession = startIslandSettlement({
      animals, bookmarks, economy: cloud?.economy, buildOverlay, camera, canvas, awayNotice: restore.awayNotice,
      browserSessionRules: browserSessionRules(options.gameSettings, toolRun), cloud: cloud ?? undefined, clockStart: restore.savedAt, colonyArrival, colonyVisit, critters,
      createDebugClickModes: developmentModules?.createDebugClickModes,
      createMilitaryAiDebug: developmentModules?.createMilitaryAiDebug,
      createSettlementDebugActions: developmentModules?.createSettlementDebugActions,
      developmentAllowed: debugHooksAllowed, developmentTools, environment, felling, gameLoadError,
      inputAllowed: () => explorationGate.hooks.pickingAllowed() && !cinematics?.locksInput(),
      simulationHeld: () => cinematics?.holdsWorld() ?? false,
      graphicsOptions, growth, islandChoice, mapEditor, market: cloud?.market, militaryAiDebug, militaryDebug,
      handoff,
      minimap, minimapShown, observation, params, playerNation, renderer,
      resetFrameTime: () => renderLoop?.resetTime(), restoredGame, saveStore, saving, sessionClock, settings,
      shipObservation, startMap, viewport, workerNation, workers, world,
      onCreated: created => { settlement = created; } });
    if (cloud && settlement && settlementSession) {
      const unbindCloud = bindCloudSession({
        cloud, i18n: languagePreference.i18n, leave: leaveToStart,
        player: { claimServerLevel: settlementSession.claimServerLevel,
          level: settlementSession.level }, reload: () => reloadPage(),
        releaseSession: () => endCloudSession(cloud), saveStatus, saving,
        settle: settlementSession.settle, showPopup: settlement.showPopup,
        transition: settlementSession.transition, viewport
      });
      settlementSession.retainIsland(unbindCloud);
    }
  }
  if (settlementSession) {
    if (historicalBenchmark) settlementSession.retainIsland(historicalBenchmark.dispose);
    if (economyAiWindow) settlementSession.retainIsland(economyAiWindow.dispose);
    settlementSession.retainIsland(viewMode.dispose);
    settlementSession.retainIsland(hudVisibility.dispose);
    settlementSession.retainIsland(overlay.dispose);
    settlementSession.retainIsland(buildOverlay.dispose);
    settlementSession.retainIsland(workerInput.dispose);
    settlementSession.retainIsland(observation.dispose);
    settlementSession.retainIsland(stopMapEditorVisibility);
    settlementSession.retainIsland(mapPanel.dispose);
    settlementSession.retainIsland(settings.dispose);
    if (gameSection) settlementSession.retainIsland(gameSection.dispose);
    settlementSession.retainIsland(mapEditor.dispose);
    settlementSession.retainIsland(pool.invalidateJobs);
  }
  if (settlement) {
    await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.preparingView));
    try {
      await profileAsync("warm coastal geometry", () => prewarmCoastalGeometry(
        settlement!.simulation.prewarmCoastalGeometry(), loading.setProgress));
    } finally { loading.setProgress(null); }
  }
  const exploration = settlement && settlementSession && settlementEnabled ? (() => {
    const travel = settlementSession.getTravel();
    const active = () => {
      const id = travel?.active() ?? null;
      if (id === null) return { adventure: null, colony: null };
      return { adventure: settlement!.simulation.adventure() ? id : null,
        colony: settlement!.simulation.colony() ? id : null };
    };
    const isHome = () => (travel?.active() ?? null) === null;
    try {
      return createIslandExploration({ activeExpedition: active, camera, editorVisible: () => mapEditorVisible,
        closeWindows: () => {
          settlement?.closeWindows();
          settings.closeAllWindows();
          closeAllLazyReactWindows();
        },
        explorationFog, gate: explorationGate, i18n: languagePreference.i18n, isHome,
        rain: () => environment.update(0).rain, renderer, simulation: settlement!.simulation, viewport, world });
    } catch (error) {
      console.warn("Exploration tools could not start", error);
      return undefined;
    }
  })() : undefined;
  if (exploration && settlementSession) settlementSession.retainIsland(exploration.dispose);
  const disposeNotifications = mountNotificationHost(languagePreference.i18n);
  if (settlementSession) settlementSession.retainPage(disposeNotifications);
  const commanderControl = settlement && settlementSession && exploration ? createIslandCommander({
    canControl: () => !mapEditorVisible && !settlementSession!.transition.frozen(),
    canStart: () => {
      if (mapEditorVisible || settlementSession!.transition.frozen() || !exploration.controllerInputEnabled()) return false;
      const input = explorationGate.snapshot().normalized;
      return !input.editorGesture && input.gesture === "none" && !input.mapPointerActive &&
        !input.modalOpen && !input.placementGesture;
    },
    closeWindows: () => { settlement!.closeWindows(); settings.closeAllWindows(); closeAllLazyReactWindows(); },
    gate: explorationGate, i18n: languagePreference.i18n, rain: () => environment.update(0).rain,
    renderer, simulation: settlement.simulation, viewport,
    workerFrames: () => settlement!.workerFrames
  }) : undefined;
  if (commanderControl && settlementSession) settlementSession.retainIsland(commanderControl.dispose);
  if (import.meta.env.DEV) (window as Window & { __commanderControl?: unknown }).__commanderControl = commanderControl;
  // Bench-only (dev builds): start a building placement without the build menu (marker captures).
  if (import.meta.env.DEV) (window as Window & { __selectPlacement?: (typeId: number | null) => void })
    .__selectPlacement = typeId => settlement?.controls.selectBuilding(typeId);
  if (settlementSession) settlementSession.retainIsland(minimap.dispose);
  if (settlementSession) settlementSession.retainIsland(() => {
    thunderPlayer = () => {};
    explorationAudio.dispose();
    disposeWildlife();
    soundscape = undefined;
  });
  if (settlement && renderer.prepareBuildings) {
    await profileAsync("warm building shaders and textures", () => renderer.prepareBuildings!(
      settlement!.update(0).buildings, environment.update(0), camera.zoom));
  }
  if (settlement && params.flagDemo)
    flagDemo = createFlagDemo({ appearances: workerAppearances, camera, renderer, viewport, world });
  await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.preparingView));
  await pendingSave;
  profileFirstFrame(renderer, () => {
    pool.runInBackground();
    reportLoadProfile(params.profile);
  });
  const pregeneration = settlement ? createIslandPregeneration({
    builders: shared, fog, nation: playerNation, params, pool, quality: graphicsOptions.quality, revealOre
  }) : null;
  if (pregeneration && settlementSession) settlementSession.retainIsland(pregeneration.dispose);
  let pregenerationElapsed = 0;
  let updateWorkers = workers.update;
  if (editorPreview) updateWorkers = () => editorPreview.update().workers;
  if (settlement) updateWorkers = () => flagDemo?.workers ?? settlement!.workerFrames;
  let cinematicTest: (CinematicDevReview & { update: (delta: number) => void }) | undefined;
  if (settlementSession) {
    const cinematicEffects = createCinematicEffects({ environment, playThunder });
    cinematics = createCinematicRuntime({ camera, effects: cinematicEffects.effects, i18n: languagePreference.i18n,
      renderer, simulation: () => settlement?.simulation, viewport, world,
      devReview: { drawnOrbit: () => cinematicTest?.drawnOrbit() ?? null,
        effectsMuted: () => cinematicTest?.effectsMuted() ?? false },
      suspendables: () => [exploration, commanderControl] });
    settlementSession.retainIsland(cinematics.dispose);
    settlementSession.retainIsland(cinematicEffects.dispose);
  }
  // CIN3 review hook: dev builds only (the dynamic import keeps it out of player bundles).
  if (import.meta.env.DEV && params.cinematicTest && cinematics && settlementSession) {
    const hook = (await import("./campaign/cinematics/cinematic-test-hook"))
      .createCinematicTestHook({ renderer, runtime: cinematics });
    cinematicTest = hook;
    settlementSession.retainIsland(hook.dispose);
  }
  renderLoop = startRenderLoop({
    budget: renderBudget.loop,
    presentation,
    sceneReplay: sceneReplayRuntime,
    passProfile: params.passProfile,
    onReady: () => {
      mapPanel.setLoadTime(performance.now() - startedAt);
      if (hideLoadingOnReady !== false) loading.hide();
      minimap.onIslandShown();
      settings.onIslandShown();
      settlement?.onIslandShown();
      if (import.meta.env.DEV) window.__islandReady = true;
      resolveReady();
    },
    onError: error => {
      showLoadingFailure(error);
      rejectReady(error);
    },
    onScreenshot: canvas => saveScreenshot(canvas),
    beforeRender: delta => {
      // A followed subject stays armed but does not move the RTS camera while a sequence plays.
      if (!cinematics?.locksInput()) observation.update(delta);
      if (cinematicTest) cinematicTest.update(delta);
      else cinematics?.update(delta);
    },
    afterRender: observation.afterRender,
    camera,
    cameraInputEnabled: () => !cinematics?.locksInput() && !commanderControl?.owns() &&
      (exploration?.controllerInputEnabled() ?? true),
    getCinematicFrame: () => cinematics?.frame(),
    getExplorationFrame: () => commanderControl?.frame() ?? exploration?.frame(),
    canvas,
    onStats: (summary) => {
      const stats = renderer.getStats();
      const details = {
        ...stats.details,
        ...readFrameProfileDetails(renderer.gl),
        adaptive: renderBudget.describe(),
        animals: animals.describe(),
        birds: String(birds.countVisible()),
        butterflies: String(butterflies.countVisible()),
        critters: String(critters.countVisible()),
        stumps: String(felling.countStumps())
      };
      if (params.passProfile) exposeProfileDetails(details);
      overlay.update(summary, { details });
      weather.refresh();
      settings.refresh();
    },
    resolution: resolution.state,
    stress,
    updateAnimals: (time, view) => sound.trackAnimals(animals.update(time, view, settlement?.simulation.tickFraction())),
    updateCritters: critters.update,
    ...connectFlyers({ birds, butterflies, sheet: params.flyerSheet, sound }),
    updateEnvironment: (deltaSeconds) => {
      followWorldEnvironment(environment, settlement?.simulation, cinematics?.heldTicks() ?? 0);
      return sound.trackEnvironment(environment.update(deltaSeconds));
    },
    ...createForestFrameUpdates({ felling, growth,
      tickFraction: settlementEnabled ? () => settlement?.simulation.tickFraction() ?? 0 : undefined }),
    updateMounts: horseTrial?.update,
    updateSettlement: settlement ? (...args) => {
      const controls = settlement!.controls;
      explorationGate.setNormalizedState({
        editorGesture: mapEditorVisible,
        placementGesture: controls.selectedBuilding() !== null || controls.selectedRoad() !== null ||
          controls.selectedSurvey() !== null
      });
      commanderControl?.update(args[0]);
      let explorationFrame = commanderControl?.owns() ? undefined : exploration?.update(args[0]);
      // The possessed minimap marker is transient presentation only: it never touches base fog,
      // the saved camera, or the simulation/command state.
      minimap.setExplorerMarker(explorationFrame?.bubble
        ? { x: explorationFrame.bubble.centerX, z: explorationFrame.bubble.centerZ }
        : null);
      let frame = settlement!.update(...args);
      // Settlement update returns a partial frame; its actual on-foot workers live in workerFrames.
      // The camera must follow that same current body, including mount/dismount transitions.
      explorationFrame = commanderControl?.frame({ ...frame, workers: settlement!.workerFrames }) ?? explorationFrame;
      if (flagDemo) frame = flagDemo.update(frame, args[0]);
      if (explorationFrame) frame = { ...frame, exploration: explorationFrame } as typeof frame;
      if (mapEditor.isEnabled()) frame = inGameDecorations(frame);
      observed.ships = frame.ships ?? [];
      pregenerationElapsed += args[0];
      if (pregenerationElapsed >= 2) {
        pregenerationElapsed = 0;
        const travel = settlementSession?.getTravel();
        pregeneration?.update(settlement!.simulation.colonyExpeditions(),
          travel ? [...travel.colonies(), ...travel.adventures()] : []);
      }
      return frame;
    } : editorPreview?.update,
    getPlacementPreviews: buildOverlay.placementPreviews,
    updateWorkers,
    renderer,
    viewport,
    world
  });
  const screenshotInput = createScreenshotInput(() => renderLoop?.requestScreenshot());
  const editorHooks = editorOnly ? { mapEditor, mapPanel, minimap, settings } : undefined;
  const dispose = async () => {
    screenshotInput.dispose();
    renderLoop?.stop();
    renderBudget.dispose();
    try {
      await settlementSession?.disposeIsland();
    } finally {
      // The standalone editor has no settlement session to own these page-level widgets.
      editorPreview?.dispose();
      editorHooks?.mapEditor.dispose();
      editorHooks?.mapPanel.dispose();
      editorHooks?.minimap.dispose();
      editorHooks?.settings.dispose();
      await sceneReplayRuntime?.dispose();
      renderer.dispose();
      canvas.remove();
      if (import.meta.env.DEV) {
        window.__islandReady = false;
        delete (window as Window & { __settlement?: IslandSettlement }).__settlement;
      }
    }
  };
  return {
    assets, camera, canvas, dispose, ready, renderer, renderLoop, settlementSession, world,
    seasonSnow: options.seasonSnow === true,
    visualWinter: options.visualWinter === true,
    editorHooks
  };
};
