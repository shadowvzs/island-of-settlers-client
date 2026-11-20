import type { I18n } from "@lingui/core";
import { SOURCE_VERSION, SOURCE_VERSIONS } from "virtual:source-version";

import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { markFrameStage } from "../../render-common/frame-profiler";
import { profileStep } from "../../render-common/load-profile";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { createRuinScorchSource } from "../../render-common/ruin-scorch";
import { deckHorsePoses, deckPassengerPoses } from "../../render-common/ships/ship-deck-passengers";
import { createEdgePassages } from "../../render-common/ships/ship-edge-passage";
import type { ShipFrame } from "../../render-common/ships/ship-frame";
import { createTrafficWearSource } from "../../render-common/traffic-wear";
import { adventureProjectileVisual } from "../../render-common/workers/adventure-bandit-style";
import { rangedProjectileStyle } from "../../render-common/workers/military-weapon-style";
import type { WorkerAppearance, WorkerFrame } from "../../render-common/workers/worker-unit";
import { type ActiveOperation, operationBlockReason } from "../../shared/campaign/active-operation";
import { displayBuildingName, translateDomainText } from "../../shared/i18n/domain";
import { translateMessage } from "../../shared/i18n/translate";
import type { LevelUp } from "../../shared/progression/player-progress";
import type { AdventureIsland } from "../../shared/settlement/adventure-rules";
import { flareBridgeApproaches } from "../../shared/settlement/bridge-approaches";
import { createBugReplayRecorder } from "../../shared/settlement/bug-replay";
import { createBuildingRoadApproaches } from "../../shared/settlement/building-road-approaches";
import type { ColonyIsland } from "../../shared/settlement/colony-expedition-rules";
import { enemyNationFor } from "../../shared/settlement/enemy-nation";
import { ticksForSeconds } from "../../shared/settlement/game-clock";
import { createReplaySceneJournal } from "../../shared/settlement/replay-scene";
import { fitStoneRoadWidths } from "../../shared/settlement/road-fitted-widths";
import { canLevelRoadGround } from "../../shared/settlement/road-ground-leveling";
import { createRoadNetwork, type RoadSegment } from "../../shared/settlement/road-network";
import { createRoadTraversal } from "../../shared/settlement/road-traversal";
import { profileSaveStage } from "../../shared/settlement/save-stage-profile";
import { isHomeBuilding } from "../../shared/settlement/settlement-home";
import { createSignpostStakes } from "../../shared/settlement/settlement-road-strip-placement";
import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import { createSettlementSimulation, type SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementOptions } from "../../shared/settlement/settlement-types";
import { buildingAreaRange } from "../../shared/settlement/settlement-work-ranges";
import type { StockMoveAdoption } from "../../shared/trade/stock-move";
import { applyStockStorageMove } from "../../shared/trade/stock-storage";
import { markFogChanged } from "../../shared/world/fog-revision";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import { FOG, type WorldData } from "../../shared/world/world-data";
import { createMilitaryDeathAudio } from "../audio/military-death-audio";
import { createMilitaryOccupationAudio } from "../audio/military-occupation-audio";
import type { ServerMarket } from "../cloud/server-market";
import { createRoadDecorationWindow } from "../player-inventory/road-decoration-window";
import { bindPlayerInventorySession } from "../player-inventory/store";
import type { WindowShortcut } from "../settings/window-shortcut";
import type { SettlementAdventureSummary, SettlementColonySummary } from "../settlement-ui";
import { createSettlementUi, type SettlementNotification, type SettlementUi } from "../settlement-ui";
import { setSettlementBuildingIconNation } from "../settlement-ui/building-icons";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";
import type { SettlementPopupContent } from "../settlement-ui/settlement-popup";
import type { ShipObservationControls } from "../ship-observation";
import { createMotionSmoother } from "./actor-motion-smoothing";
import { createBridgeCommandActions } from "./bridge-ui-actions";
import { createBuildingDemolitionFrames } from "./building-demolition-frames";
import { createBuildingNameLabels } from "./building-name-labels";
import type { CampaignDeparture } from "./campaign-run-start";
import { type CampaignDepartureSources, createCampaignWindowPort } from "./campaign-window-port";
import { islandSkipsCatchUp } from "./catch-up-skip";
import { createColonyFortMessages } from "./colony-fort-messages";
import type { createDebugClickModes as createDebugClickModesFactory } from "./debug-click-modes";
import { createNoDebugClickModes, createNoSettlementDebugActions } from "./debug-hooks";
import { deckTroopsView } from "./deck-troops-view";
import { dockPorters, lighterCarriers, shuttlePorters } from "./dock-porters";
import { createEnemyAppearances } from "./enemy-appearances";
import { createExpeditionOutcomeAnnouncer } from "./expedition-outcome-announcer";
import { createFarmAreaControls } from "./farm-area-controls";
import { createFogOffHarbourMarkers } from "./fog-off-harbour-markers";
import { garrisonViewActors } from "./garrison-view";
import { createHandcartRenderFrames } from "./handcart-render-frames";
import type { HeldFrameJobs } from "./held-frame-jobs";
import { createHostileBuildingTooltip } from "./hostile-building-tooltip";
import { huntingArrows } from "./hunting-arrows";
import { clearIslandRoadGround } from "./island-road-clearance";
import { createIslandSimulationHooks } from "./island-simulation-hooks";
import { createIslandStockContacts } from "./island-stock-contacts";
import { createMapHoverPick, type MapHoverPick } from "./map-hover-pick";
import { createMarketControls } from "./market-session";
import { createMilitaryControls } from "./military-controls";
import { createPlacementControls, type PlacementSelection } from "./placement-controls";
import { createPlacementNotice } from "./placement-notice";
import type { PlayerSession } from "./player-session";
import { createRoadPlotReservation } from "./road-plot-reservation";
import { createRoadPreviewFrame } from "./road-preview-frame";
import { applyScriptPresentation } from "./script-presentation-frames";
import { pickClickedBuilding } from "./settlement-building-pick";
import { createSettlementClickControls } from "./settlement-click-controls";
import type { createSettlementDebugActions as createSettlementDebugActionsFactory } from "./settlement-debug-actions";
import { createSettlementFrameStep } from "./settlement-frame-step";
import { createSettlementRenderFrames } from "./settlement-render-frames";
import {
  createSettlementCommandActions, createSettlementPlayerActions, createShipViewActions, guardCommandActions,
  guardPlayerActions
} from "./settlement-ui-actions";
import { getColonySummaries, getPlayerSummary, getSettlementUiSnapshot } from "./settlement-ui-state";
import { createShipDemo } from "./ship-demo";
import { smoothShipLikeFrames } from "./ship-motion-smoothing";
import { createShipTroopPort } from "./ship-orders/ship-troop-port";
import { createShoreShellPicking } from "./shore-shell-picking";
import { createStorageFadeFrames } from "./storage-fade-frames";
import { reconcileHiddenTime, skipHiddenTime } from "./tab-resume";
import { createTradeOfficeSession } from "./trade-office-session";
import { createTransportHorseMotion, holdLeadRopes, poseDeckHorses } from "./transport-horse-motion";

