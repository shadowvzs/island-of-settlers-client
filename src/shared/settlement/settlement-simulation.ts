import { starterStockForNation } from "@shared/catalog/balance";

import type { QuestClaimCommand } from "../../../../island-of-settlers-shared/src/commands/quest-claim-command";
import { LEGACY_RULES_REVISION } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import type { SimFeatureKey } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { validFrameAccumulator } from "../../../../island-of-settlers-shared/src/simulation-frame-remainder";
import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { START_SETTLERS } from "../balance/population";
import { campaignSettlerCount, startCampaignMapProgress } from "../campaign/campaign-map-outcome";
import type { TutorialResource } from "../quests/home-quest-types";
import { isTutorialResourceMissing } from "../progression/tutorial-resources";
import { emitBuildingClicked } from "../script-world/script-building-events";
import { startSettlementScript } from "../script-world/settlement-script";
import { createSettlementTrade } from "../trade/settlement-trade";
import { scenarioStartStock } from "../world/scenario-start-stock";
import { startTroopRecruits } from "../world/scenario-start-troops";
import { applyArmoryOrder, ARMORY_OUTPUTS, validArmoryOrders } from "./armory-orders";
import { findAuthoredObjectHandle } from "./authored-object-uids";
import { updateStoneRespawns } from "./boulder-respawn";
import { createBridgeCommands } from "./bridge-commands";
import { HARBOUR_TYPE_ID } from "./building-type-ids";
import { catapultAmmoChoice, type CatapultAmmoKind, setCatapultAmmo } from "./catapult-ammo-kinds";
import { addToHome, homeStorage } from "./colony-economy";
import { marbleDeposits, RESPAWNING_DEPOSITS } from "./colony-marble-deposits";
import { coveredTroops, garrisonShortfall } from "./colony-troop-supply";
import { createFactionAi } from "./economy-ai/faction-ai";
import { factionBonusTalents } from "./faction-bonus";
import { offerVisionToProbe } from "./faction-vision-probe";
import { featureState } from "./feature-rules";
import { fisherBoatFrames } from "./fisher-boat-frames";
import { createGameClock } from "./game-clock";
import { applyGameRuleEffects } from "./game-rule-effects";
import { mixedProductionChoice } from "./mixed-output";
import { withHarvestProgress } from "./plantation-harvest";
import { addGood, getProductionRule } from "./production-rules";
import { type RoadUpgradeTier } from "./road-types";
import { createRoadVergeCommands } from "./road-verge-planting";
import { unlockedSawmillRecipes } from "./sawmill-recipes";
import { createSettlementAdventure } from "./settlement-adventure";
import { createSettlementBuildingPolicies } from "./settlement-building-policies";
import { shiftClaimLeases } from "./settlement-carrier-claims";
import { createSettlementColony } from "./settlement-colony";
import { counterChecksum } from "./settlement-counter-checksum";
import { createDebugExpeditions } from "./settlement-debug-expeditions";
import { repairEntranceRoadClearance } from "./settlement-entrance-road-clearance";
import { createEventActorHandlers } from "./settlement-event-handlers";
import type { FarmAreaBounds } from "./settlement-farm-area";
import { applyFactionAiStarts, createFactionPlacement } from "./settlement-faction-placement";
import { fastForwardSettlement, type SettlementFastForward } from "./settlement-fast-forward";
import { createSettlementFieldCycles } from "./settlement-field-cycles";
import { fisherBoatStatus, type FisherMode, setFisherMode } from "./settlement-fisher-boat-mode";
import { findBuilding } from "./settlement-handcart-ledger";
import { handcartCount } from "./settlement-handcarts";
import { isOwnBuilding } from "./settlement-home";
import { createSimulationHomeClaims } from "./settlement-home-claims";
import { createSettlementHorses } from "./settlement-horses";
import { localConstructionStock, payLocalConstructionGoods } from "./settlement-local-stock";
import { initializeMapScenario, spawnMapScenery } from "./settlement-map-scenario";
import { createSettlementMilitary } from "./settlement-military";
import { createMovementSkipTicker } from "./settlement-movement-skip";
import { buildingNation } from "./settlement-nation";
import { createSettlementNaval } from "./settlement-naval";
import { navigationProgressSnapshot } from "./settlement-navigation-recovery";
import { connectNearbyBuildingEntrances } from "./settlement-nearby-roads";
import { createOccupancyChanges } from "./settlement-occupancy-changes";
import { createSettlementPersistence } from "./settlement-persistence";
import { startHeadquarters } from "./settlement-placement";
import { createSettlementNationCommands } from "./settlement-player-nation";
import {
  availableIdleSettlers, createIslandPopulation, islandPeople, populationLimit, receiveReturningSettlers,
  updatePopulationGrowth
} from "./settlement-population";
import { claimIslandQuest } from "./settlement-quest-claim";
import { createQuietSkip } from "./settlement-quiet-skip";
import { createReliefCollections } from "./settlement-relief-collections";
import { navigationRepairMetrics } from "./settlement-repair-budget";
import { createSettlementReservations } from "./settlement-reservations";
import { attachPlantingRandom } from "./settlement-resources";
import { createSettlementRoadDecorations, roadDecorationCommands } from "./settlement-road-decorations";
import type { SettlementRuin } from "./settlement-ruins";
import type { SettlementSaveV1 } from "./settlement-save-state";
import { type SawmillMode, sawmillMode, setSawmillMode } from "./settlement-sawmill-handcarts";
import { startIslandScript } from "./settlement-script-snapshot";
import { createSimulationCinematics } from "./settlement-cinematics";
import { createSimulationScriptUi } from "./settlement-script-ui";
import { createSettlementShoreShells } from "./settlement-shore-shells";
import {
  simulationMilitaryCommands, simulationNavalCommands, simulationStorageCommands, simulationTradeCommands
} from "./settlement-simulation-commands";
import { createSimulationDebugCommands, createSimulationTrafficDiagnostics } from "./settlement-simulation-debug";
import { createSimulationPlacement } from "./settlement-simulation-placement";
import { createSettlementTick } from "./settlement-simulation-tick";
import { createSimulationUnitDiagnostics } from "./settlement-simulation-unit-diagnostics";
import { setStoneArea, stoneArea } from "./settlement-stone-area";
import { assignSurveyJob, type SurveyJob } from "./settlement-surveying";
import {
  adoptGameRulesWithTalents, contextTalents, productionTalentBonus, setContextTalentRanks
} from "./settlement-talents";
import { createSettlementTavern } from "./settlement-tavern";
import { ownsTerritoryPoint, settlementTerritory } from "./settlement-territory";
import { createTerritoryRoadControls } from "./settlement-territory-roads";
import { cancelQueuedAmmoTransfers, queueWareTransfer } from "./settlement-transfer-orders";
import {
  type AbandonedHandcart, type Goods, isRoadWorkShell, type SettlementBuilding, type SettlementContext,
  type SettlementOptions, type SettlementPoint
} from "./settlement-types";
import { attachSettlementVision, rebuildSettlementVision } from "./settlement-vision";
import { canRebaseStorageTerrain, rebaseStorageTerrain, reconcileStorageAccess, storageSnapshot } from "./shared-storage";
import { setStorageCollect, storageCollect } from "./shared-storage-collect";
import { createShoreShellLedger } from "./shore-shell-collection";
import { createSimulationGameRules } from "./sim-rules";
import { type AuditedRandom, createRandomAudit } from "./simulation-random";
import { canStoreGoods } from "./storage-capacity";
import { workerPhaseSpec } from "./worker-phase-spec";
import {
  buildingTierBlock, contextBuildingAvailability, setHomeBuildingRules
} from "./building-availability-rules";
import { cancelWorkshopUpgrade, requestWorkshopUpgrade, workshopUpgradeAvailability } from "./workshop-upgrades";

