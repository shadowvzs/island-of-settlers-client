import { describe, expect, it } from "vitest";

import { COMMAND_MANIFEST } from "../../island-of-settlers-shared/src/commands/command-manifest";
import { isDevelopmentCommand } from "../../island-of-settlers-shared/src/commands/command-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/**
 * Every public `SettlementSimulation` function is either a recorded command (shared manifest) or listed here.
 * A new method fails this test until it is classified: a player action that changes the island belongs in the
 * manifest (`island-of-settlers-shared/src/commands/README.md`), never in these lists.
 */
const SIMULATION_QUERIES = [
  "abandonedHandcarts", "adventure", "adventureCampSites", "adventureIslands", "allowsBuilding",
  "authoredObjectHandle", "authoredScenarioStatus", "script", "scriptSnapshot", "storyLockedSoldiers", "availableSettlers", "bridgeBankSafe", "bridgeConstructions", "bridgeIdAt",
  "bridgeSiteFrames", "bridgeUpgradeAvailability", "bridges", "buildingAvailability", "buildingLockLevel",
  "buildingTierBlock", "homeBuildingRules", "buildingNation", "buildings",
  "campaignOutcome", "campaignSettlers",
  "campaignRequirements", "canDeliverHome", "canEditStorageTerrain", "canSetPlayerNation", "catapultAmmo",
  "colony", "colonyExpeditions", "colonyIslands", "colonyLanding", "colonyTroops", "commanderControlProblem",
  "commanderControlSnapshot", "commanderRecoveryProblem", "commanderRecruitStatus", "commanderSnapshot",
  "commanderState", "commanderStatus", "commanderTransport", "counterChecksum", "doorQueueSnapshot",
  "doorWaitMetrics", "eventBuilderContactTick", "eventFishingTick", "eventForesterPlantTick", "eventHuntAimTick",
  "eventHuntFlightTick", "eventHuntWaitTick", "eventPopulationTick", "eventStoneTick", "eventWorkTick",
  "eventWorkerCycleRate", "expeditionOngoing", "farmArea", "felledTreeProgress", "fieldFrames", "fieldRevision",
  "fieldSites", "fisherBoatStatus", "fishingBoatFrames", "frameAccumulator", "frames", "gameNow", "gameTick",
  "garrisonShortfall", "handcarts", "harbourBerthPreview", "harbourBerths", "harbourShuttleStatus",
  "harbourShuttles", "home", "horseFrames", "isOccupied", "islandRole", "marbleDeposits", "militaryAiDebug",
  "militaryAiMode", "militaryArrows", "militaryBuildings", "militaryDeaths", "militaryDoors", "militaryFreeTroops",
  "militaryOrderQueues", "militaryRally", "militarySoldiers", "militaryStoredTroops", "militaryTrainingStarted",
  "missingTutorialResource", "movedShoreShells", "navigationDiagnostics", "navigationRevision",
  "nearestRoadVergeSite", "offersBuilding", "ownsTerritory", "pendingHomeClaims",
  "gameRules", "effectiveGameRules", "featureState", "pendingRoadDecorationReturns",
  "placementStockReason", "planAdventureExpedition", "planColonyExpedition", "planRoad", "planRoadDecoration",
  "planRoadDecorationMove",
  "playerNation", "population", "previewBridge", "productionTalentBonus", "quietSkipStatus", "randomAudit",
  "reliefCollectionCandidates", "reliefCollections", "reliefCollectionsToPrune", "resourceTotal",
  "roadDecorationCounters", "roadDecorationRevision", "roadDecorationRoadYaw", "roadDecorations", "roadRevision",
  "roadSegments", "ruins", "saveState", "saveStateWithText", "sawmillMode", "scriptWaitingHighlights",
  "seaChartedSiteStatuses", "seaChartedSites",
  "seaExpeditionDestinations", "seaExpeditionPreparations", "seaExplorationAvailability",
  "seaKnownSettlementSites", "seaOrders", "seaPotentialSettlements", "seaShippingDemands", "settlerBirths",
  "shipFrames", "shipRoute", "shipSites", "ships", "shipyardMode", "shipyardSite", "shoreShellPositions",
  "shoreShellsCollected", "shuttleFrames", "singleBuildingBuilt", "snapshot", "stoneArea", "storageCollect",
  "storageSnapshot", "surveyedDepositCount", "surveyedDeposits", "talentModifiers", "tavernOrders", "territory",
  "tickCount", "tickFraction", "trade", "tradeCheckBuy", "tradeCheckPlace", "tradeDeliveryStatus",
  "tradeEscrowCollected", "tradeEstimate", "tradeFreeCapacity", "tradeFreeStock", "tradeNpcTraders",
  "tradeStorageFull", "troopShipActions", "troopShipBoardingCheck", "troopShipDestinationCheck", "troopShipStatus",
  "unitDiagnostics", "unitDiagnosticsSnapshot", "validatePlacement", "workCounters",
  "workerPhase", "workshopUpgradeAvailability"];

