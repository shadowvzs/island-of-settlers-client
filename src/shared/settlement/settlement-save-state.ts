import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import {
  FORMATS, type FormatVersionIssue, formatVersionIssue
} from "../../../../island-of-settlers-shared/src/formats";
import { isWorkerNation } from "../../render-common/workers/worker-appearance";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { POPULATION_GROWTH_SECONDS } from "../balance/population";
import { type CampaignMapProgress, campaignMapProgressError } from "../campaign/campaign-map-outcome";
import { tradeCustodyReason } from "../trade/trade-custody";
import { validateTradeSave } from "../trade/trade-save";
import { colonyResourcePair } from "../world/colony-resource-tiers";
import { MAX_MARBLE_DEPOSITS } from "../world/marble-deposit";
import { validScenarioDecorations } from "../world/scenario-decorations";
import { validAuthoredObjectUids } from "./authored-object-uids";
import { validAuthoredPatrolProgress } from "./authored-scenario-patrol";
import type { AuthoredScenarioProgress } from "./authored-scenario-progress";
import { type StoneRespawn, validStoneRespawns } from "./boulder-respawn";
import { bridgeSitesRoadProblem } from "./bridge-construction";
import { bridgeDecks } from "./bridge-deck";
import type { BridgeRemoval } from "./bridge-dismantling";
import { bridgeRemovalsProblem } from "./bridge-removal-save";
import { savedBridgeBankProblem } from "./bridge-river-banks";
import { bridgeRoadProblem } from "./bridge-road";
import { type MarbleDeposit,validMarbleDeposits } from "./colony-marble-deposits";
import { type DifficultyLevel,isDifficultyLevel } from "./difficulty";
import {
  factionAiSaveError, savedEconomyFaction, savedFactionAiFactions
} from "./economy-ai/faction-ai-save-validation";
import { isGameTick } from "./game-clock";
import { hostileCivilianEmployerError } from "./hostile-civilian-ownership";
import { catapultPorterReferencesError } from "./military-catapult-resupply";
import { STORAGE_IDS } from "./production-rules";
import { roadDecorationSaveProblem } from "./road-decoration-save";
import type { RoadSegment } from "./road-types";
import { isSparseCells, RUIN_OCCUPANCY_VALUE_MAX, type SparseCells } from "./save-cell-codecs";
import {
  isFiniteNumber, isSafeTree, isSaveInteger, isSaveObject, isSavePoint, SAVE_TREE_DEPTH
} from "./save-validation";
import { committedWorkerInputs, reservedInputReturns } from "./sawmill-input-returns";
import { validScoutExploration } from "./scout-exploration";
import type { SettlementAdventureSave } from "./settlement-adventure";
import { SETTLEMENT_WARES } from "./settlement-building-policies";
import type { SettlementColonySave } from "./settlement-colony";
import { validateAdventureSave, validateColonySave } from "./settlement-colony-validation";
import { validateStorageTraffic } from "./settlement-door-traffic-save";
import type { FarmAreaBounds } from "./settlement-farm-area";
import {
  FIELD_KINDS, FIELD_STATES, type FieldKind, type FieldState, type SettlementFieldFrame
} from "./settlement-field-cycles";
import { abandonedHandcartsError } from "./settlement-handcart-abandon-save";
import { type SettlementMilitarySave,validateMilitarySave } from "./settlement-military-state";
import { movementResumeProblem } from "./settlement-movement-resume";
import type { createSettlementNaval } from "./settlement-naval";
import { validateNavigationRevisions } from "./settlement-navigation-revision-save";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { validateReliefCollectionSave } from "./settlement-relief-collections";
import { ruinCellsMatch, savedRuinsProblem } from "./settlement-ruin-save";
import type { SettlementRuin } from "./settlement-ruins";
import { validateSavedActors } from "./settlement-save-actors";
import { validateSavedBuildings } from "./settlement-save-buildings";
import type { SettlementSaveIntegrity } from "./settlement-save-integrity";
import { validateNavalState } from "./settlement-save-naval";
import { islandScriptProblem } from "./settlement-script-snapshot";
import { validateStockTraffic } from "./settlement-stock-traffic-save";
import type { SurveyState } from "./settlement-surveying";
import { validateTavernSave } from "./settlement-tavern-state";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "./settlement-types";
import { validStoragePools } from "./shared-storage";
import { isValidShoreShellLedger, type ShoreShellLedger } from "./shore-shell-collection";
import { gameRulesProblem } from "./sim-rules";
import { isHomeBuildingRules } from "./building-availability-rules";
import type { StockLandLinks } from "./stock-lands";
import { validateTransferOrderClaims } from "./transport-reuse-save";

