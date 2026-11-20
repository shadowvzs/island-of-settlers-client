import { admitPlayerOrder, storyLockedUnits } from "../script-world/script-order-guard";
import type { createSettlementTrade } from "../trade/settlement-trade";
import { addToHome, takeFromStorages } from "./colony-economy";
import type { MilitaryTroopType } from "./military-combat-rules";
import type { QueuedMilitaryStep } from "./military-order-queue-rules";
import type { MilitaryOrder } from "./military-targeting";
import type { createSettlementMilitary } from "./settlement-military";
import type { createSettlementNaval, ShipyardMode } from "./settlement-naval";
import type { ReliefCollectionRequest } from "./settlement-relief-collections";
import type { Goods, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Military commands and views of the settlement simulation, under their public names. Player orders pass the map
 * script's lock rule first (TRG5a, design §6.6): units busy with a non-overridable story action are left out.
 */
export const simulationMilitaryCommands = (
  military: ReturnType<typeof createSettlementMilitary>, context: SettlementContext
) => ({
  /** Units among `ids` that refuse orders now ("busy with a story task"); a query, never recorded. */
  storyLockedSoldiers: (ids: readonly number[]) => storyLockedUnits(context, ids),
  militaryBuildings: military.snapshot,
  militarySoldiers: military.soldiers,
  militaryStoredTroops: military.storedTroops,
  /** Free troops per type: stored in a storage or outside, garrisons excluded. */
  militaryFreeTroops: military.orders.freeTroops,
  /** Calls the free troops of `types` to the rally banner, planting or moving it to `point`. */
  callOutMilitary: military.orders.callOut,
  militaryRally: military.orders.rally,
  cancelMilitaryRally: military.orders.cancelRally,
  /** Plants or moves the rally banner (onto an enemy building: its siege target); false off open land. */
  plantMilitaryRally: military.orders.plantRally,
  garrisonMilitary: (ids: readonly number[], uid: number) => military.garrison(admitPlayerOrder(context, ids), uid),
  recruitStoredMilitary: military.recruitStored,
  startMilitaryTrainingEncounter: military.startTrainingEncounter,
  militaryTrainingStarted: military.trainingStarted,
  setMilitaryTarget: military.setTarget,
  setMilitaryComposition: military.setComposition,
  setMilitaryCoins: military.setCoinsAllowed,
  setMilitaryTrainingFocus: military.setTrainingFocus,
  commandMilitary: (ids: readonly number[], point: SettlementPoint, mode?: MilitaryOrder) =>
    military.orders.command(admitPlayerOrder(context, ids), point, mode),
  /** The selected soldiers chase one visible enemy unit (owner 2026-11-17: a right click on its body). */
  targetMilitary: (ids: readonly number[], uid: number) =>
    military.orders.target(admitPlayerOrder(context, ids), uid),
  /**
   * Shift + right click (owner 2026-11-17): the step joins the selected group's order queue, or starts now when the
   * group has none and stands idle. A plain order takes the soldiers out of their queue.
   */
  queueMilitaryOrder: (ids: readonly number[], step: QueuedMilitaryStep) =>
    military.queues.queue(admitPlayerOrder(context, ids), step),
  /** The Shift queues for the waypoint display: members and step points (the current step first). */
  militaryOrderQueues: military.queues.snapshot,
  returnMilitaryHome: (ids: readonly number[], storageUid?: number) =>
    military.returnToStorage(admitPlayerOrder(context, ids), storageUid),
  selectMilitary: military.combat.select,
  /**
   * Retained legacy boundary: equipment is fixed at recruitment (MILITARY-EQUIPMENT-LOCK-01).
   * Stale browser/server calls return false without touching the soldier, stock or horses.
   */
  equipMilitary: (_actor: number, _type: MilitaryTroopType) => false,
  militaryAiMode: military.combat.aiMode,
  setMilitaryAiMode: military.combat.setAiMode,
  militaryAiDebug: military.combat.aiDebug,
  /** Existing opt-in fixture: no player population/stock grants, max three reachable faction1 foes. */
  startMilitaryTestSkirmish: () => military.combat.testSkirmish().flatMap((point, index) => {
    const type = (["shield", "heavy", "archer"] as const)[index]!;
    const id = military.combat.spawnOpponent(point, type);
    return id === null ? [] : [id];
  }),
  siegeMilitary: (ids: readonly number[], uid: number) => military.orders.siege(admitPlayerOrder(context, ids), uid),
  registerMilitaryGarrison: military.combat.registerGarrison,
  enableEventCourtyard: military.combat.enableEventCourtyard,
  registerMilitaryDoor: military.combat.registerDoor,
  spawnMilitaryOpponent: military.combat.spawnOpponent,
  commandMilitaryOpponent: military.combat.commandOpponent,
  siegeMilitaryOpponent: military.combat.siegeOpponent,
  destroyBuilding: military.combat.destroyBuilding,
  damageBuilding: military.combat.damageBuilding,
  militaryArrows: military.combat.arrows,
  militaryDeaths: military.combat.deaths,
  militaryDoors: military.combat.doors,
  /** Commander's Lodge recruitment, status and authority-gated development level-up. */
  commanderRecruitStatus: military.commander.recruitAvailability,
  recruitCommander: military.commander.recruit,
  deployCommander: military.commander.deployToField,
  commanderStatus: military.commander.snapshot,
  /** The island's one commander without requiring a lodge selection (destination transport UI). */
  commanderSnapshot: military.commander.snapshotAny,
  commanderControlSnapshot: military.combat.directControl.snapshot,
  commanderControlProblem: military.combat.directControl.eligibility,
  beginCommanderControl: (uid: number) => admitPlayerOrder(context, [uid]).length
    ? military.combat.directControl.begin(uid) : { ok: false as const, reason: "Busy with a story task" },
  endCommanderControl: military.combat.directControl.end,
  submitCommanderInput: military.combat.directControl.submit,
  assignCommanderEscort: (uids: readonly number[]) =>
    military.combat.directControl.assign(admitPlayerOrder(context, uids)),
  detachCommanderEscort: military.combat.directControl.detach,
  setCommanderFollow: military.combat.directControl.follow,
  commanderTransport: military.commander.transportStatus,
  levelUpCommander: (_lodgeUid: number) => military.commander.levelUpForDevelopment(),
  awardCommanderExperience: military.commander.awardExperience,
  commanderState: military.commander.state,
  commanderRecoveryProblem: military.commander.recoveryProblem,
  recoverCommanderWithItem: military.commander.recoverWithItem,
  /** Colony/adventure: sends a deployed commander to a real return ship or the landing beach. */
  returnCommander: military.commander.beginReturn
});

/** Trade office (TRADE-01): commands return true or the reason; journalled for replays. */
export const simulationTradeCommands = (trade: ReturnType<typeof createSettlementTrade>) => ({
  tradeBuy: trade.buy,
  tradePlaceOffer: trade.placeOffer,
  tradeCancelOffer: trade.cancelOffer,
  tradeSetProtectedFloor: trade.setProtectedFloor,
  /** Debug-menu "NPC traders" (journalled): NPC buyers fill own offers only while on. */
  tradeSetNpcTraders: trade.setNpcTraders,
  tradeNpcTraders: trade.npcTraders,
  trade: trade.snapshot,
  tradeDeliveryStatus: trade.deliveryStatus,
  tradeEscrowCollected: trade.escrowCollected,
  tradeStorageFull: trade.storageFull,
  tradeCheckBuy: trade.checkBuy,
  tradeCheckPlace: trade.checkPlace,
  tradeEstimate: trade.estimate,
  tradeFreeStock: trade.freeStock,
  tradeFreeCapacity: trade.freeCapacity,
});

/** Sea transport, expedition and shipyard commands of the settlement simulation. */
export const simulationNavalCommands = (naval: ReturnType<typeof createSettlementNaval>) => ({
  setShipyardMode: (uid: number, mode: ShipyardMode) => naval.setShipyardMode(uid, mode),
  shipyardMode: (uid: number) => naval.shipyardMode(uid),
  shipyardSite: (uid: number) => naval.shipyardSite(uid),
  queueSeaTransport: (source: number, destination: number, goods: Goods) =>
    naval.queueTransport(source, destination, goods),
  queueSeaPassengers: naval.queuePassengers,
  queueSeaExpedition: naval.queueExpedition,
  seaExpeditionPreparations: naval.expeditionPreparations,
  seaExpeditionDestinations: naval.expeditionDestinations,
  seaExplorationAvailability: naval.explorationAvailability,
  seaChartedSites: naval.chartedSites,
  seaChartedSiteStatuses: naval.chartedSiteStatuses,
  seaKnownSettlementSites: naval.knownSettlementSites,
  seaPotentialSettlements: naval.potentialSettlements,
  seaShippingDemands: naval.shippingDemands,
  /** Development/bench only: put `count` idle own ships beside a harbour's berth (still real ships). */
  debugEnsureFreeShips: naval.ensureFreeShips,
  spawnDebugShip: naval.spawnDebugShip,
  queueSeaExploration: naval.queueExploration,
  cancelSeaTransport: (id: number) => naval.cancelTransport(id),
  sinkShip: naval.sinkShip,
  colonyExpeditions: naval.colonyExpeditions,
  colonyIslands: naval.colonyIslands,
  expeditionOngoing: naval.expeditionOngoing,
  colonyLanding: naval.colonyLanding,
  releaseColony: naval.releaseColony,
  requestTroopPickup: naval.requestTroopPickup,
  /** MIL-SHIPS-SIM (P4a/P4b): board a selection, sail a troop ship, land its troops (recorded player commands). */
  embarkMilitary: naval.embarkMilitary,
  sailShip: naval.sailShip,
  landShipTroops: naval.landShipTroops,
  /** Read-only checks for the ship panel and target mode (the commands validate with the same functions). */
  troopShipActions: naval.troopShipActions,
  troopShipBoardingCheck: naval.troopShipBoardingCheck,
  troopShipDestinationCheck: naval.troopShipDestinationCheck,
  troopShipStatus: naval.troopShipStatus,
  sendVisitorShip: naval.sendVisitorShip,
  harbourBerths: naval.harbourBerths,
  fetchFromColony: naval.fetchFromColony,
  colonyTroops: naval.colonyTroops,
  planColonyExpedition: naval.planColonyExpedition,
  startColonyExpedition: naval.startColonyExpedition,
  cancelColonyExpedition: naval.cancelColonyExpedition,
  adventureIslands: naval.adventureIslands,
  planAdventureExpedition: naval.planAdventureExpedition,
  startAdventureExpedition: naval.startAdventureExpedition,
  /** Campaign map launch check (C5): eligible soldiers, pooled harbour stock, idle ships, slot and level. */
  campaignRequirements: naval.campaignRequirements,
  /** C8: the campaign cargo leaves the home island at once; the answer carries the soldiers that left. */
  departCampaign: naval.departCampaign,
  seaOrders: naval.pending,
  ships: () => naval.snapshot(),
  shipRoute: naval.shipRoute,
  harbourShuttles: naval.harbourShuttles,
  harbourShuttleStatus: naval.harbourShuttleStatus,
  cancelHarbourShuttle: naval.cancelHarbourShuttle,
  shuttleFrames: naval.shuttleFrames,
});

/**
 * Goods that enter or leave the island from outside its own production (quest and level rewards, deliveries,
 * ore and reward ships): journalled commands, so a command log replay reproduces them (D4.3). The server checks
 * their amounts against its ledger.
 */
export const simulationStorageCommands = (context: SettlementContext) => ({
  requestReliefCollection: (request: ReliefCollectionRequest) => context.relief!.request(request),
  reliefCollections: () => context.relief?.statuses() ?? [],
  reliefCollectionCandidates: (ware: string) => context.relief?.candidates(ware) ?? [],
  reliefCollectionsToPrune: (listedQuestIds: readonly string[]) => context.relief?.prunable(listedQuestIds) ?? [],
  pruneReliefCollections: (listedQuestIds: readonly string[]) => context.relief?.prune(listedQuestIds) ?? [],
  /** Into the home storage, whatever its capacity (rewards are never lost); false without a home storage. */
  receiveHomeGoods: (goods: Readonly<Goods>) => addToHome(context.buildings, goods),
  /** Out of the storages (as much as they hold); returns what was taken. */
  takeStoredGoods: (goods: Readonly<Goods>) => takeFromStorages(context.buildings, goods)
});