export type { SettlementActor, SettlementBuilding, SettlementOptions } from "./settlement-types";
type AuthoredScenario = NonNullable<SettlementOptions["world"]["scenario"]>;

/** An authored island starts from its headquarters (type 0) unless drafted in the editor or it has none. */
const authoredHomeBuilding = (
  options: SettlementOptions, authored: AuthoredScenario
) => {
  if (options.scenarioDraft) return null;
  if (authored.headquarters) return 0;
  // A campaign map starts at its landing harbour (review R4; C9a).
  if (authored.kind === "campaign" && authored.harbourPlot) return HARBOUR_TYPE_ID;
  return null;
};

/**
 * The map file's start setup where the caller gave none (GS-MAP): its nation, stock (empty = the nation default),
 * settlers and home building; a campaign map with `startSetup: "off"` gives no wares and no settlers. Campaign cargo, colonies and other callers pass their own start stock.
 */
const authoredStartSetup = (authored: AuthoredScenario, nation: string) => {
  if (authored.startSetup === "off") return { settlers: 0, stock: {} };
  return { settlers: authored.settlers, stock: scenarioStartStock(authored.stock, nation) };
};

const withAuthoredStart = (options: SettlementOptions, authored: AuthoredScenario): SettlementOptions => {
  const playerNation = options.playerNation ?? authored.nation;
  const start = authoredStartSetup(authored, playerNation);
  return { ...options, playerNation,
    initialStock: options.initialStock ?? start.stock,
    initialSettlers: options.initialSettlers ?? start.settlers,
    homeBuilding: options.homeBuilding === undefined ? authoredHomeBuilding(options, authored) : options.homeBuilding };
};

/** The map file's start soldiers, only on a start that uses the map's own start setup (no caller stock). */
const authoredStartTroops = ({ initialStock, world }: SettlementOptions) => {
  if (initialStock !== undefined || world.scenario?.startSetup === "off") return [];
  return startTroopRecruits(world.scenario?.startTroops);
};

/** The seeded streams the island's audit covers: military, forester and the runtime's (wildlife, felling). */
const attachIslandRandoms = (context: SettlementContext, military: AuditedRandom) => {
  context.randomAudit!.attach([military, ...context.options.randomStreams ?? []]);
  attachPlantingRandom(context);
};
/** Adds one fixed-tick listener and returns its idempotent remover. */
const addTickListener = (listeners: (() => void)[], listener: () => void) => {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
};
/** Applies a measured skip together with the eligible resting time it represents. */
const fastForwardWithRecovery = (
  context: SettlementContext, military: Pick<ReturnType<typeof createSettlementMilitary>, "recover">,
  skip: SettlementFastForward
) => {
  military.recover(skip.recoverySeconds ?? 0);
  fastForwardSettlement(context, skip);
};