/** 4: occupancy as sparse cells (research 12, S04). */
export const SETTLEMENT_SAVE_VERSION = FORMATS.settlement.current;

const SETTLEMENT_SAVE_VERSION_ERRORS: Readonly<Record<FormatVersionIssue, string>> = {
  invalidVersion: "Invalid settlement save version",
  newerVersion: "Settlement save was created by a newer version",
  unsupportedVersion: "Unsupported settlement save version"
};

export interface SettlementSaveV1 {
  roadDecorations?: import("./road-decoration-state").RoadDecorationSave;
  /** Fixed map scenery: the authored decoration rows spawned at the map start (owned by nobody). */
  roadDecorationScenery?: import("../world/scenario-decorations").ScenarioDecoration[];
  /** Paths already rounded/lane-offset, including actors still waiting at waypoint zero. */
  preparedRoadActors?: number[];
  /** Stores that recently found no idle settler; consumed by the next newborn's walk. */
  settlerDemand?: number[];
  /** Rotation of the equivalent output-dispatch scan. */
  landDispatchCursor?: number;
  navigationRevisions?: import("./settlement-load-revisions").SavedNavigationRevisions;
  /** Movement memories a reload resumes: repair budget, detour waits, road checks, yield budgets (format 21). */
  movementResume?: import("./settlement-movement-resume").SavedMovementResume;
  storageTraffic?: import("./settlement-door-traffic-state").SavedStorageTraffic;
  stockTraffic?: import("./settlement-stock-traffic").SavedStockTraffic;
  authoredScenario?: AuthoredScenarioProgress;
  /** Campaign maps only (C9a): landing harbour uid and the map's outcome. */
  campaignMap?: CampaignMapProgress;
  /** The map script snapshot (TRG1): revision + hash, plus the script when the map header differs. */
  scriptSnapshot?: import("../../../../island-of-settlers-shared/src/script/snapshot").StoredScriptSnapshot;
  /** The running map script (TRG3a): engine run state, reused-uid generations, door watch; with the snapshot. */
  scriptRun?: import("../script-world/settlement-script-save").SavedSettlementScript;
  playerNation?: WorkerNation;
  /** The pinned game rules (GS2, sim-rules.ts); absent = legacy, today's game. */
  gameRules?: import("../../../../island-of-settlers-shared/src/game-settings/sim-rules").SimRules;
  /** The player's home-island building rules (MAP BUILDING AVAILABILITY); absent = the map's. */
  homeBuildingRules?: import("./building-availability-rules").HomeBuildingRules;
  /** Non-Normal computer-side difficulty; absent in Normal games and every older save. */
  difficulty?: DifficultyLevel;
  format: typeof FORMATS.settlement.id;
  version: typeof FORMATS.settlement.current;
  storagePools: import("./shared-storage").StoragePoolState;
  world: { seed: number; cellsX: number; cellsZ: number };
  buildings: SettlementBuilding[];
  actors: SettlementActor[];
  settlers: number;
  /** Seconds toward the island's next base settler birth (POP-01). */
  settlerGrowthTime: number;
  /** Settlers born on the island so far. */
  settlerBirths: number;
  nextActor: number;
  nextBuilding: number;
  accumulator: number;
  scheduling: number;
  /** Game clock ticks the island has run (game-clock.ts); absent before 2026-10-22. */
  gameTick?: number;
  /**
   * Expected entity and timer counts at capture. Snapshot verification (headless replay) checks them; ordinary
   * loads do not, since colony expiry and troop supply legitimately edit stored saves.
   */
  integrity?: SettlementSaveIntegrity;
  plantingRandomState: number;
  /** [actor uid, construction side, work edge]; saves before 2026-10-12 omit the edge. */
  builderSides: ([number, number] | [number, number, number])[];
  occupied: import("./save-cell-codecs").SparseCells;
  reservations: string[];
  /** Opt-in worker corridor reservations (cells sampled at half-cell resolution). */
  corridorReservations?: import("./settlement-corridor-reservations").SavedCorridorReservations;
  /** Bounded carrier detour retry cursor/stall age; absent in older saves. */
  carrierDetours?: import("./settlement-carrier-detours").SavedCarrierDetour[];
  /**
   * Saved by an island without a stock layout (tools and test fixtures place every contact at the access):
   * a load into an island with a layout moves those contacts onto it once.
   */
  plainStockContacts?: true;
  resourceAmounts: [string, number][];
  marbleDeposits?: MarbleDeposit[];
  /** Worked out stone sources (quarry boulders, material deposits) waiting to respawn. */
  stoneRespawns?: StoneRespawn[];
  /** Collected shore shells that reappeared elsewhere (home island). */
  shoreShells?: ShoreShellLedger;
  transfers: SettlementContext["transfers"];
  nextTransferId?: number;
  fields: SettlementFieldFrame[];
  stoneAreas: [number, FarmAreaBounds][];
  surveys: [number, SurveyState][];
  naval: ReturnType<ReturnType<typeof createSettlementNaval>["saveState"]>;
  roads: RoadSegment[];
  /** Bridges closing or being dismantled (absent when none). */
  bridgeRemovals?: import("./bridge-dismantling").BridgeRemoval[];
  /** Carts standing without a crew (MIL-CREWS; absent when none). */
  abandonedHandcarts?: import("./settlement-types").AbandonedHandcart[];
  /** Ruins waiting for the clearing job (BD2, format 15; absent when none). */
  ruins?: import("./settlement-ruins").SettlementRuin[];
  military?: SettlementMilitarySave;
  colony?: SettlementColonySave;
  adventure?: SettlementAdventureSave;
  tavern?: import("./settlement-tavern-state").SettlementTavernSave;
  /** The enemy economy AI per AI faction (EAI2a, format 15); absent on maps without AI and in older saves. */
  factionAi?: import("./economy-ai/faction-ai-types").FactionAiSave[];
  /** Trade office state (TRADE-01); absent in saves made before it. */
  trade?: import("../trade/trade-types").SettlementTradeSave;
  reliefCollections?: import("./settlement-relief-collections").ReliefCollectionSave;
}