/** A13 read-only accessors of the per-faction vision layer and knowledge (presentation, probes, tests). */
const VISION_QUERIES = ["factionKnowledge", "factionVision"];

/** EAI2a: the economy AI's dev overlay/probe read (plain copies, changes nothing). */
const ECONOMY_AI_QUERIES = ["factionAiDiagnostics"];

/** CIN4 cinematic reads of the saved run state (the presentation player and the frame hold). */
const CINEMATIC_QUERIES = ["activeCinematic", "cinematicHold"];

/** Engine stepping, persistence, the direct-input track, event probes and editor/development side effects. */
const UNRECORDED_SIMULATION_METHODS = [
  /** Offline catch-up mode switches of the island script (TRG3a); catch-up itself is not recorded. */
  "endScriptCatchUp", "setScriptMode",
  /** EAI5b: offline catch-up freezes the economy AI's decisions (never recorded, never saved). */
  "setFactionAiFrozen",
  /** C9a: part of a fresh campaign run's start state (before the first tick), captured by its baseline save. */
  /** SKIP: a hidden-tab or skipped catch-up moves game time to now without running ticks (like advanceClock). */
  "rebaseClock",
  "stationCampaignStartTroops",
  /** EAI1d: the AI's internal building entries, called inside the tick; a player command never reaches them. */
  "connectFactionRoads", "demolishFactionBuilding", "placeFactionBuilding",
  "advanceClock", "advanceMovementSkipTicks", "advanceQuietTicks", "awardCommanderExperience",
  "cancelHarbourShuttle", "debugEnsureFreeShips", "debugRaiseBuildingSteps", "enableDoorWaitMetrics",
  "fastForward", "loadState", "observeTicks", "onShoreShellCollected", "prewarmCoastalGeometry",
  "rebaseStorageTerrain", "reloadSnapshot", "resetCarriers", "restoreReplayAccumulator",
  "submitCommanderInput", "takeScriptUiEffects", "takeStorageFades", "update"];

const SIZE = 40;
const createSimulation = () => {
  const cells = SIZE ** 2;
  const world = {
    blocking: new Uint8Array(cells), buildClass: new Uint8Array(cells).fill(BUILD.large), cellsX: SIZE,
    cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), mineZone: new Uint16Array(cells), mineZones: [],
    oreAmount: new Uint8Array(cells),
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() },
    seaLevel: -1, seed: 9, start: { x: 5.5, z: 5.5 }, walkCost: new Uint8Array(cells).fill(10)
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 20, roads, world });
  return simulation;
};

const functionKeys = (value: object) =>
  Object.keys(value).filter(key => typeof (value as Record<string, unknown>)[key] === "function");

describe("shared command manifest on the client simulation", () => {
  it("binds every manifest command to a simulation handler", () => {
    const handlers = new Set(functionKeys(createSimulation()));
    expect(REPLAY_COMMANDS.filter(name => !handlers.has(name))).toEqual([]);
  });

  it("classifies every simulation handler: a command needs a manifest entry", () => {
    const known = new Set<string>([...REPLAY_COMMANDS, ...SIMULATION_QUERIES, ...CINEMATIC_QUERIES, ...VISION_QUERIES,
      ...ECONOMY_AI_QUERIES, ...UNRECORDED_SIMULATION_METHODS]);
    expect(functionKeys(createSimulation()).filter(name => !known.has(name))).toEqual([]);
    const commands = new Set<string>(REPLAY_COMMANDS);
    expect([...SIMULATION_QUERIES, ...UNRECORDED_SIMULATION_METHODS].filter(name => commands.has(name)))
      .toEqual([]);
  });

  it("records the manifest in its order and keeps the commander and road-decoration refusals", () => {
    expect(REPLAY_COMMANDS).toEqual(Object.keys(COMMAND_MANIFEST));
    for (const name of ["levelUpCommander", "placeRoadDecoration", "pickUpRoadDecoration", "rotateRoadDecoration",
      "moveRoadDecoration", "claimRoadDecorationReturns"]) expect(isDevelopmentCommand(name)).toBe(true);
    expect(isDevelopmentCommand("placeBuilding")).toBe(false);
    expect(isDevelopmentCommand(7)).toBe(false);
  });
});