/** Naval pickup for a deployed commander's evacuation or low-HP return. */
const attachCommanderReturn = (
  military: ReturnType<typeof createSettlementMilitary>, naval: ReturnType<typeof createSettlementNaval>,
  options: SettlementOptions
) => military.commander.attachReturnShip(
  uid => naval.requestTroopPickup([uid], options.commanderVoyageSeconds?.() ?? 120).includes(uid),
  manifest => options.onTroopsReturned?.([{ commander: manifest, hp: manifest.hp, rank: 0, type: "cavalry" }])
);

const restoreReplayFrameAccumulator = (context: SettlementContext, value: unknown, atTick: number) => {
  if (!validFrameAccumulator(value) || !Number.isSafeInteger(atTick) || context.clock!.tick() !== atTick) return false;
  context.accumulator = value;
  return true;
};

const attachIslandTradeSystems = (context: SettlementContext) => {
  const trade = createSettlementTrade(context);
  context.trade = trade;
  context.relief = createReliefCollections(context);
  return trade;
};

/** Clock start of a simulation built without an injected `clockStart` (tools, fixtures): never the wall clock. */
const DETACHED_CLOCK_START = 0;

// eslint-disable-next-line max-lines-per-function -- one simulation facade owns the full command set
export const createSettlementSimulation = (options: SettlementOptions) => {
  // Every rule reads time through `options.now`: the game clock, never the wall clock.
  const clock = createGameClock(options.clockStart ?? DETACHED_CLOCK_START, options.now);
  options = { ...options, now: clock.now };
  const authored = options.world.scenario;
  if (authored) options.world.adventureTheme = authored.theme ?? "forest";
  const startTroops = authoredStartTroops(options);
  if (authored) options = withAuthoredStart(options, authored);
  const context: SettlementContext = {
    clock, options, playerNation: options.playerNation ?? "roman", difficulty: options.difficulty ?? "normal",
    factionTalents: factionBonusTalents(authored?.factionAi), buildings: [], buildingByUid: new Map(), actors: [],
    occupied: new Uint8Array(options.world.cellsX * options.world.cellsZ),
    reservations: new Set(), nextActor: 0, nextBuilding: 0, settlers: options.initialSettlers ?? START_SETTLERS,
    population: createIslandPopulation(),
    accumulator: 0, scheduling: 0, resourceAmounts: new Map(), transfers: [], navigationRevision: 0,
    randomAudit: createRandomAudit(),
    ...(options.rules && options.rules.revision !== LEGACY_RULES_REVISION
      ? { gameRules: structuredClone(options.rules) } : {})
  };
  context.reservations = createSettlementReservations(context);
  options.roads.trackOccupancy?.(() => context.navigationRevision ?? 0, createOccupancyChanges(context));
  const headquarters = startHeadquarters(context);
  // The start settlers wait in the home building; a building-free island has no idle pool.
  if (headquarters) headquarters.idleSettlers = context.settlers;
  else context.settlers = 0;
  if (!options.restoredHome) context.campaignMap = startCampaignMapProgress(context, headquarters);
  const territoryRoads = createTerritoryRoadControls(context);
  const bridgeCommands = createBridgeCommands(context);
  const vergeCommands = createRoadVergeCommands(context);
  const naval = createSettlementNaval(context, options.onColonyArrived);
  options.embarkMilitary = naval.embarkMilitary;
  const military = createSettlementMilitary(context);
  context.military = military;
  offerVisionToProbe({ alerted: (faction, uid) => context.factionKnowledge?.alerted(faction, uid) === true,
    ruleAllows: faction => context.factionKnowledge?.omniscient(faction) === true,
    sees: attachSettlementVision(context).sees });
  attachCommanderReturn(military, naval, options);
  attachIslandRandoms(context, military.random);
  if (!options.restoredHome) initializeMapScenario(context, military);
  if (!options.restoredHome && headquarters && startTroops.length) military.station(startTroops);
  if (!options.restoredHome) startIslandScript(context);
  const tavern = createSettlementTavern(context, military);
  context.tavern = tavern;
  context.factionAi = createFactionAi(context);
  if (!options.restoredHome) applyFactionAiStarts(context);
  const trade = attachIslandTradeSystems(context);
  // A fresh island seeded with rules (`options.rules`) starts with their consequences (fog off: revealed).
  applyGameRuleEffects(context);
  const colony = createSettlementColony(context, military, clock.now);
  context.colony = colony;
  const adventure = createSettlementAdventure(context, military, clock.now);
  context.adventure = adventure;
  context.expeditionCombat = {
    death: (type, faction) => { colony.recordDeath(type, faction); adventure.recordDeath(type, faction); },
    arrivals: troops => { colony.recordArrivals(troops); adventure.recordArrivals(troops); }
  };
  context.horses = createSettlementHorses(context);
  context.fieldCycles = createSettlementFieldCycles(context);
  context.roadDecorations = createSettlementRoadDecorations(context);
  context.shoreShells = createShoreShellLedger();
  const shoreShells = createSettlementShoreShells(context, headquarters);
  if (!options.restoredHome) spawnMapScenery(context);
  if (!options.restoredHome) startSettlementScript(context);
  if (headquarters) headquarters.inventory = { ...(options.initialStock ?? starterStockForNation(context.playerNation)) };
  reconcileStorageAccess(context);
  const homeAvailable = (ware: string) => headquarters?.inventory[ware] ?? 0;
  const freeStock = (ware: string, point: SettlementPoint, owner?: number) =>
    localConstructionStock(context, ware, point, owner);
  const placement = createSimulationPlacement(context,
    { adventure, authored, colony, freeStock, military, naval, tavern, territoryRoads });
  const { allowsBuilding, buildingLockLevel, placeBuilding, removeMilitarySite } = placement;
  const factionPlacement = createFactionPlacement(context, { freeStock, placement });
  context.factionPlacement = factionPlacement;
  const systems = { adventure, colony, military, naval, tavern, trade };
  const tick = createSettlementTick(context, systems);
  /** Fixed ticks this simulation ran (not saved): replays and state hashes count steps with it. */
  let ticksRun = 0;
  const tickListeners: (() => void)[] = [];
  // The fresh island's fog already shows its start (territory, start troops): a reload derives the same.
  rebuildSettlementVision(context);
  const persistence = createSettlementPersistence(context, headquarters, naval, military, tavern);
  const { loadState, saveState } = persistence;
  const afterLoad = <Result extends { ok: boolean }>(result: Result) => {
    if (!result.ok) return result;
    context.randomAudit!.reset();
    debugCommands.clearSearches();
    repairEntranceRoadClearance(context);
    connectNearbyBuildingEntrances(context, territoryRoads.connectRoads);
    context.options.onBuildingsRestored?.(context.buildings);
    military.combat.afterLoad();
    rebuildSettlementVision(context);
    return result;
  };
  const debugExpeditions = createDebugExpeditions(context,
    { connectRoads: territoryRoads.connectRoads, military, naval });
  const debugCommands = createSimulationDebugCommands(context, headquarters, military, {
    allowsBuilding: typeId => allowsBuilding(typeId, true), connectRoads: territoryRoads.connectRoads,
    planRoad: territoryRoads.planRoad });
  const quietSkip = createQuietSkip(context, { clock, systems });
  const eventActorHandlers = createEventActorHandlers(context);
  return {
    /** Loading-only cache work; advancing this iterator never advances the island or discovery. */
    prewarmCoastalGeometry: naval.prewarmCoastalGeometry,
    saveState, saveStateWithText: persistence.saveStateWithText,
    ...roadDecorationCommands(context),
    storageSnapshot: (uid: number) => {
      const building = context.buildings.find(entry => entry.uid === uid);
      return building && storageSnapshot(context, building);
    },
    storageCollect: (uid: number) => storageCollect(context, uid),
    setStorageCollect: (uid: number, ware: string, enabled: boolean) => setStorageCollect(context, uid, ware, enabled),
    canEditStorageTerrain: () => canRebaseStorageTerrain(context),
    rebaseStorageTerrain: () => rebaseStorageTerrain(context),
    loadState: (value: unknown) => afterLoad(loadState(value)),
    /**
     * Upload reload (D3): reloads the island's own snapshot of its current state in place, so play continues
     * exactly as a session resumed from that snapshot. Call it at the tick the snapshot was saved.
     */
    reloadSnapshot: (snapshot: SettlementSaveV1, takeOwnership = false) =>
      afterLoad(persistence.reloadSnapshot(snapshot, takeOwnership)),
    ...createSimulationTrafficDiagnostics(context),
    ...createSimulationUnitDiagnostics(context, military),
    authoredScenarioStatus: () => context.authoredScenario && structuredClone(context.authoredScenario),
    /** Campaign maps (C9a): the decided outcome; undefined while the map runs and on every other island. */
    campaignOutcome: () => context.campaignMap?.outcome && { ...context.campaignMap.outcome },
    /** Campaign maps (C9b): the player's people without the player's soldiers, the settlers that may sail home. */
    campaignSettlers: () => campaignSettlerCount(context, military.soldierRecords()),
    /**
     * Fresh campaign start only (C9a, before the first tick): the delivered soldiers and the Monument defenders wait
     * at the landing harbour. They belong to the start state the run's baseline save captures, not to a command.
     */
    stationCampaignStartTroops: (troops: readonly import("./settlement-military").EmigratedTroop[]) => {
      if (!context.campaignMap || clock.tick() > 0) return false;
      military.station(troops);
      return true;
    },
    /** The runtime handle the map start gave a map-file object id (ACT1 spawn table). */
    authoredObjectHandle: (id: number) => findAuthoredObjectHandle(context, id),
    /** The script this island runs: its map start snapshot (TRG1), kept until the map is restarted. */
    scriptSnapshot: () => context.scriptSnapshot,
    ...createSimulationScriptUi(context),
    ...createSimulationCinematics(context),
    ...createSimulationHomeClaims(context),
    ...createSimulationGameRules(context),
    featureState: (key: SimFeatureKey) => featureState(context, key),
    /** The running map script (TRG3a); undefined on islands without one. */
    script: () => context.script,
    /** A13 faction vision layer (read-only; tests, benches and the illegal-read probe). */
    factionVision: () => context.factionVision!,
    /** A13 phase 3 faction knowledge (read-only; tests, benches and the illegal-read probe). */
    factionKnowledge: () => context.factionKnowledge!,
    /** EAI2a dev overlay/probe hook: plain copies of each AI faction's mode, clocks and last threat read. */
    factionAiDiagnostics: () => context.factionAi?.diagnostics() ?? [],
    /** Offline catch-up entry points switch the map script to `catchUp` (no events, frozen script clock). */
    setScriptMode: (mode: "live" | "catchUp") => context.script?.setMode(mode),
    /** End of an offline catch-up: back to live with the single date-bound deadline check (design §7.4). */
    endScriptCatchUp: () => context.script?.endCatchUp(),
    /**
     * Offline catch-up freezes the enemy economy AI (EAI5b, plan §5.3 v1); live play never does. A frozen faction plays
     * no map bonus either (EAI5a): its buildings produce at the neutral rate the fast offline economy models.
     */
    setFactionAiFrozen: (frozen: boolean) => {
      context.factionAi?.setFrozen(frozen);
      context.factionTalents = frozen ? undefined : factionBonusTalents(authored?.factionAi);
    },
    startColony: colony.start,
    marbleDeposits: () => marbleDeposits(context),
    colony: colony.snapshot,
    allowsBuilding: (typeId: number) => allowsBuilding(typeId),
    /** Whether the island offers a type at all, ignoring the player's level (locked cards stay visible). */
    /** The menu offers a type; a built one-off building stays offered (its card shows it as built). */
    offersBuilding: (typeId: number) => allowsBuilding(typeId, true, true),
    buildingLockLevel,
    /** What this island is to the player: home, colony, adventure or campaign map (lane C3). */
    islandRole: placement.islandRole,
    startAdventure: adventure.start,
    adventure: adventure.snapshot,
    playerNation: () => context.playerNation ?? "roman",
    /** The nation a building is built and stocked in: its economy's nation (EAI1c c2). */
    buildingNation: (building: SettlementBuilding) => buildingNation(context, building) ?? "roman",
    ...createSettlementNationCommands(context, saveState, loadState),
    /** The home building (headquarters or colony harbour); a building-free adventure island has none. */
    get headquarters(): SettlementBuilding {
      if (!headquarters) throw new Error("This adventure island has no home building");
      return headquarters;
    },
    /** The home building, or undefined on a building-free adventure island. */
    home: () => headquarters,
    placeBuilding,
    /**
     * Computer factions with an economy (EAI1d): `placeFactionBuilding`, `demolishFactionBuilding` and
     * `connectFactionRoads` are the AI's internal entries (never recorded); `aiPlace` is the recorded
     * development command. The planner's plot and type checks stay on the context.
     */
    aiPlace: factionPlacement.aiPlace,
    connectFactionRoads: factionPlacement.connectFactionRoads,
    demolishFactionBuilding: factionPlacement.demolishFactionBuilding,
    placeFactionBuilding: factionPlacement.placeFactionBuilding,
    workshopUpgradeAvailability: (uid: number) => {
      const building = context.buildings.find(entry => entry.uid === uid);
      return building ? workshopUpgradeAvailability(context, building) : undefined;
    },
    requestWorkshopUpgrade: (uid: number) => {
      const building = context.buildings.find(entry => entry.uid === uid);
      return !!building && workshopUpgradeAvailability(context, building).available && requestWorkshopUpgrade(building);
    },
    cancelWorkshopUpgrade: (uid: number) => {
      const building = context.buildings.find(entry => entry.uid === uid);
      return !!building && cancelWorkshopUpgrade(building);
    },
    demolishBuilding: (uid:number) => removeMilitarySite(uid, false),
    removeMilitaryScenarioBuilding: (uid:number) => removeMilitarySite(uid, true),
    /** Test/bench fixture: a finished hostile military site (journalled; never in normal play controls). */
    placeMilitaryScenarioBuilding: placement.placeMilitaryScenarioSite,
    dispatchSurveyJob: (job: SurveyJob, target: SettlementPoint) => {
      if (job !== "Geologist" && job !== "Scout") return { ok: false as const, reason: "Unknown surveying job" };
      return assignSurveyJob(context, job, target);
    },
    /** Whether the island lacks a tutorial step's natural resource (the step becomes skippable). */
    missingTutorialResource: (resource: TutorialResource) =>
      isTutorialResourceMissing(resource, options.world, options.resourceTargets, options.countHuntableAnimals),
    surveyedDepositCount: () => options.world.mineZones?.filter(zone => zone.surveyed).length ?? 0,
    surveyedDeposits: () => {
      const cells = new Map<number, SettlementPoint[]>();
      for (let cell = 0; cell < options.world.oreAmount.length; cell++) {
        if (!options.world.oreAmount[cell]) continue;
        const id = options.world.mineZone[cell]!;
        let points = cells.get(id); if (!points) { points = []; cells.set(id, points); }
        points.push({ x: cell % options.world.cellsX + 0.5, z: Math.floor(cell / options.world.cellsX) + 0.5 });
      }
      return options.world.mineZones.map((zone) => ({ id: zone.id, surveyed: zone.surveyed,
        x: zone.centreX, z: zone.centreZ, ore: zone.ore, oreCells: cells.get(zone.id) ?? [] }));
    },
    validatePlacement: placement.validatePlacement,
    /** The construction stock refusal a placement at this plot would get (preview; cached). */
    placementStockReason: placement.placementStockReason,
    /** Berths (1 or 2) a harbour placed here would get; null for other buildings and refused plots. */
    harbourBerthPreview: placement.harbourBerthPreview,
    singleBuildingBuilt: placement.singleBuildingBuilt,
    planRoad: territoryRoads.planRoad,
    ...bridgeCommands,
    ...vergeCommands,
    roadRevision: () => options.roads.revision ?? 0,
    /** Bumped by field and plantation plots, reservations and buildings that change occupancy. */
    navigationRevision: () => context.navigationRevision ?? 0,
    roadSegments: () => options.roads.segments?.() ?? [],
    connectRoads: (start: SettlementPoint, end: SettlementPoint) => {
      const connected = territoryRoads.connectRoads(start, end);
      if (connected) connectNearbyBuildingEntrances(context, territoryRoads.connectRoads);
      return connected;
    },
    upgradeRoad: (start: SettlementPoint, end: SettlementPoint, targetTier: RoadUpgradeTier = "stone") => {
      const plan = territoryRoads.planRoad(start, end, targetTier);
      const point = plan?.points[0];
      if (!point) return false;
      return territoryRoads.upgradeRoad(start, end,
        (cost, material) => payLocalConstructionGoods(context, point, { [material]: cost }), targetTier);
    },
    transferWare: (source: number, destination: number, ware: string, count = 1) =>
      queueWareTransfer(context, source, destination, ware, count),
    setProductionOrder: (uid: number, ware: string, amount: number | null) => {
      const building = context.buildings.find(entry => entry.uid === uid);
      if (!building || building.typeId !== 24 ||
        !ARMORY_OUTPUTS.includes(ware) ||
        !validArmoryOrders({ [ware]: amount })) return false;
      applyArmoryOrder(building, ware, amount);
      return true;
    },
    setProductionMode: (uid: number, ware: string) => {
      const building = context.buildings.find((entry) => entry.uid === uid);
      const outputs = building && (building.typeId === 33
        ? unlockedSawmillRecipes(building).map(recipe => recipe.output)
        : getProductionRule(building.typeId, buildingNation(context, building))?.outputs);
      const mixed = !!building && building.typeId !== 33 && ware === mixedProductionChoice(building.typeId);
      if (!building || building.typeId === 24 || !outputs ||
        (building.typeId !== 33 && outputs.length < 2) ||
        (!mixed && !outputs.includes(ware))) return false;
      building.selectedOutput = mixed ? undefined : ware;
      if (building.typeId === 33) building.handcartMode = undefined;
      return true;
    },
    ...createSettlementBuildingPolicies(context),
    select: (uid: number | null) => {
      for (const building of context.buildings) building.selected = building.uid === uid;
      emitBuildingClicked(context, uid);
    },
    frames: () => context.actors,
    /** Read-only phase/rate/timer classification for one actor (the details panel uses it). */
    workerPhase: (uid: number) => {
      const actor = context.actors.find(entry => entry.uid === uid);
      return actor ? workerPhaseSpec(context, actor) : undefined;
    },
    felledTreeProgress: (id: number) => options.getFelledTreeProgress?.(id),
    navigationDiagnostics: () => ({ military: { ...military.combat.stuckMetrics(),
      pendingOrders: military.combat.pendingOrderCount() }, repairs: navigationRepairMetrics(context),
      actors: navigationProgressSnapshot(context) }),
    availableSettlers: (uid?: number) => {
      if (uid === undefined) return availableIdleSettlers(context);
      const storage = context.buildings.find(building => building.uid === uid);
      return storage ? availableIdleSettlers(context, storage) : 0;
    },
    settlerBirths: () => context.population!.births,
    /** People on the island and its limit (undefined on an island without a home building). */
    population: () => ({ limit: populationLimit(context), people: islandPeople(context) }),
    /**
     * Recorded (ledger): adopting rules that switch talents off also drops the applied modifiers (plan §9.1); the
     * new rules' state consequences (GS4a: trade refund, fog reveal) follow in the same command.
     */
    adoptGameRules: (rules: unknown): true | string => {
      const adopted = adoptGameRulesWithTalents(context, rules);
      if (adopted === true) applyGameRuleEffects(context);
      return adopted;
    },
    /** Recorded: the player's home-island building rules (MAP BUILDING AVAILABILITY); a string refuses. */
    setHomeBuildingRules: (rules: unknown) => setHomeBuildingRules(context, rules),
    /** The building rules this island plays with now (map, campaign blacklist or the home override). */
    buildingAvailability: () => contextBuildingAvailability(context),
    homeBuildingRules: () => context.homeBuildingRules,
    /** The map tier a material producer still needs above the cap; null when allowed (the menu greys it). */
    buildingTierBlock: (typeId: number) => buildingTierBlock(context, typeId),
    /** The player's applied talent ranks (journalled); false when invalid or talents are switched off. */
    setTalentRanks: (ranks: unknown) => setContextTalentRanks(context, ranks),
    talentModifiers: () => contextTalents(context),
    /** A type's production speed share from talents on this island (the colony capstone only on colonies). */
    productionTalentBonus: (typeId: number) => productionTalentBonus(context, typeId),
    territory: () => settlementTerritory(context),
    ownsTerritory: (point: SettlementPoint) => ownsTerritoryPoint(context, point),
    ...simulationMilitaryCommands(military, context),
    orderTavernRecruits: (uid: number, type: unknown, count: number) => tavern.orderRecruits(uid, type, count),
    tavernOrders: tavern.snapshot,
    ...simulationTradeCommands(trade),
    ...simulationStorageCommands(context),
    /** Whether the home storage could take these goods now (a server purchase checks before paying). */
    canDeliverHome: (goods: Readonly<Goods>) => Boolean(homeStorage(context.buildings)) &&
      canStoreGoods(context.buildings, goods, contextTalents(context).storageCapacity, homeStorage(context.buildings)),
    /** Gem shop: goods into the home storage. */
    deliverHome: (goods: Readonly<Goods>) => {
      const home = homeStorage(context.buildings);
      if (!home ||
        !canStoreGoods(context.buildings, goods, contextTalents(context).storageCapacity, home)) return false;
      addToHome([home], goods);
      return true;
    },
    /** Hand carts a storage owns, including those out on a trip. */
    handcarts: (uid: number) => handcartCount(context, uid),
    ...debugCommands.commands,
    ...shoreShells,
    ...simulationNavalCommands(naval),
    /** Catapult Tower ammunition kind for new deliveries (CAT-AMMO); false for any other building. */
    setCatapultAmmo: (uid: number, kind: CatapultAmmoKind) => {
      const building = findBuilding(context, uid);
      const previous = building ? catapultAmmoChoice(building) : undefined;
      const changed = setCatapultAmmo(building, kind);
      if (changed && building && previous !== kind) cancelQueuedAmmoTransfers(context, building.uid, kind);
      return changed;
    },
    catapultAmmo: (uid: number): CatapultAmmoKind | undefined => {
      const building = findBuilding(context, uid);
      return building?.typeId === 16 ? catapultAmmoChoice(building) : undefined;
    },
    /** Sawmill production: planks, or hand carts for the nearest storage with room. */
    setSawmillMode: (uid: number, mode: SawmillMode) => setSawmillMode(findBuilding(context, uid), mode),
    sawmillMode: (uid: number): SawmillMode => {
      const building = findBuilding(context, uid);
      return building ? sawmillMode(building) : "planks";
    },
    /** Fishery rod or boat fishing; boat needs a sea/lake shore and a spare island boat (FISHER-BOAT). */
    setFisherMode: (uid: number, mode: FisherMode) => setFisherMode(context, findBuilding(context, uid), mode),
    fisherBoatStatus: (uid: number) => fisherBoatStatus(context, findBuilding(context, uid)),
    /** Soldiers this island's military buildings still miss beyond its stored and incoming ones. */
    garrisonShortfall: () => garrisonShortfall(military.snapshot(),
      coveredTroops(military.soldiers(), naval.snapshot())),
    /** Stock of one ware across completed storages. */
    resourceTotal: homeAvailable,
    /** The recorded quest claim (TRG6): cost out of the stock, reward goods home, in one journalled step. */
    claimQuest: (claim: QuestClaimCommand) => claimIslandQuest(context, claim, homeAvailable),
    /** Survivors of an ended colony join the home reserves. */
    receiveTroops: military.immigrate,
    /** Campaign settlers home (C9b): stored within the people limit; null without a finished home building. */
    receiveSettlers: (count: number) => receiveReturningSettlers(context, count),
    /** An expired colony's goods and troops; its people stay behind (owner 2026-10-20). */
    receiveColonyEvacuation: (assets: import("./colony-expiry-assets").ColonyExpiryAssets) => {
      const home = context.buildings.find(b => b.typeId === 39 && b.construction === 1 && isOwnBuilding(b)) ?? headquarters;
      if (!home) return false;
      for (const [ware, count] of Object.entries(assets.cargo)) addGood(home.inventory, ware, count);
      military.storeReturnedTroops(assets.troops, home);
      return true;
    },
    adventureCampSites: adventure.campFrames,
    /** Development menu: grants what a colony or adventure needs and starts it with test timers. */
    startDebugExpedition: debugExpeditions.start,
    shipFrames: () => [...naval.frames(), ...adventure.shipFrames(), ...colony.shipFrames()],
    shipSites: () => [...naval.sites(), ...adventure.shipSites(), ...colony.shipSites()],
    /** Fishery skiffs outside their yards (FISHER-BOAT render frames). */
    fishingBoatFrames: () => fisherBoatFrames(context),
    /**
     * Transport horses; a horse waiting beside its dismounted rider is drawn there (not in traffic), and
     * riders' horses stand on an adventure's landing ship until their riders mount.
     */
    horseFrames: () => {
      const frames = context.horses!.frames();
      // A led landing horse is drawn where it walks, also while its rider counts as dismounted.
      const shown = new Map([...military.combat.waitingHorses(), ...adventure.horseFrames(),
        ...naval.troopShipHorseFrames()]
        .map(frame => [frame.id, frame]));
      if (!shown.size) return frames;
      return [...frames.filter(frame => !shown.has(frame.id)), ...shown.values()];
    },
    fieldFrames: () => withHarvestProgress(context.fieldCycles!.snapshot(), context),
    /** Raw site objects for the event core (no render harvest overlay). */
    fieldSites: () => context.fieldCycles!.snapshot(),
    fieldRevision: () => context.fieldCycles!.revision(),
    setFarmArea: (uid: number, bounds: FarmAreaBounds | null) => context.fieldCycles!.setFarmArea(uid, bounds),
    farmArea: (uid: number) => context.fieldCycles!.farmArea(uid),
    setStoneArea: (uid: number, bounds: FarmAreaBounds | null) => setStoneArea(context, uid, bounds),
    stoneArea: (uid: number) => stoneArea(context, uid),
    buildings: () => context.buildings.filter(building => !isRoadWorkShell(building)),
    /** Carts standing without a crew (MIL-CREWS), drawn where they stopped. */
    abandonedHandcarts: (): readonly AbandonedHandcart[] => context.abandonedHandcarts ?? [],
    /** Ruins of fallen buildings waiting for the clearing job (BD2; drawn by BD4). */
    ruins: (): readonly SettlementRuin[] => context.ruins ?? [],
    snapshot: () => ({
      settlersInside: context.settlers,
      buildings: context.buildings.filter(building => !isRoadWorkShell(building)).map((building) => ({ ...building,
        productionOrders: building.productionOrders && { ...building.productionOrders }, input: { ...building.input },
        output: { ...building.output }, inventory: { ...building.inventory }, incoming: { ...building.incoming },
        workshopUpgrade: building.workshopUpgrade && { ...building.workshopUpgrade },
        constructionConsumed: { ...building.constructionConsumed }, exports: { ...building.exports }, accepts: { ...building.accepts }, access: { ...building.access }, required: { ...building.required } })),
      actors: context.actors.map((actor) => ({ ...actor, path: actor.path.slice() }))
    }),
    /** Offline catch-up: applies a skip planned from measured steady rates. */
    fastForward: (skip: SettlementFastForward) => fastForwardWithRecovery(context, military, skip),
    /** Share of the next fixed tick already elapsed (0..1): renderers draw between ticks. */
    tickFraction: () => Math.min(1, context.accumulator / TICK_SECONDS),
    /** Exact saved render remainder, without the rounding of fraction division/multiplication. */
    frameAccumulator: () => context.accumulator,
    /** Replay metadata at an already-replayed endpoint; never executes a tick or advances game time. */
    restoreReplayAccumulator: (value: unknown, atTick: number) => restoreReplayFrameAccumulator(context, value, atTick),
    tickCount: () => ticksRun,
    /** Whether the next fixed ticks are provably limited to clock/runtime/timer-residue work. */
    quietSkipStatus: quietSkip.quietSkipStatus,
    /** Offline opt-in: advance only the clocks a quiet island changes, or 0 when not provably quiet. */
    advanceQuietTicks: quietSkip.advanceQuietTicks,
    advanceMovementSkipTicks: createMovementSkipTicker(context, systems, clock),
    /** Phase A event-core ownership: the fixed scheduler calls this at the exact population/stone phase. */
    eventPopulationTick: (dt: number) => updatePopulationGrowth(context, dt),
    eventStoneTick: (dt: number) => updateStoneRespawns(context, dt, RESPAWNING_DEPOSITS),
    ...eventActorHandlers,
    randomAudit: () => context.randomAudit!,
    /** Counter checksum (RNG states, entity counts, next ids, pending timers): cheap, every tick. */
    counterChecksum: () => counterChecksum(context, military),
    /** Runs `listener` after every fixed tick (command log checksums). Returns its unsubscribe. */
    observeTicks: (listener: () => void) => addTickListener(tickListeners, listener),
    /** Game time (UTC ms): the session anchor plus the island's saved ticks × 50 ms. */
    gameNow: clock.now,
    /** Ticks the island has run in total (saved, unlike `tickCount`). */
    gameTick: clock.tick,
    /** Offline jumps: the clock covers the skipped ticks the simulation did not step. */
    advanceClock: (ticks: number) => { shiftClaimLeases(context.actors, ticks); clock.advance(ticks); },
    /** Catch-up skip (plan §10): game time reaches `time` (UTC ms) without ticks, like a reloaded skipped save. */
    rebaseClock: (time: number) => clock.rebase(time),
    update: (dt: number) => {
      if (!Number.isFinite(dt) || dt <= 0) return;
      // Fixed simulation steps preserve resource accounting and avoid tunnelling on slow frames.
      // Bound render-driven updates; the offline worker separately replays elapsed wall time in fixed ticks.
      context.accumulator += Math.min(dt, 1);
      while (context.accumulator >= TICK_SECONDS) {
        tick(TICK_SECONDS); context.script?.endTick();
        context.accumulator -= TICK_SECONDS; ticksRun++; clock.advance(1);
        for (const listener of tickListeners) listener();
      }
    }
  };
};
export type SettlementSimulation = ReturnType<typeof createSettlementSimulation>;