/** The save's own bridges (validated below): its pools follow them, not the island's current roads. */
const savedStockLinks = (value: Record<string, unknown>): StockLandLinks => ({
  removals: Array.isArray(value.bridgeRemovals) ? value.bridgeRemovals as BridgeRemoval[] : [],
  segments: Array.isArray(value.roads) ? (value.roads as RoadSegment[]).filter(segment =>
    isSaveObject(segment) && isSaveObject(segment.bridge) && isSavePoint(segment.start) && isSavePoint(segment.end))
    : []
});

const isReplacedFlag = (value: unknown) => value === undefined || value === true;
/** A saved carrier detour retry: phase, path index, cursor and seconds left to wait. */
const isSavedDetourRetry = (entry: Record<string, unknown>) =>
  typeof entry.phase === "string" && isSaveInteger(entry.pathIndex) && entry.pathIndex >= 0 &&
  isSaveInteger(entry.cursor) && entry.cursor >= 0 && isFiniteNumber(entry.remaining) && entry.remaining >= 0 &&
  isReplacedFlag(entry.replaced);
const isOptionalNumber = (value: unknown) => value === undefined || isFiniteNumber(value);
/** A saved carrier leg start (format 21): its point and, once it moved, its unit direction. */
const isSavedCarrierLeg = (leg: unknown) => isSavePoint(leg) && isOptionalNumber(leg.directionX) &&
  isOptionalNumber(leg.directionZ);