export interface IslandSettlementOptions extends Omit<SettlementOptions, "roads"> {
  /** Development tools and state-changing debug actions (owner 2026-10-15). */
  developmentAllowed?: boolean;
  /** Admin/local-dev map-click modes; absent: inert player controls. */
  createDebugClickModes?: typeof createDebugClickModesFactory;
  /** Admin/local-dev state-changing actions; absent: inert player actions. */
  createSettlementDebugActions?: typeof createSettlementDebugActionsFactory;
  renderer: Pick<TerrainRenderer, "pickGround" | "pickWater" | "projectToViewport" | "mapEdit" | "pickShip" |
    "pickBuilding" | "pickRoadDecoration" | "setArmyTargetHover">;
  canvas: HTMLCanvasElement;
  viewport?: HTMLElement;
  workerFrames: readonly WorkerFrame[];
  onSettings: () => void;
  /** Main selection window shortcuts (Music player, Credits, Game News). */
  menuShortcuts?: readonly WindowShortcut[];
  onOpenInventory?: (opener?: HTMLElement) => void;
  /** Whether a building draws its High recipe (windows) now; its garrison soldiers follow it (R16b). */
  isBuildingDetailed?: (building: SettlementBuilding) => boolean;
  onMinimap?: () => void;
  /** Plot centre of the placement preview ghost under a viewport point (null: none). */
  pickPlacementPreview?: (x: number, y: number) => { x: number; z: number } | null;
  getMinimapVisible?: () => boolean;
  onFocusShip?: (ship: { x: number; z: number }) => void;
  shipObservation?: ShipObservationControls;
  onFocusBuilding?: (building: SettlementBuilding) => void;
  onMessage?: (message: string) => void;
  initialState?: SettlementSaveV1;
  /** Bound after the session exists; absent in tools without island travel. */
  getIslandTravel?: () => IslandTravel | undefined;
  /** Player level, gems and daily quests; absent in tools without progression. */
  player?: PlayerSession;
  /** The account's server Market; absent for guests and offline play. */
  market?: ServerMarket;
  /** Campaign records, map files and progress (C8); absent in tools without campaign departures. */
  campaign?: CampaignDepartureSources;
  /** Saves the home island first: the API deposits and withdrawals read the stored snapshot, not live stock. */
  saveBeforeMarketMove?: () => Promise<boolean>;
  /** Right after every update (the simulation's tick boundary); `simulated` when game time advanced. */
  afterTick?: (simulated: boolean) => void;
  /** Work in frames that do not tick (save capture and snapshot reload); created here when absent. */
  heldJobs?: HeldFrameJobs;
  /** Every 0.5 s UI pass: the buildings and ships, for key events that deserve a save. */
  checkSaveEvents?: (buildings: readonly SettlementBuilding[], ships: readonly ShipFrame[]) => void;
  /** Traffic-wear source enabled (presentation only; true on every preset per D4). */
  trafficWear?: boolean;
  /** False while a session transition freezes commands and simulation ticks at the handoff boundary. */
  canCommand?: () => boolean;
  /** False while a presentation mode (exploration) owns map input; simulation ticks continue. */
  inputAllowed?: () => boolean;
  /**
   * CIN3/CIN4: true while a cinematic sequence with "Pause the world" plays (saved simulation state). Frames still
   * run held jobs (save capture) but advance no game time, so no tick and no quest countdown moves; a hidden-tab
   * interval is parked on the clock, never replayed afterwards.
   */
  simulationHeld?: () => boolean;
  /** Active Lingui instance: UI-owned statuses and window copy follow its locale. */
  i18n?: I18n;
}
export interface IslandTravel {
  homeGarrisonReserves?: () => { archer: number; heavy: number; shield: number } | undefined;
  recallSoldiers?: (id: number) => boolean;
  active(): number | null;
  colonies(): ReadonlyArray<{ expeditionId: number; island: ColonyIsland; status: SettlementColonySummary["status"];
    conqueredAt?: number; nextOreShipAt?: number }>;
  adventures?(): ReadonlyArray<{ expeditionId: number; island: AdventureIsland;
    status: SettlementAdventureSummary["status"] }>;
  visit(id: number): Promise<boolean>;
  returnHome(): Promise<boolean>;
  disband(id: number): Promise<boolean>;
  update(dt: number): void;
  /** Voyage length of the island on screen (0 at home); used by commander return ships. */
  voyageSeconds?: () => number;
  /** What holds the shared colony/adventure/campaign operation slot; null when it is free. */
  operation?: () => ActiveOperation | null;
  /** The campaign run on screen (C9a); undefined on an island. */
  campaignRun?: () => { status: string } | undefined;
  /** Sails home from the campaign run (its outcome, or giving it up). */
  endCampaignRun?: () => Promise<boolean>;
  /** Leaves the home island for a campaign map (C8): true, or the English domain refusal. */
  startCampaignRun?: (departure: CampaignDeparture) => Promise<true | string>;
}


const TOOL_WAIT_STATUS =
  /Waiting for (axe|saw|pickaxe|shovel|hammer|fishingRod|bow|spyglass|scythe|crucible|tongs|rollingPin|cleaver)/;

/** Announces newly finished buildings once and finished producers that start waiting for a tool. */
const announceBuildingChanges = (buildings: readonly SettlementBuilding[], context: {
  buildingName: (typeId: number) => string;
  completed: Set<number>;
  message: (text: string, warning: boolean, building: SettlementBuilding) => void;
  statuses: Map<number, string>;
}) => {
  const { buildingName, completed, message, statuses } = context;
  for (const building of buildings) {
    if (building.construction === 1 && !completed.has(building.uid)) {
      completed.add(building.uid);
      message(`${buildingName(building.typeId)} is complete.`, false, building);
    }
    const previous = statuses.get(building.uid);
    if (previous !== building.status && building.construction === 1 && TOOL_WAIT_STATUS.test(building.status))
      message(`${buildingName(building.typeId)}: ${building.status}.`, true, building);
    statuses.set(building.uid, building.status);
  }
};

const getInitialSettlementStatus = (i18n?: I18n) =>
  translateDomainText("Choose a building, then connect its road endpoint with a dirt road.", i18n);
const getSurveyJobStatus = (job: "Geologist" | "Scout", i18n?: I18n) =>
  translateDomainText(`Choose a connected road endpoint for the ${job.toLowerCase()}.`, i18n);
const getPlannedStatus = (building: string, i18n?: I18n) =>
  translateDomainText(`Planned ${building}. Connect its road endpoint.`, i18n);
const getMarketReloadStatus = (reason: string, i18n?: I18n) =>
  translateMessage(i18n, M.actions.marketReload, { reason });

/** Live settlement controller. Authoritative simulation is shared; this layer binds UI and frames. */
/** Screen point → the clicked building (ground pick first), as the building focus and debug modes use it. */
const createBuildingPicker = (
  options: IslandSettlementOptions, buildings: () => Parameters<typeof pickClickedBuilding>[0]
) => (x: number, y: number) => {
  const point = options.renderer.pickGround(x, y);
  return point ? pickClickedBuilding(buildings(), point, { x, y }, options.renderer, options.world) : undefined;
};

/** Fog shows on this island (expeditions and the fog-free debug view show everything). */
const showsFog = (world: IslandSettlementOptions["world"]) => !world.fogDisplayDisabled && !world.expeditionKind;

/** Enemy units, arrows and intel show only where the player currently sees the ground. */
const isMilitaryPointVisible = (world: IslandSettlementOptions["world"], point: { x: number; z: number }) =>
  !showsFog(world) || world.fog[Math.floor(point.z) * world.cellsX + Math.floor(point.x)] === FOG.visible;

/** The nation of the island's enemy army against the current player nation. */
const islandEnemyNation = (options: IslandSettlementOptions, simulation: SettlementSimulation) =>
  () => enemyNationFor(simulation.playerNation(), options.world.seed);

/** Hovering a hostile building shows its soldiers (its click opens nothing); intel only where seen. */
const createIslandHostileTooltip = (options: IslandSettlementOptions, simulation: SettlementSimulation,
  buildingName: (typeId: number) => string, hover: MapHoverPick) =>
  createHostileBuildingTooltip({ buildingName, hover, mount: options.viewport ?? options.canvas, simulation,
    enemyNation: islandEnemyNation(options, simulation), i18n: options.i18n,
    isVisible: building => isMilitaryPointVisible(options.world, building),
    project: (x, y, z) => options.renderer.projectToViewport(x, y, z) });

/** The player's own banner shows wherever it stands, fog or not. */
const rallyBannerFrame = (simulation: SettlementSimulation, world: WorldData) => {
  const rally = simulation.militaryRally();
  return rally && { x: rally.x, y: sampleSmooth(world, world.heights, rally.x, rally.z), z: rally.z };
};

/** Development fog reveal, shared by the tool and a direct settlement call: permanent sight everywhere. */
const revealIslandFog = (world: WorldData, allowed: boolean) => {
  if (!allowed) return;
  world.fog.fill(FOG.visible);
  (world.permanentFog ??= world.fog.slice()).fill(FOG.visible);
  markFogChanged(world, true);
};