const isSavedCarrierJourney = (journey: unknown) => isSaveObject(journey) && typeof journey.phase === "string" &&
  isFiniteNumber(journey.destinationX) && isFiniteNumber(journey.destinationZ) && isFiniteNumber(journey.closest) &&
  isFiniteNumber(journey.elapsed) && isReplacedFlag(journey.replaced);
const isSavedCarrierDetour = (entry: unknown) => isSaveObject(entry) && isSaveInteger(entry.actor) &&
  (entry.phase !== undefined || entry.journey !== undefined || entry.leg !== undefined) &&
  (entry.leg === undefined || isSavedCarrierLeg(entry.leg)) &&
  (entry.phase === undefined || isSavedDetourRetry(entry)) &&
  (entry.journey === undefined || isSavedCarrierJourney(entry.journey));
/** One entry per known actor: its retry, journey and/or leg; absent in older saves. */
const validCarrierDetours = (detours: unknown, actors: readonly SettlementActor[]) => {
  if (detours === undefined) return true;
  if (!Array.isArray(detours) || !detours.every(isSavedCarrierDetour)) return false;
  const uids = detours.map(entry => (entry as { actor: number }).actor);
  return new Set(uids).size === uids.length && uids.every(uid => actors.some(actor => actor.uid === uid));
};

/** Validate everything before touching live economy, cargo, topology or worker state. */
export const validateSettlementSave = (
  value: unknown,
  context: Pick<SettlementContext, "options">
): string | null => {
  if (!isSaveObject(value) || value.format !== FORMATS.settlement.id)
    return "Unsupported settlement save format";
  const versionIssue = formatVersionIssue(FORMATS.settlement, value.version);
  if (versionIssue) return SETTLEMENT_SAVE_VERSION_ERRORS[versionIssue];
  if (!isSafeTree(value, SAVE_TREE_DEPTH.settlement)) return "Save contains invalid numeric or object data";
  const decorationProblem = roadDecorationSaveProblem(value.roadDecorations);
  if (decorationProblem) return decorationProblem;
  if (!validScenarioDecorations(value.roadDecorationScenery, context.options.world.cellsX,
    context.options.world.cellsZ)) return "Invalid map scenery decorations";
  if (value.playerNation !== undefined && !isWorkerNation(value.playerNation)) return "Invalid player nation";
  if (value.difficulty !== undefined && !isDifficultyLevel(value.difficulty))
    return "Invalid difficulty";
  const world = context.options.world;
  if (!isSaveObject(value.storagePools) || !Array.isArray(value.buildings) ||
    !validStoragePools(context as SettlementContext, value.storagePools as unknown as SettlementSaveV1["storagePools"],
      value.buildings as SettlementBuilding[], savedStockLinks(value)))
    return "Invalid shared storage pools";
  if ((value.storagePools as unknown as SettlementSaveV1["storagePools"]).pools.some(pool =>
    pool.collect?.some(ware => !SETTLEMENT_WARES.includes(ware)))) return "Invalid storage collection ware";
  if (value.preparedRoadActors !== undefined && (!Array.isArray(value.preparedRoadActors) ||
    new Set(value.preparedRoadActors).size !== value.preparedRoadActors.length ||
    value.preparedRoadActors.some(uid => !Number.isSafeInteger(uid) ||
      !(value.actors as SettlementActor[]).some(actor => actor.uid === uid)))) return "Invalid prepared road actors";
  if (value.settlerDemand !== undefined && (!Array.isArray(value.settlerDemand) ||
    value.settlerDemand.some(uid => !Number.isSafeInteger(uid) ||
      !(value.buildings as SettlementBuilding[]).some(building => building.uid === uid))))
    return "Invalid settler demand";
  if (value.landDispatchCursor !== undefined &&
    (typeof value.landDispatchCursor !== "number" || !Number.isSafeInteger(value.landDispatchCursor) ||
      value.landDispatchCursor < 0)) return "Invalid land dispatch cursor";
  if (value.plainStockContacts !== undefined && value.plainStockContacts !== true) return "Invalid stock contact marker";
  if (!validCarrierDetours(value.carrierDetours, value.actors as SettlementActor[])) return "Invalid carrier detours";
  const navigationRevisionProblem = validateNavigationRevisions(value.navigationRevisions, value.actors);
  if (navigationRevisionProblem) return navigationRevisionProblem;
  const movementResumeIssue = movementResumeProblem(value.movementResume,
    new Set((value.actors as SettlementActor[]).map(actor => actor.uid)));
  if (movementResumeIssue) return movementResumeIssue;
  const stockTrafficProblem = validateStockTraffic(value.stockTraffic, value.actors, value.buildings);
  if (stockTrafficProblem) return stockTrafficProblem;
  const storageTrafficProblem = validateStorageTraffic(value.storageTraffic, value.actors, value.buildings);
  if (storageTrafficProblem) return storageTrafficProblem;
  if (!validMarbleDeposits(value.marbleDeposits, world.cellsX, world.cellsZ)) return "Invalid marble deposits";
  if (value.marbleDeposits?.some(source => source.sourceProp !== undefined && source.sourceProp >= world.props.count))
    return "Invalid material source prop identity";
  if (world.colonyResourceTier && value.marbleDeposits?.some(source =>
    (source.material ?? "marble") !== colonyResourcePair(world.colonyResourceTier!).stone))
    return "Material deposits do not match the discovered colony pair";
  if (!validStoneRespawns(value.stoneRespawns, world, MAX_MARBLE_DEPOSITS)) return "Invalid stone source respawns";
  if (value.shoreShells !== undefined && !isValidShoreShellLedger(value.shoreShells, Number.MAX_SAFE_INTEGER))
    return "Invalid shore shells";
  if (
    !isSaveObject(value.world) ||
    value.world.seed !== world.seed ||
    value.world.cellsX !== world.cellsX ||
    value.world.cellsZ !== world.cellsZ
  )
    return "Save belongs to a different island";
  for (const key of [
    "buildings",
    "actors",
    "reservations",
    "resourceAmounts",
    "transfers",
    "fields",
    "stoneAreas",
    "surveys",
    "roads",
    "builderSides"
  ])
    if (!Array.isArray(value[key])) return `Missing ${key}`;
  const bridgeProblem = bridgeRoadProblem(value.roads as RoadSegment[]) ??
    savedBridgeBankProblem(world, bridgeDecks(value.roads as RoadSegment[])) ??
    bridgeSitesRoadProblem(value.roads as RoadSegment[], value.buildings as unknown[]) ??
    bridgeRemovalsProblem(value.bridgeRemovals, value.roads as RoadSegment[], value.buildings as unknown[]);
  if (bridgeProblem) return bridgeProblem;
  if (abandonedHandcartsError(value.abandonedHandcarts, value.buildings as SettlementBuilding[]))
    return "Invalid abandoned hand carts";
  const ruinProblem = savedRuinsProblem(value.ruins, value.buildings as unknown[], value.actors as unknown[]);
  if (ruinProblem) return ruinProblem;
  if (
    !isSaveInteger(value.settlers) ||
    !isSaveInteger(value.settlerBirths) ||
    !isFiniteNumber(value.settlerGrowthTime) ||
    value.settlerGrowthTime < 0 ||
    value.settlerGrowthTime >= POPULATION_GROWTH_SECONDS ||
    !isSaveInteger(value.nextActor) ||
    !isSaveInteger(value.nextBuilding) ||
    !isFiniteNumber(value.accumulator) ||
    value.accumulator < 0 ||
    value.accumulator >= 0.05 + 1e-8 ||
    !isFiniteNumber(value.scheduling) ||
    value.scheduling < 0 ||
    value.scheduling >= 0.5 + 1e-8 ||
    (value.gameTick !== undefined && !isGameTick(value.gameTick))
  )
    return "Invalid population or simulation timing";
  if (value.authoredScenario !== undefined) {
    const scenario = value.authoredScenario;
    if (!isSaveObject(scenario) || !validAuthoredPatrolProgress(scenario.patrols, world.scenario) ||
      !isFiniteNumber(scenario.elapsed) || scenario.elapsed < 0 ||
      !isFiniteNumber(scenario.claiming) || scenario.claiming < 0 ||
      !["active", "won", "expired"].includes(String(scenario.status)) || typeof scenario.rewardPaid !== "boolean" ||
      !isSaveInteger(scenario.pendingCoins) || !Array.isArray(scenario.sites) ||
      scenario.sites.length > 128 || !scenario.sites.every(id => isSaveInteger(id)) ||
      !validAuthoredObjectUids(scenario.objects)) return "Invalid authored scenario progress";
  }
  const campaignProblem = campaignMapProgressError(value.campaignMap);
  if (campaignProblem) return campaignProblem;
  const scriptProblem = islandScriptProblem(value.scriptSnapshot, value.scriptRun, world);
  if (scriptProblem) return scriptProblem;
  const rulesProblem = gameRulesProblem(value.gameRules);
  if (rulesProblem) return rulesProblem;
  if (value.homeBuildingRules !== undefined && !isHomeBuildingRules(value.homeBuildingRules))
    return "Invalid home building rules";
  if (!isSaveInteger(value.plantingRandomState) || value.plantingRandomState > 0xffffffff)
    return "Invalid planting random state";
  const buildings = value.buildings as unknown[],
    actors = value.actors as unknown[];
  const ids = new Set<number>(),
    actorIds = new Set<number>();
  const expectedHomes = context.options.homeBuilding === null ? 0 : 1;
  const buildingReason = validateSavedBuildings(buildings, world, ids, expectedHomes);
  if (buildingReason) return buildingReason;
  const stores = buildings as SettlementBuilding[];
  // The saved total is the player's: a computer economy's idle people stay in its own storages (EAI1a D4).
  const economyFaction = savedEconomyFaction(context, value.factionAi);
  const playerIdle = (sum: number, building: SettlementBuilding) =>
    ownerOf(building) === PLAYER_FACTION || !economyFaction(ownerOf(building)) ? sum + (building.idleSettlers ?? 0) : sum;
  if (stores.reduce(playerIdle, 0) !== value.settlers) return "Inconsistent storage population";
  const actorReason = validateSavedActors(actors, ids, actorIds, value.gameTick ?? 0, economyFaction);
  if (actorReason) return actorReason;
  if (
    [...ids].some((uid) => uid >= (value.nextBuilding as number)) ||
    [...actorIds].some((uid) => uid >= (value.nextActor as number))
  )
    return "Invalid identity counters";
  if (!isSparseCells(value.occupied, world.cellsX * world.cellsZ, RUIN_OCCUPANCY_VALUE_MAX) ||
    !ruinCellsMatch(value.occupied as SparseCells, value.ruins as SettlementRuin[] | undefined, world.cellsX))
    return "Invalid building occupancy";
  if (Array.isArray(value.marbleDeposits) && value.marbleDeposits.some(source =>
    source.remaining > 0 && (value.buildings as SettlementBuilding[]).some(building =>
      Math.abs(source.x - building.x) < building.width / 2 + .9 &&
      Math.abs(source.z - building.z) < building.depth / 2 + .9))) return "Marble overlaps a building";
  if (!(value.reservations as unknown[]).every((item) => typeof item === "string"))
    return "Invalid reservations";
  if (value.corridorReservations !== undefined &&
    (!Array.isArray(value.corridorReservations) || !value.corridorReservations.every((entry) =>
      Array.isArray(entry) && entry.length === 5 && isSaveInteger(entry[0]) &&
      typeof entry[1] === "string" && typeof entry[2] === "string" &&
      isSaveInteger(entry[3]) && Array.isArray(entry[4]) &&
      entry[4].every(cell => typeof cell === "string"))))
    return "Invalid corridor reservations";
  if (value.corridorReservations) {
    const reservations = value.corridorReservations as [number, string, string, number, string[]][];
    const reservationRevisions = new Map(reservations.map(entry => [entry[0], entry[2]]));
    for (const actor of value.actors as SettlementActor[]) {
      const revision = reservationRevisions.get(actor.uid);
      if (actor.workerMovementPlan && revision !== undefined &&
        actor.workerMovementPlan.revision !== revision)
        return "Movement plan and corridor reservation revision differ";
    }
  }
  if (
    !(value.resourceAmounts as unknown[]).every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        isFiniteNumber(entry[1]) &&
        entry[1] >= 0
    )
  )
    return "Invalid resource amounts";
  for (const field of value.fields as unknown[])
    if (
      !isSaveObject(field) ||
      !isSaveInteger(field.id) ||
      !ids.has(field.owner as number) ||
      !isSavePoint(field) ||
      !isFiniteNumber(field.progress) ||
      field.progress < 0 ||
      field.progress > 1 ||
      !FIELD_KINDS.includes(field.kind as FieldKind) ||
      !FIELD_STATES.includes(field.state as FieldState)
    )
      return "Invalid field state";
  const save = value as unknown as SettlementSaveV1;
  if ((save.colony || save.adventure) && save.buildings.some(site => site.eventCourtyard))
    return "Courtyard fortifications are reserved for events";
  for (const entry of save.builderSides)
    if (
      !Array.isArray(entry) ||
      (entry.length !== 2 && entry.length !== 3) ||
      !actorIds.has(entry[0]) ||
      !isSaveInteger(entry[1]) ||
      entry[1] > 3 ||
      (entry.length === 3 && (!isSaveInteger(entry[2]) || entry[2] < 0 || entry[2] > 3))
    )
      return "Invalid builder work side";
  const hostileCivilianError = hostileCivilianEmployerError(save.actors, save.buildings, economyFaction);
  if (hostileCivilianError) return hostileCivilianError;
  const employed = new Set<number>();
  for (const building of save.buildings) {
    if (building.worker !== undefined && (!actorIds.has(building.worker) || employed.has(building.worker)))
      return "Invalid building worker reference";
    if (building.worker !== undefined) employed.add(building.worker);
    if (building.typeId !== 16 || building.construction !== 1) continue;
    const worker = save.actors.find(actor => actor.uid === building.worker);
    if (worker && (worker.job !== "Carrier" || worker.building !== building.uid || worker.delivery ||
      worker.handcart || worker.demolitionReturning || worker.navalOrder !== undefined))
      return "Invalid catapult worker reference";
    const supplyError = catapultPorterReferencesError(building,
      save.actors.find(actor => actor.uid === building.catapultSupply?.porter?.actor));
    if (supplyError) return supplyError;
  }
  const transferClaimProblem = validateTransferOrderClaims(save.transfers, save.actors, save.nextTransferId);
  if (transferClaimProblem) return transferClaimProblem;
  for (const order of save.transfers)
    if (
      !isSaveObject(order) ||
      !ids.has(order.source) ||
      !ids.has(order.destination) ||
      typeof order.ware !== "string" ||
      !isSaveInteger(order.count, 1)
    )
      return "Invalid scheduled transfer";
  for (const entry of save.stoneAreas)
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !ids.has(entry[0]) ||
      !isSaveObject(entry[1]) ||
      !(["minX", "maxX", "minZ", "maxZ"] as const).every((key) => isFiniteNumber(entry[1][key]))
    )
      return "Invalid work area";
  for (const entry of save.surveys)
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !actorIds.has(entry[0]) ||
      !isSaveObject(entry[1]) ||
      !["Geologist", "Scout"].includes(entry[1].job) ||
      !isSavePoint(entry[1].origin) ||
      !Array.isArray(entry[1].targets) ||
      !entry[1].targets.every(isSavePoint) ||
      !isSaveInteger(entry[1].index) ||
      entry[1].index > entry[1].targets.length ||
      (entry[1].job === "Scout" && (!validScoutExploration(entry[1].scout,
        save.actors.find(actor => actor.uid === entry[0])!, world) || entry[1].targets.length !== 1)) ||
      (entry[1].job === "Geologist" && entry[1].scout !== undefined)
    )
      return "Invalid survey assignment";
  if (new Set(save.surveys.map(entry => entry[0])).size !== save.surveys.length) return "Duplicate survey assignments";
  if (new Set(save.fields.map((field) => field.id)).size !== save.fields.length)
    return "Duplicate field identities";
  if (save.colony && world.colonyResourceTier && save.colony.island?.resourceTier !== world.colonyResourceTier)
    return "Saved colony discovery does not match the world's resource pair";
  for (const actor of save.actors) if (actor.delivery?.upgrade) {
    const destination = save.buildings.find(building => building.uid === actor.delivery!.destination);
    if (!destination?.workshopUpgrade?.reserved) return "Upgrade delivery has no material escrow";
  }
  const returnContext = { actors: save.actors } as SettlementContext;
  for (const actor of save.actors) if (actor.delivery?.sourceInput) {
    const delivery = actor.delivery;
    const source = save.buildings.find(building => building.uid === delivery.source);
    const destination = save.buildings.find(building => building.uid === delivery.destination);
    if (source?.typeId !== 33 || !destination || !STORAGE_IDS.has(destination.typeId) ||
      !SAWMILL_RECIPES.some(recipe => recipe.input === delivery.ware)) return "Invalid sawmill input-return endpoints";
    if (delivery.reserved && reservedInputReturns(returnContext, source, delivery.ware) +
      committedWorkerInputs(returnContext, source, delivery.ware) > (source.input[delivery.ware] ?? 0))
      return "Sawmill input-return reservations exceed physical input stock";
  }
  for (const building of save.buildings) {
    const promised = building.workshopUpgrade?.incoming;
    if (!promised) continue;
    const actual: Record<string, number> = {};
    for (const actor of save.actors) if (actor.delivery?.upgrade && actor.delivery.destination === building.uid)
      actual[actor.delivery.ware] = (actual[actor.delivery.ware] ?? 0) + 1;
    for (const actor of save.actors) if (actor.nextDelivery?.upgrade && actor.nextDelivery.destination === building.uid)
      actual[actor.nextDelivery.ware] = (actual[actor.nextDelivery.ware] ?? 0) + actor.nextDelivery.units;
    for (const ware of new Set([...Object.keys(promised), ...Object.keys(actual)]))
      if ((promised[ware] ?? 0) !== (actual[ware] ?? 0)) return "Upgrade delivery reservations do not match carriers";
  }
  return validateMilitarySave(value.military, save.buildings, save.actors, economyFaction) ??
    validateTavernSave(save.tavern, save.buildings, save.actors) ?? validateTradeSave(save.trade) ??
    validateReliefCollectionSave(save.reliefCollections, save.naval.fleet.ships) ??
    tradeCustodyReason({ bridgeRemovals: save.bridgeRemovals, buildings: save.buildings,
      options: { roads: { segments: () => save.roads }, world }, storagePools: save.storagePools } as SettlementContext,
      [...save.trade?.escrow ?? [], ...save.reliefCollections?.jobs.map(job => job.escrow) ?? []]) ??
    validateColonySave(save.colony) ?? factionAiSaveError(value.factionAi, savedFactionAiFactions(context)) ??
    validateAdventureSave(save.adventure, world) ??
    validateNavalState(value, ids);
};