// Existing controller; the localization pass added only message resolution and locale parameters.
// oxlint-disable-next-line max-lines-per-function
export const createIslandSettlement = (options: IslandSettlementOptions) => {
  let simulation: SettlementSimulation;
  const developmentAllowed = options.developmentAllowed ?? true, canCommand = options.canCommand ?? (() => true);
  const inputAllowed = options.inputAllowed ?? (() => true), commandsAllowed = () => canCommand() && inputAllowed();
  const replayScene = createReplaySceneJournal(options.world);
  const roadPlotReservation = createRoadPlotReservation();
  const signposts = createSignpostStakes(options.world, () => simulation?.buildings() ?? []);
  const roads = createRoadNetwork(options.world, {
    // Traversal already tests the complete road width; a second dilation sealed entrances.
    isBlocked: (x, z) => roadPlotReservation.blocks(x, z) || (!!simulation && simulation.isOccupied(x, z)),
    isStripReserved: signposts.isStripReserved,
    validateGradedRoads: (planned, existing) => canLevelRoadGround(
      options.world, planned, existing, simulation?.buildings() ?? [])
  });
  // Upgraded stretches of old roads narrow where a building, crop or prop already stands in the way.
  const roadWidthObstacles = { clearance: signposts.clearance,
    isBlocked: createRoadTraversal(options.world, { isBlocked: (x, z) => simulation.isOccupied(x, z) }).blocked };
  const demolition = createBuildingDemolitionFrames();
  const horseMotion = createTransportHorseMotion();
  const stockContacts = options.stockContact ?? createIslandStockContacts(options.world,
    (x, z) => simulation.isOccupied(x, z), building => simulation.buildingNation(building));
  simulation = profileStep("settlement simulation", () => createSettlementSimulation(replayScene.wrap({
    ...options, roads, roadDecorationCustody: options.roadDecorationCustody ?? options.player?.roadDecorationCustody,
    restoredHome: options.initialState?.buildings.find(isHomeBuilding),
    ...createIslandSimulationHooks({ ...options, stockContact: stockContacts }, { demolition, getSimulation: () => simulation,
      // `message` is declared below; the hooks only run once the simulation is live.
      message: (text, warning) => message(text, warning) })
  })));
  // `handcartFrames` is declared below; the wear source reads it only once the simulation ticks.
  const trafficWear = options.trafficWear === false ? undefined : createTrafficWearSource(simulation, options.world,
    roads, () => handcartFrames.current());
  const ruinScorch = createRuinScorchSource();
  const bugReplay = createBugReplayRecorder(simulation, SOURCE_VERSION, SOURCE_VERSIONS, replayScene);
  options.player?.bind(simulation);
  const i18n = options.i18n, display = (text: string) => translateDomainText(text, i18n);
  const buildingName = (typeId: number) => displayBuildingName(typeId, simulation.playerNation(), i18n);
  if (options.initialState) {
    const loaded = simulation.loadState(options.initialState);
    if (!loaded.ok) throw new Error(loaded.reason);
  }
  const deathAudio = createMilitaryDeathAudio();
  const occupationAudio = createMilitaryOccupationAudio(simulation.buildings());
  const frames = createSettlementRenderFrames(options.workerFrames, createEnemyAppearances(options.world.seed), stockContacts,
    (x, z) => sampleSmooth(options.world, options.world.heights, x, z));
  const shipDemo = createShipDemo();
  const shipSmoother = createMotionSmoother(), boatSmoother = createMotionSmoother();
  const shipEdgePassages = createEdgePassages(options.world);
  let shipDemoAppearances: readonly WorkerAppearance[] = options.workerFrames;
  let shipDemoTime = 0;
  const storageFades = createStorageFadeFrames(options.world);
  const handcartFrames = createHandcartRenderFrames(options.world,
    () => simulation.talentModifiers().handcartCapacity);
  setSettlementBuildingIconNation(simulation.playerNation());
  const notifications: SettlementNotification[] = [];
  const statuses = new Map<number, string>();
  // Buildings already finished in a loaded save were announced when they were built, not again on load.
  const completed = new Set<number>(simulation.buildings()
    .filter(building => building.construction === 1).map(building => building.uid));
  let notificationId = 0, statusRevision = 0, uiAge = 0;
  let status = getInitialSettlementStatus(options.i18n);
  let minimapVisible = options.getMinimapVisible?.() ?? false;
  let ui: SettlementUi | undefined;
  let focusedWorkBuilding: number | null = null;
  /** The bridge whose panel is open: the renderer keeps its outline. */
  let selectedBridge: number | null = null;
  let roadRevision = -1;
  let networkRoadRevision = -1;
  let roadBuildingCount = -1;
  let roadCompletedCount = -1;
  let roadFrames: RoadSegment[] = [];
  const localizedNotifications = () => notifications.map(notification => ({
    ...notification,
    message: display(notification.message),
    buildingName: notification.buildingName ? display(notification.buildingName) : undefined
  }));
  const message = (text: string, warning = false, building?: SettlementBuilding) => {
    status = text;
    statusRevision++;
    const buildingId=building ? String(building.uid) : undefined;
    const previousNotice=notifications.at(-1);
    if (previousNotice?.message !== text || previousNotice?.buildingId !== buildingId) {
      notifications.push({ id: String(notificationId++), message: text, tone: warning ? "warning" : "info",
        buildingId,
        buildingName: building ? buildingName(building.typeId) : undefined });
      if (notifications.length > 12) notifications.shift();
    }
    ui?.update({ status: display(status), statusRevision, notifications: localizedNotifications() });
    options.onMessage?.(display(text));
  };
  // A live language change clears the current status line instead of leaving a stale-language sentence.
  const stopLocaleStatus = options.i18n?.on("change", () => {
    if (!status) return;
    status = "";
    statusRevision++;
    ui?.update({ status, statusRevision });
  });
  const placementNotice = createPlacementNotice();
  /** A message about the current placement selection: cleared when the selection changes. */
  const notice = (text: string, warning = false) => { message(text, warning); placementNotice.told(text); };
  const clearStaleNotice = (selection: PlacementSelection) => {
    if (!placementNotice.isStale(selection, status)) return;
    status = ""; statusRevision++;
    ui?.update({ status, statusRevision });
  };
  const controls = createPlacementControls({
    simulation, world: options.world, renderer: options.renderer, canvas: options.canvas,
    canCommand: commandsAllowed, i18n: options.i18n, viewport: options.viewport,
    roadDecorationHeld: item => options.player?.progress().inventory?.[item] ?? 0,
    onRoadDecoration: order => options.player?.mutateRoadDecoration({ kind: "place", order }) ?? Promise.resolve("Road decoration custody is unavailable"),
    onRoadDecorationMove: (uid, order) => options.player?.mutateRoadDecoration({ kind: "move", uid,
      position: order.position, yaw: order.yaw }) ?? Promise.resolve("Road decoration custody is unavailable"),
    onChange: (selection) => {
      clearStaleNotice(selection);
      ui?.update({ selectedBuilding: selection.building, roadMode: selection.road, surveyJob: selection.survey });
    },
    onMessage: (text) => message(text),
    onNotice: (text) => notice(text),
    pickPreview: options.pickPlacementPreview,
    roadPlotReservation,
    onSurvey: (job, target) => simulation.dispatchSurveyJob(job, target),
    onPlaced: (building) =>
      message(getPlannedStatus(buildingName(building.typeId), options.i18n), false, building)
  });
  const roadPreviewFrame = createRoadPreviewFrame({ buildings: () => simulation.buildings(),
    preview: () => controls.roadPreview(), segments: () => roads.segments(), widthObstacles: roadWidthObstacles });
  const areaControls = createFarmAreaControls({
    simulation, world: options.world, renderer: options.renderer, canvas: options.canvas,
    viewport: options.viewport,
    focusedBuilding: () => focusedWorkBuilding
  });
  const nameLabels = createBuildingNameLabels({ buildingName, buildings: () => simulation.buildings(),
    isVisible: building => isHomeBuilding(building) || isMilitaryPointVisible(options.world, building),
    renderer: options.renderer, viewport: options.viewport ?? options.canvas.parentElement ?? document.body });
  const announceFortChanges = createColonyFortMessages(message, options.i18n);
  const announceExpeditionOutcomes = createExpeditionOutcomeAnnouncer({ getIslandTravel: options.getIslandTravel,
    getUi: () => ui, i18n: options.i18n, message, player: options.player, simulation });
  let announcedTutorial: string | null = null;
  const updateUi = () => {
    const tutorial = options.player?.tutorialSummary();
    if (tutorial?.ready && tutorial.quest && announcedTutorial !== tutorial.quest.id) {
      announcedTutorial = tutorial.quest.id;
      message("Tutorial objective complete. Open Quests to claim your reward.");
    }
    announceBuildingChanges(simulation.buildings(), { buildingName, completed, message, statuses });
    announceFortChanges(simulation);
    announceExpeditionOutcomes();
    const snapshot = profileSaveStage("ui.snapshot", () => getSettlementUiSnapshot(simulation, localizedNotifications(),
      options.getIslandTravel?.()?.homeGarrisonReserves?.(), i18n));
    const travel = options.getIslandTravel?.();
    ui?.update({ ...snapshot, ships: snapshot.ships ?? [], status: display(status), statusRevision,
      activeColony: travel?.active() ?? null,
      operationBlock: operationBlockReason(travel?.operation?.() ?? null),
      player: options.player && getPlayerSummary(options.player, simulation),
      colonies: travel && getColonySummaries(simulation, travel, i18n),
      adventures: travel?.adventures?.().map(adventure => ({ id: adventure.expeditionId, island: adventure.island,
        status: adventure.status })),
      selectedBuilding: controls.selectedBuilding(), roadMode: controls.selectedRoad(), surveyJob: controls.selectedSurvey(),
      minimapVisible: options.getMinimapVisible?.() ?? minimapVisible });
  };
  /** A committed Market stock move is server save state, never a journalled command (the protocol's rule). */
  const applyMarketMove = (move: StockMoveAdoption) => {
    const applied = applyStockStorageMove(simulation.buildings(), move);
    if (!applied.ok) {
      message(getMarketReloadStatus(applied.reason, options.i18n), true);
      return;
    }
    updateUi();
  };
  const marketControls = options.market && createMarketControls(options.market, applyMarketMove,
    options.saveBeforeMarketMove, () => simulation.islandRole() === "home");
  /** The ship orders of the military controls, created after the UI (the ship window reads them lazily). */
  let militaryShips: ReturnType<typeof createMilitaryControls>["ships"] | undefined;
  ui = profileStep("settlement UI", () => createSettlementUi({
    gameNow: simulation.gameNow,
    i18n: options.i18n,
    mount: options.viewport,
    onSelectBuilding: (id) => {
      controls.selectBuilding(id); status = ""; statusRevision++;
      ui?.update({ status, statusRevision });
    },
    onRotate: controls.rotate,
    onRoadMode: (mode) => controls.selectRoad(mode),
    onSurveyJob: (job) => {
      controls.selectSurvey(job);
      if (job) message(getSurveyJobStatus(job, options.i18n));
    },
    ...guardCommandActions(createSettlementCommandActions({ i18n: options.i18n, message, simulation, updateUi,
      operationBlock: () => operationBlockReason(options.getIslandTravel?.()?.operation?.() ?? null),
      onBuildingDemolished: () => { focusedWorkBuilding = null; } }), commandsAllowed, options.i18n),
    ...guardCommandActions(createBridgeCommandActions({ i18n: options.i18n, message, simulation, updateUi }),
      commandsAllowed, options.i18n),
    onFocusBridge: id => { selectedBridge = id; },
    onCloseBridge: () => { selectedBridge = null; },
    onScoutingAvailability: source => simulation.seaExplorationAvailability(source),
    ...guardPlayerActions(createSettlementPlayerActions({ buildingName, i18n: options.i18n, message, simulation,
      updateUi, focusBuildingPanel: uid => ui?.focusBuilding(String(uid)), getIslandTravel: options.getIslandTravel,
      onFocusBuilding: options.onFocusBuilding, player: options.player, selectBuilding: controls.selectBuilding }),
      commandsAllowed, options.i18n),
    market: marketControls,
    campaign: options.campaign && createCampaignWindowPort({ ...options.campaign, simulation,
      operation: () => options.getIslandTravel?.()?.operation?.() ?? null,
      start: departure => options.getIslandTravel?.()?.startCampaignRun?.(departure) ?? Promise.resolve("") }),
    trade: createTradeOfficeSession(simulation, { canCommand: commandsAllowed, i18n: options.i18n,
      message: text => message(text), updateUi: () => updateUi() }),
    shipObservation: options.shipObservation,
    ...createShipViewActions({ onFocusShip: options.onFocusShip, shipDemo, simulation }),
    shipTroops: createShipTroopPort({ canCommand: commandsAllowed, getIslandTravel: options.getIslandTravel,
      ships: () => militaryShips, simulation }),
    onSettings: options.onSettings,
    menuShortcuts: options.menuShortcuts,
    onOpenInventory: options.onOpenInventory,
    onMinimap: () => { minimapVisible = !minimapVisible; options.onMinimap?.(); updateUi(); },
    onCloseBuilding: () => { focusedWorkBuilding = null; },
    /** Script details focus (TRG9, rev M16): camera only, no recorded `select`, no work-area overlay. */
    onFocusBuildingCamera: (id) => {
      const building = simulation.buildings().find((entry) => entry.uid === Number(id));
      if (building) options.onFocusBuilding?.(building);
    },
    onFocusBuilding: (id) => {
      const building = simulation.buildings().find((entry) => entry.uid === Number(id));
      if (building) {
        simulation.select(building.uid);
        focusedWorkBuilding = buildingAreaRange(building, simulation.playerNation()) ? building.uid : null;
        options.onFocusBuilding?.(building);
      }
    }
  }));
  const pickBuildingAt = createBuildingPicker(options, () => simulation.buildings());
  /** One shared mouse hover over the map: the hostile tooltip and the soldiers' target hover read it. */
  const mapHover = createMapHoverPick({ mount: options.viewport ?? options.canvas, pickBuilding: pickBuildingAt,
    surface: options.canvas });
  const debugClickModes = options.createDebugClickModes
    ? options.createDebugClickModes({ allowed: developmentAllowed, buildingName,
        cancelPlacement: () => controls.cancel(), i18n: options.i18n, message,
        enemyNation: islandEnemyNation(options, simulation),
        pickBuilding: pickBuildingAt, pickGround: (x, y) => options.renderer.pickGround(x, y),
        pickWater: (x, y) => options.renderer.pickWater?.(x, y) ?? null, simulation,
        onRaised: updateUi })
    : createNoDebugClickModes();
  const militaryControls = createMilitaryControls({
    canCommand: commandsAllowed, debugClick: debugClickModes.controls, i18n: options.i18n,
    mount: options.viewport ?? options.canvas.parentElement ?? document.body, simulation,
    surface: options.canvas,
    project: (x, y, z) => options.renderer.projectToViewport(x, y, z),
    pick: (x, y) => options.renderer.pickGround(x, y),
    pickBuilding: (x, y) => options.renderer.pickBuilding?.(x, y) ?? null, message,
    isVisible: point => isMilitaryPointVisible(options.world, point), hover: mapHover,
    pickShip: (x, y) => options.renderer.pickShip?.(x, y) ?? null, pickTargetBuilding: pickBuildingAt,
    setTargetOutline: outline => options.renderer.setArmyTargetHover?.(outline),
    toolActive: () => controls.isInteracting() || Boolean(debugClickModes.active()),
    waypoints: { groundHeight: (x, z) => sampleSmooth(options.world, options.world.heights, x, z),
      project: (x, y, z) => options.renderer.projectToViewport(x, y, z) }
  });
  militaryShips = militaryControls.ships;
  const decorationWindow = createRoadDecorationWindow(options.viewport ?? options.canvas.parentElement ?? document.body, {
    find: uid => simulation.roadDecorations().find(frame => frame.uid === uid),
    move: uid => Promise.resolve(controls.moveRoadDecoration(uid) || "This decoration cannot be moved right now"),
    rotate: uid => options.player?.mutateRoadDecoration({ kind: "rotate", uid }) ?? Promise.resolve("Road decoration custody is unavailable"),
    pickUp: uid => options.player?.mutateRoadDecoration({ kind: "pick-up", uid }) ?? Promise.resolve("Road decoration custody is unavailable")
  }, options.i18n);
  const shoreShells = createShoreShellPicking({ renderer: options.renderer, simulation, world: options.world });
  const clickControls = createSettlementClickControls({
    canCommand: commandsAllowed, debug: debugClickModes, i18n: options.i18n, military: militaryControls,
    mount: options.viewport ?? options.canvas,
    placement: controls, renderer: options.renderer, roads, simulation, ui, world: options.world,
    onMessage: message, onPickBuilding: pickBuildingAt, onUpdate: updateUi,
    onPickRoadDecoration: uid => decorationWindow.open(uid), onPickShoreShell: shoreShells.click
  });
  const hostileTooltip = createIslandHostileTooltip(options, simulation, buildingName, mapHover);
  const fogOffMarkers = createFogOffHarbourMarkers({ renderer: options.renderer,
    viewport: options.viewport ?? options.canvas.parentElement ?? document.body, world: options.world });
  frames.updateBuildings(simulation.buildings(), simulation.buildingNation, simulation.militaryDoors(),
    simulation.productionTalentBonus); updateUi();
  const stepSimulation = createSettlementFrameStep({ afterTick: options.afterTick, bugReplay,
    getIslandTravel: options.getIslandTravel, heldJobs: options.heldJobs, replayScene, simulation });
  let presentationTime = 0;
  const update = (dt: number, renderTime = presentationTime + dt) => {
    presentationTime = renderTime;
    markFrameStage("settlement.tick");
    if (canCommand()) stepSimulation(options.simulationHeld?.() ? 0 : dt);
    markFrameStage("settlement.frames");
    const shipSites = simulation.shipSites(), tickSeconds = simulation.tickFraction() * TICK_SECONDS;
    const shipFrames = simulation.shipFrames();
    // Ships gone off the map at a sea exit sail on over the edge; returning ones sail in from it.
    const drawnShips = shipEdgePassages.apply(
      smoothShipLikeFrames(shipSmoother, shipFrames, simulation.tickFraction(), dt), presentationTime);
    const deckPoses = deckPassengerPoses(drawnShips, options.world, presentationTime);
    const drawnBoats = smoothShipLikeFrames(boatSmoother, simulation.shuttleFrames(),
      simulation.tickFraction(), dt);
    const porters = [...dockPorters(options.world, shipSites, tickSeconds),
      ...lighterCarriers(options.world, drawnShips, tickSeconds),
      ...shuttlePorters(options.world, drawnBoats, tickSeconds)];
    const deckTroops = deckTroopsView(options.world, drawnShips, shipSites, tickSeconds);
    frames.updateBuildings(simulation.buildings(), simulation.buildingNation, simulation.militaryDoors(),
      simulation.productionTalentBonus);
    const soldiers = simulation.militarySoldiers(), actors = simulation.frames();
    frames.updateWorkers([...actors.filter((actor) => actor.job !== "Mount"), ...porters,
      ...garrisonViewActors(simulation.buildings(), soldiers, actors, simulation.playerNation(),
        options.isBuildingDetailed ?? true), ...deckTroops.actors], dt,
    [...soldiers, ...deckTroops.soldiers], simulation.tickFraction(), options.world.adventureTheme,
    simulation.commanderControlSnapshot(), deckPoses);
    const deaths = frames.addFallen(simulation.militaryDeaths());
    frames.buildings.push(...demolition.update(dt, simulation.buildings(), actors));
    // The fog is simulation state (A13 phase 2): frames only read it.
    storageFades(frames.workers, simulation.takeStorageFades(), dt);
    applyScriptPresentation(frames.workers, simulation.script()?.actions.presentation(simulation.tickFraction()));
    controls.updatePreview();
    areaControls.updatePreview();
    nameLabels.update();
    const buildings = simulation.buildings();
    const completedCount = buildings.reduce((count, building) => count + Number(building.construction >= 1), 0);
    if (networkRoadRevision !== roads.revision || roadBuildingCount !== buildings.length ||
      roadCompletedCount !== completedCount) {
      networkRoadRevision = roads.revision;
      roadBuildingCount = buildings.length;
      roadCompletedCount = completedCount;
      roadRevision++;
      // Shore roads widen to the two-lane deck after fitting, so a bridge never narrows its approach.
      roadFrames = flareBridgeApproaches(
        fitStoneRoadWidths(createBuildingRoadApproaches(roads.segments(), buildings), roadWidthObstacles));
      clearIslandRoadGround(options.world, options.renderer, roadFrames,
        simulation.bridgeSiteFrames().flatMap(site => site.segments));
    }
    uiAge += dt;
    if (uiAge >= 0.5) {
      uiAge = 0; updateUi(); militaryControls.update();
      options.checkSaveEvents?.(buildings, shipFrames);
    }
    const territory = simulation.territory();
    fogOffMarkers.update(!options.world.expeditionKind && !simulation.effectiveGameRules().fogOfWar, buildings);
    const fog = showsFog(options.world);
    const visibleMilitaryPoint = (point: { x: number; z: number }) => isMilitaryPointVisible(options.world, point);
    for (const frame of frames.workers)
      if (frame.combat?.faction && !visibleMilitaryPoint(frame)) frame.visible = false;
    for (let index=frames.cavalryMounts.length-1;index>=0;index--) {
      const frame=frames.cavalryMounts[index]!;
      if (frame.faction && !visibleMilitaryPoint(frame)) frames.cavalryMounts.splice(index,1);
    }
    occupationAudio.update(buildings);
    deathAudio.update(simulation.militaryDeaths().filter(death => {
      if (!visibleMilitaryPoint(death)) return false;
      const point = options.renderer.projectToViewport(death.x, death.y + .5, death.z);
      const viewport = options.viewport ?? options.canvas;
      return point.x >= 0 && point.y >= 0 && point.x <= viewport.clientWidth && point.y <= viewport.clientHeight;
    }));
    shipDemoTime += Math.max(0, dt);
    const shipPreviewWorkers = shipDemo.workerFrames(drawnShips, shipDemoAppearances,
      simulation.playerNation(), shipDemoTime);
    const handcarts = handcartFrames.update(actors, frames.workers, dt,
      simulation.abandonedHandcarts());
    const transportHorses = poseDeckHorses(horseMotion([...simulation.horseFrames(), ...deckTroops.horses],
      simulation.tickFraction(), dt), deckHorsePoses(drawnShips, presentationTime));
    holdLeadRopes(frames.workers, transportHorses);
    return { buildings: frames.buildings, bridgeSites: simulation.bridgeSiteFrames(), selectedBridge,
      cavalryMounts: frames.cavalryMounts,
      roads: roadFrames, roadRevision, roadDecorations: simulation.roadDecorations(), roadDecorationGhost: controls.roadDecorationGhost(),
      roadPreview: roadPreviewFrame(roadRevision), placementGhost: controls.ghost(),
      territoryBorders: territory.borders, territoryRevision: territory.revision,
      fields: simulation.fieldFrames(), handcarts, transportHorses,
      ships: shipDemo.shipFrames(drawnShips), shipPreviewWorkers, shipSites: simulation.shipSites(),
      shuttleBoats: drawnBoats,
      fishingBoats: simulation.fishingBoatFrames(),
      marbleDeposits: simulation.marbleDeposits(),
      adventureCamps: simulation.adventureCampSites().map(camp => ({ ...camp, fogEnabled: fog })),
      militaryArrows: [...simulation.militaryArrows().filter(visibleMilitaryPoint).map(arrow => ({ ...arrow,
        visualWeapon: arrow.faction === 0 ? rangedProjectileStyle(simulation.playerNation()) :
          adventureProjectileVisual(arrow.shooter, arrow.faction, options.world.adventureTheme) })),
      ...huntingArrows(simulation.frames()).filter(visibleMilitaryPoint)],
      rallyBanner: rallyBannerFrame(simulation, options.world),
      trafficWear,
      ruinScorch: ruinScorch.update(simulation.ruins(), simulation.gameTick()),
      militaryDeaths: deaths.filter(visibleMilitaryPoint) };
  };
  /**
   * A retained tab return: one exact catch-up of the hidden interval (bounded, see reconcileHiddenTime). While a
   * cinematic sequence pauses the world (CIN4) the hidden interval is not simulated: it is parked on the clock.
   * Under a catch-up skip (plan §10) the clock moves to now instead, as a reopened tab's skipped save does.
   */
  const catchUp = async (seconds: number) => {
    if (islandSkipsCatchUp(simulation.effectiveGameRules(), simulation.islandRole()))
      return skipHiddenTime(seconds, simulation);
    return reconcileHiddenTime(seconds, stepSimulation.advance,
      { advanceClock: parked => simulation.advanceClock(ticksForSeconds(parked)),
        ...(options.simulationHeld?.() ? { capSeconds: 0 } : {}) });
  };
  const unbindInventory = bindPlayerInventorySession(options.player);
  return {
    cancelInteractions: () => {
      controls.cancel();
      militaryControls.cancel();
      debugClickModes.active()?.set(false);
      focusedWorkBuilding = null;
    },
    closeWindows: () => ui?.closeWindows(), setPlayerAppearances: (appearances: Parameters<typeof frames.setAppearances>[0]) => {
      frames.setAppearances(appearances);
      shipDemoAppearances = appearances;
      if (appearances[0]) setSettlementBuildingIconNation(appearances[0].nation);
    },
    removeFog: () => revealIslandFog(options.world, developmentAllowed),
    playerSession: options.player,
    bugReplay, simulation, roads, controls, areaControls, message, notice, workerFrames: frames.workers,
    announceLevelUp: (levelUps: readonly LevelUp[]) => { ui?.announceLevelUp(levelUps); updateUi(); },
    showPopup: (content: SettlementPopupContent) => ui?.showPopup(content),
    /** Map script windows (TRG9); undefined until the settlement UI exists. */
    scriptWindows: () => ui?.scriptWindows,
    /** Loading finished and the island is on screen: the settlement HUD's React content loads. */
    onIslandShown: () => ui?.onIslandShown(),
    ...(options.createSettlementDebugActions
      ? options.createSettlementDebugActions({ allowed: developmentAllowed, buildingName, completed,
          i18n: options.i18n, message, simulation, updateUi, onFocusBuilding: options.onFocusBuilding,
          player: options.player })
      : createNoSettlementDebugActions()),
    /** Development menu: the spawn and building-level map-click toggles. */
    ...debugClickModes.controls,
    militaryDebugControls: militaryControls.debugControls,
    project: (x: number, y: number, z: number) => options.renderer.projectToViewport(x, y, z),
    projectGround: (x: number, z: number) => options.renderer.projectToViewport(x,
      sampleSmooth(options.world, options.world.heights, x, z) + 0.035, z),
    isInteracting: () => controls.isInteracting(), update, catchUp,
    selectRoadDecoration: controls.selectRoadDecoration,
    dispose: () => { trafficWear?.dispose(); decorationWindow.dispose(); unbindInventory(); stopLocaleStatus?.(); shipDemo.clear(); debugClickModes.dispose(); bugReplay.dispose(); deathAudio.dispose(); occupationAudio.dispose(); militaryControls.dispose(); clickControls.dispose(); hostileTooltip.dispose(); mapHover.dispose(); fogOffMarkers.dispose(); nameLabels.dispose(); areaControls.dispose(); controls.dispose(); ui?.dispose(); }
  };
};

export type IslandSettlement = ReturnType<typeof createIslandSettlement>;
