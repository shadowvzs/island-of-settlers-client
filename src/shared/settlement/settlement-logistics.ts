import { DMath } from "../math/deterministic-math";
import { getConstructionCost, type ConstructionMaterials } from "./construction-costs";
import { constructionStockDisplayCapacity } from "./construction-stock-layout";
import { isCatapultAmmoKind, isCatapultAmmoStock } from "./catapult-ammo-kinds";
import { catapultOutgoingStone } from "./military-catapult-ammo";
import { depositCatapultGroundStone } from "./military-catapult-resupply";
import { addGood, getBuildingProductionRule, STORAGE_IDS } from "./production-rules";
import { countGoods } from "./production-rules";
import { hasRoadRoute } from "./road-route-helpers";
import type { RoadRouteMetrics } from "./road-types";
import { reservedInputReturns, unusedSawmillInputs } from "./sawmill-input-returns";
import {
  carrierClaimProgress, deliveryLeaseExpired, refreshCarrierClaimOnProgress, releaseDeliveryClaim,
  startClaimLease
} from "./settlement-carrier-claims";
import {
  canRetryCarrierDetour,
  carrierDetourCandidates,
  carrierJourneyStalled,
  isCarrierLegClear
} from "./settlement-carrier-detours";
import { selectCarrierFleet } from "./settlement-carrier-fleet";
import { returnCarrierHome } from "./settlement-carrier-home";
import { resumeRemoteStockDelivery } from "./settlement-carrier-remote-stock";
import { carrierPickupLeavesRoads, carrierRoadRecoveryPath } from "./settlement-carrier-road-recovery";
import {
  type CartCoverageCache, cartWalkerHold, cartWorthyUnits, clearCartCoverage, createCartCoverageCache,
  fetchCrewlessCart
} from "./settlement-cart-priority";
import {
  type ConsumerDemand, clearDemandWait, noteDemandWait, rankConsumerDemands, restartDemandWait
} from "./settlement-demand-ranking";
import { isDoorExitQueueFull } from "./settlement-door-exit-queue";
import {
  canReserveStorageDelivery, isHoldingStorageTurn, isManagedStorageArrival, leaveStorageArrival
} from "./settlement-door-traffic";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { fisheryNeedsBoat, isFisherBoatSource } from "./settlement-fisher-boat-mode";
import { footRouteFrom } from "./settlement-handcart-roads";
import { dispatchHandcart } from "./settlement-handcarts";
import { recoverUndepartedCarrier } from "./settlement-indoor-carrier-recovery";
import { createLandReuseScheduler, type LandReuseJob } from "./settlement-land-reuse-scheduler";
import {
  availableTransportGood, claimNextDelivery, nextTransferReservations, reconcileNextDelivery, releaseNextDelivery
} from "./settlement-land-transport-claims";
import { createWalkingCarrierPool, type WalkingCarrierPickup } from "./settlement-land-transport-selection";
import { buildingNation } from "./settlement-nation";
import { findGroundPath, isGroundSegmentClear } from "./settlement-navigation";
import { cancelUnreachableTask } from "./settlement-navigation-cancellation";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import {
  economyOwnerOf, economyOwners, PLAYER_FACTION, servesBuildingEconomy, servesEconomyOf
} from "./settlement-ownership";
import {
  createActor,
  groundPath,
  isOwnStockCourtyard,
  moveActor,
  setActorPath
} from "./settlement-paths";
import { forEachNearbyTrafficActor } from "./settlement-person-index";
import { availableIdleSettlers, ownerSpareSettlers } from "./settlement-population";
import { requestNavigationRepair } from "./settlement-repair-budget";
import { productionInputStock } from "./settlement-sawmill-handcarts";
import {
  advanceWareTransfer,
  clearWareTransfer,
  startWareTransfer,
  stockContact} from "./settlement-stock-transfers";
import { actorSeparation } from "./settlement-traffic";
import { createTransientMap } from "./settlement-transient-state";
import {
  createTransportReservationIndex, type TransportReservationIndex
} from "./settlement-transport-reservation-index";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint,
  SettlementRoads
} from "./settlement-types";
import { faceWaitingDestination } from "./settlement-waiting-heading";
import { noteSettlerDemand } from "./settler-relocation";
import { isSharedStorageWare, storagePoolFor } from "./shared-storage";
import { reserveStorageDispatch, storageDispatchLimit, withStorageCapacityPhase } from "./storage-capacity";
import { markTickPhase } from "./tick-phase-profile";
import { chooseTransportForJob, type TransportReuseCandidate } from "./transport-reuse-policy";
import { workshopUpgradeDemand } from "./workshop-upgrades";

interface LandDispatchOptions {
  actor?: SettlementActor;
  allowClaim?: boolean;
  allowReturning?: boolean;
  /** Cart coverage per trip; collect passes never write, a delivery pass clears it after a fetch. */
  cartCoverage?: CartCoverageCache;
  collect?: (job: LandReuseJob) => void;
  /** Ranked consumer demand: the shared rank (need + waiting bonus) the reuse pass compares. */
  demandRank?: number;
  fallback?: boolean;
  onClaim?: () => void;
  /** The economy this pass serves (one pass per economy, EAI1a D16); absent: the player's. */
  owner?: number;
  pickup?: WalkingCarrierPickup;
  /** Read-only collect passes only: the scan's reservations, valid while nothing writes. */
  reservations?: TransportReservationIndex;
  /** Demand-specific source rule (a Fishery's boat never comes from a harbour). */
  sourceAllowed?: (source: SettlementBuilding) => boolean;
  sourceUid?: number;
  transferId?: number;
}

/** Whether a demand of `building` belongs to the economy this pass serves. */
const inPass = (context: SettlementContext, options: LandDispatchOptions, building: SettlementBuilding) =>
  economyOwnerOf(context, building) === (options.owner ?? PLAYER_FACTION);

/** Minimal road mocks in tests predate `routeMetrics`; real networks never take the fallback. */
const routeMetrics = (
  roads: SettlementRoads, from: SettlementPoint, to: SettlementPoint
): RoadRouteMetrics => {
  if (roads.routeMetrics) return roads.routeMetrics(from, to);
  const route = roads.route(from, to);
  return { status: route ? "found" : "no-path", route };
};

const reachableStorages = (
  context: SettlementContext, building: SettlementBuilding, ware?: string, acceptingWare?: string
) =>
  context.buildings
    .filter(
      (candidate) =>
        candidate.construction === 1 &&
        STORAGE_IDS.has(candidate.typeId) &&
        servesBuildingEconomy(context, candidate, building) &&
        (!ware || (candidate.inventory[ware] ?? 0) > 0) &&
        (!acceptingWare || candidate.accepts[acceptingWare] !== false)
    )
    .map((candidate) => ({
      building: candidate,
      metrics: routeMetrics(context.options.roads, candidate.access, building.access)
    }))
    .filter((entry) => entry.metrics.route)
    .sort((a, b) => a.metrics.route!.length - b.metrics.route!.length ||
      a.metrics.route!.cost - b.metrics.route!.cost || a.building.uid - b.building.uid);

/**
 * The nearest road-connected storage; with `requireSettler`, the nearest one holding an idle settler
 * (POP-03: nobody walks across the island when someone closer is free). When the nearest storage
 * has nobody idle, it is noted as needing people for the next newborn.
 */
export const nearestStorage = (
  context: SettlementContext,
  building: SettlementBuilding,
  ware?: string,
  acceptingWare?: string,
  requireSettler = false
) => {
  const storages = reachableStorages(context, building, ware, acceptingWare);
  if (!requireSettler) return storages[0];
  const staffed = storages.find(entry => availableIdleSettlers(context, entry.building) > 0);
  if (storages[0] && storages[0] !== staffed) noteSettlerDemand(context, storages[0].building);
  return staffed;
};

/**
 * The nearest storage accepting `ware` whose door queue can take another delivery: a saturated door
 * (every waiting place committed) hands the ware to the next nearest storage instead of holding it
 * at the workshop. Unsaturated, this is `nearestStorage` (the nearest is tested once more).
 */
const nearestOpenStorage = (context: SettlementContext, building: SettlementBuilding, ware: string) => {
  const storages = reachableStorages(context, building, undefined, ware);
  const nearest = storages[0];
  if (!nearest || canReserveStorageDelivery(context, nearest.building)) return nearest;
  return storages.find(entry => canReserveStorageDelivery(context, entry.building)) ?? nearest;
};

const goodsOf = (building: SettlementBuilding) =>
  STORAGE_IDS.has(building.typeId) ? building.inventory : building.output;
const availableGood = availableTransportGood;
/** Limit complete yard courier trips, including their walk home, to avoid sealing storage exits. */
const hasYardCourierCapacity = (context: SettlementContext, destination: SettlementBuilding) => {
  if (STORAGE_IDS.has(destination.typeId)) return true;
  let active = 0;
  for (const actor of context.actors) {
    if (actor.job !== "Carrier" || actor.building !== destination.uid ||
      actor.phase === "inside" || actor.phase === "retired") continue;
    if (++active >= 16) return false;
  }
  return true;
};
/** Serving carts keep walkers off a cart-worthy job; a crewless cart is fetched first when worthwhile. */
const holdsWalkers = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  ware: string,
  need: number,
  leg: number,
  cache?: CartCoverageCache
) => {
  const hold = cartWalkerHold(context, source, destination, ware, need, cache);
  if (!hold.fetchDepot) return hold.blocked;
  if (!fetchCrewlessCart(context, hold.fetchDepot, source, leg)) return false;
  // The fetcher is now a crew on the way: every cached coverage is stale.
  if (cache) clearCartCoverage(cache);
  return true;
};
/** Returns the number of items dispatched: a cart load on stone routes, otherwise one item. */
const sendWare = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  ware: string,
  limit = 1,
  upgrade = false,
  options: LandDispatchOptions = {}
) => {
  if (options.sourceUid !== undefined && source.uid !== options.sourceUid) return 0;
  const pool = context.storagePools && storagePoolFor(context, source);
  if (pool && isSharedStorageWare(ware) && pool.id === storagePoolFor(context, destination)?.id) return 0;
  if (!hasYardCourierCapacity(context, destination)) return 0;
  if (!canReserveStorageDelivery(context, destination)) return 0;
  const available = options.reservations?.available(source, ware) ?? availableGood(context, source, ware);
  if (available < 1 || source.uid === destination.uid || destination.accepts[ware] === false) return 0;
  // A collect pass only needs the route to exist; a real dispatch walks its points.
  const { roads } = context.options;
  const deliveryRoute = options.collect ? undefined : roads.route(source.access, destination.access);
  if (options.collect ? !hasRoadRoute(roads, source.access, destination.access) : !deliveryRoute) return 0;
  if (!upgrade && storageDispatchLimit(context, source, destination, ware, 1) < 1) return 0;
  const need = Math.min(limit, available);
  if (options.collect) {
    const cartOnly = !upgrade &&
      cartWalkerHold(context, source, destination, ware, need, options.cartCoverage).blocked;
    options.collect({ source, destination, ware, limit, upgrade, transferId: options.transferId,
      allowClaim: options.allowClaim !== false, fallback: options.fallback ?? !Number.isFinite(limit),
      remainingNeed: options.demandRank ?? (Number.isFinite(limit) ? limit : available),
      ...(cartOnly ? { cartOnly } : {}), ...(options.demandRank === undefined ? {} : { demandRanked: true }) });
    return 0;
  }
  // One plan-time decision owns cart/cartless selection; the manifest and the dispatched actor both
  // consume this result, so a route can never be recorded as carted while a cartless actor departs.
  const assignment = upgrade || (options.actor && !options.actor.handcart)
    ? { capacity: 1, fleet: "cartless" as const, units: 1 }
    : selectCarrierFleet(context, source, destination, ware, need,
      options.allowClaim !== false, options.actor, options.allowReturning !== false);
  type Choice = { assignment: typeof assignment } | { pickup: WalkingCarrierPickup };
  const carted: TransportReuseCandidate<Choice>[] = assignment.fleet === "handcart" && assignment.selection
    ? [{ ...assignment.selection, value: { assignment } }] : [];
  // Owner cart priority: a selectable cart always takes a cart-worthy job instead of a walker.
  const cartFirst = options.actor !== undefined ||
    (assignment.fleet === "handcart" && assignment.units >= cartWorthyUnits(assignment.capacity));
  const choice: Choice | undefined = cartFirst ? chooseTransportForJob(carted) :
    createWalkingCarrierPool(context, source, options.allowClaim !== false, options.allowReturning !== false)
      .choose<Choice>(pickup => ({ pickup }), carted);
  if (assignment.fleet === "handcart" && (!choice || "assignment" in choice)) {
    if (assignment.selection?.availability === "unloading" && assignment.carrier) {
      const claimed = claimNextDelivery(context, assignment.carrier, { source: source.uid,
        destination: destination.uid, ware, units: assignment.units, mode: "handcart",
        capacity: assignment.capacity, ...(options.transferId === undefined ? {} : { transferId: options.transferId }) });
      if (claimed) { options.onClaim?.(); return assignment.units; }
    }
    const carted = dispatchHandcart(context, source, destination, ware, assignment);
    // The assignment is committed in this call; a pre-commit refusal (no crew) falls back once.
    if (carted) return carted;
  }
  if (options.actor?.handcart) return 0;
  // Reused walkers never see a cart-only job (the collect pass marks it); new walkers check here.
  if (!options.actor && !upgrade &&
    holdsWalkers(context, source, destination, ware, need, deliveryRoute!.length, options.cartCoverage)) return 0;
  return sendSingleWare(context, source, destination, ware, deliveryRoute!.points, upgrade, false,
    { ...options, pickup: choice && "pickup" in choice ? choice.pickup : options.pickup }) ? 1 : 0;
};
const sendSingleWare = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  ware: string,
  deliveryPoints: SettlementPoint[],
  upgrade = false,
  sourceInput = false,
  options: LandDispatchOptions = {}
) => {
  // Upgrade materials and input returns have a fixed destination outside storage capacity.
  const committed = upgrade || sourceInput;
  // Storage sources share the door-exit cap, including reused carriers already outside the door.
  if (STORAGE_IDS.has(source.typeId) && isDoorExitQueueFull(context, source)) return false;
  if (!committed && storageDispatchLimit(context, source, destination, ware, 1) < 1) return false;
  // Civilian horse dispatch is retired (HORSE-RETIREMENT-01): every new delivery uses a
  // carrier or hand cart. Existing horse actors may only finish their earlier reservation.
  if (options.sourceUid !== undefined && options.sourceUid !== source.uid) return false;
  if (options.collect) {
    options.collect({ source, destination, ware, limit: 1, upgrade, sourceInput,
      allowClaim: options.allowClaim !== false, fallback: sourceInput,
      remainingNeed: availableTransportGood(context, source, ware, sourceInput), transferId: options.transferId });
    return false;
  }
  let pickup = options.pickup;
  if (!pickup && options.actor) {
    if (options.actor.handcart) return false;
    // A carrier reused at a boundary must already stand at the job's source. Never fabricate an
    // indoor exit from a storage elsewhere: that route starts behind the carrier and cannot be walked.
    if (STORAGE_IDS.has(source.typeId) && source.construction === 1 &&
      Math.abs(options.actor.x - source.x) <= source.width / 2 + 1 &&
      Math.abs(options.actor.z - source.z) <= source.depth / 2 + 1)
      pickup = { actor: options.actor, points: [], unloading: false, indoor: source };
    else {
      const points = footRouteFrom(context, options.actor, source.access, false);
      if (!points) return false;
      pickup = { actor: options.actor, points, unloading: false };
    }
  }
  pickup ??= createWalkingCarrierPool(context, source, options.allowClaim !== false,
    options.allowReturning !== false).choose(candidate => candidate);
  if (pickup?.unloading) {
    const claimed = claimNextDelivery(context, pickup.actor, { source: source.uid,
      destination: destination.uid, ware, units: 1, mode: "carrier", capacity: 1,
      ...(upgrade ? { upgrade: true } : {}), ...(sourceInput ? { sourceInput: true } : {}),
      ...(options.transferId === undefined ? {} : { transferId: options.transferId }) });
    if (claimed) options.onClaim?.();
    return claimed;
  }
  let actor = pickup?.actor;
  if (!actor) {
    if (ownerSpareSettlers(context, economyOwnerOf(context, source), "carrier") < 1) return false;
    const home =
      nearestStorage(context, source, undefined, undefined, true)?.building ??
      (STORAGE_IDS.has(source.typeId) && availableIdleSettlers(context, source) > 0 ? source : undefined);
    if (!home || isDoorExitQueueFull(context, home)) return false;
    actor = createActor(context, "Carrier", home.uid);
    const route = context.options.roads.route(home.access, source.access);
    if (!route) return false;
    pickup = { actor, indoor: home, points: route.points, unloading: false };
  }
  if (pickup?.indoor && isDoorExitQueueFull(context, pickup.indoor)) return false;
  const reserved = !STORAGE_IDS.has(source.typeId);
  if (!reserved) addGood(goodsOf(source), ware, -1);
  addGood(destination.incoming, ware, 1);
  actor.wareUnits = undefined;
  if (!upgrade) reserveStorageDispatch(context, source, destination, ware, 1);
  actor.delivery = { source: source.uid, destination: destination.uid, ware, reserved, ...(upgrade ? { upgrade: true } : {}),
    ...(sourceInput ? { sourceInput: true } : {}), ...startClaimLease(context) };
  if (upgrade && destination.workshopUpgrade?.reserved)
    addGood(destination.workshopUpgrade.incoming ??= {}, ware);
  actor.building = destination.uid;
  leaveStorageArrival(context, actor);
  actor.stockContact = undefined; actor.stockBuilding = undefined;
  if (pickup?.indoor?.uid === source.uid) {
    // Stock is loaded inside storage, before the first visible step through its doorway.
    actor.ware = ware;
    setActorPath(actor, [...exitPath(source), ...deliveryPoints], "exitLoaded");
  } else if (pickup?.indoor) setActorPath(actor, [...exitPath(pickup.indoor), ...pickup.points], "pickup");
  else setActorPath(actor, pickup?.points ?? [], "pickup");
  return true;
};
const deliverDemand = (
  context: SettlementContext,
  destination: SettlementBuilding,
  ware: string,
  missing: number,
  upgrade = false,
  options: LandDispatchOptions = {}
) => {
  // The whole filter runs before any dispatch below, so one reservation pass answers it exactly.
  let reservations = options.reservations;
  const owner = economyOwnerOf(context, destination);
  const sources = context.buildings
    .filter(
      (source) =>
        source.construction === 1 &&
        servesEconomyOf(context, source, owner) &&
        (options.sourceUid === undefined || source.uid === options.sourceUid) &&
        options.sourceAllowed?.(source) !== false &&
        (reservations ??= createTransportReservationIndex(context)).available(source, ware) > 0 &&
        source.uid !== destination.uid &&
        !(source.typeId === 17 && nearestStorage(context, source, undefined, ware))
    )
    .map((source) => ({
      source,
      route: routeMetrics(context.options.roads, source.access, destination.access).route
    }))
    .filter((entry) => entry.route)
    .sort((a, b) => a.route!.cost - b.route!.cost || a.source.uid - b.source.uid);
  for (const { source } of sources)
    if (sendWare(context, source, destination, ware, missing, upgrade, options)) return true;
  return false;
};
/** Builds one consumer category; a real pass also records each seen need's waiting time. */
const createDemandList = (context: SettlementContext, options: LandDispatchOptions) => {
  const demands: ConsumerDemand[] = [];
  const observe = (building: SettlementBuilding, ware: string, missing: number) => {
    if (!options.collect) noteDemandWait(context, building, ware, missing);
    if (missing > 0) demands.push({ building, missing, ware });
  };
  return { demands, observe };
};
const tavernDemands = (context: SettlementContext, options: LandDispatchOptions) => {
  const { demands, observe } = createDemandList(context, options);
  for (const building of context.buildings) {
    if (!inPass(context, options, building)) continue;
    for (const [ware, missing] of Object.entries(context.tavern?.demand(building.uid) ?? {}))
      observe(building, ware, missing);
  }
  return demands;
};
const productionInputMissing = (context: SettlementContext, building: SettlementBuilding, ware: string) =>
  productionInputStock(building, ware) - (building.input[ware] ?? 0) +
  reservedInputReturns(context, building, ware) - (building.incoming[ware] ?? 0);
const productionInputDemands = (context: SettlementContext, options: LandDispatchOptions) => {
  const { demands, observe } = createDemandList(context, options);
  for (const building of context.buildings) {
    if (building.construction !== 1 || !inPass(context, options, building)) continue;
    const rule = getBuildingProductionRule(building, buildingNation(context, building));
    if (!rule || rule.service) continue;
    // A paused building asks for nothing (player setting first); an alternative food already coming covers it.
    const covered = building.productionPaused || (rule.alternativeFood &&
      rule.inputs.some((ware) => (building.input[ware] ?? 0) + (building.incoming[ware] ?? 0) > 0));
    for (const ware of rule.inputs) {
      if (!covered) observe(building, ware, productionInputMissing(context, building, ware));
      else if (!options.collect) clearDemandWait(building, ware);
    }
  }
  return demands;
};
/** FISHER-BOAT: one reserved boat per boat-mode Fishery, from a headquarters or storehouse only. */
const deliverFisheryBoats = (context: SettlementContext, options: LandDispatchOptions) => {
  for (const building of context.buildings)
    if (fisheryNeedsBoat(building) && inPass(context, options, building) &&
      deliverDemand(context, building, "boat", 1, false, { ...options, sourceAllowed: isFisherBoatSource }))
      return true;
  return false;
};
const militarySupplyDemands = (context: SettlementContext, options: LandDispatchOptions) => {
  const { demands, observe } = createDemandList(context, options);
  for (const building of context.buildings) {
    const demand = context.military?.supplyDemand(building.uid);
    if (!demand || !inPass(context, options, building)) continue;
    observe(building, demand.stoneWare ?? "stone", demand.stone ?? 0);
    observe(building, "coins", demand.coins);
    observe(building, demand.drinkWare, demand.drink);
  }
  return demands;
};
/** Serves the best-ranked consumer that can be supplied now; its wait restarts. */
const serveConsumerDemands = (
  context: SettlementContext, demands: readonly ConsumerDemand[], options: LandDispatchOptions
) => {
  for (const { building, missing, rank, ware } of rankConsumerDemands(context, demands)) {
    if (!deliverDemand(context, building, ware, missing, false, { ...options, demandRank: rank })) continue;
    if (!options.collect) restartDemandWait(context, building, ware);
    return true;
  }
  return false;
};
const NO_SAWMILL_INPUTS: ReturnType<typeof unusedSawmillInputs> = [];
/** A sawmill's unused inputs, only in the pass of its own economy. */
const passSawmillInputs = (context: SettlementContext, options: LandDispatchOptions, source: SettlementBuilding) =>
  inPass(context, options, source) ? unusedSawmillInputs(context, source) : NO_SAWMILL_INPUTS;
const outputCursor = createTransientMap<number>();
const reuseSchedulers = new WeakMap<SettlementContext, ReturnType<typeof createLandReuseScheduler>>();

/** The output-dispatch rotation affects which equivalent job is chosen, so it travels with the save. */
export const saveLandDispatchCursor = (context: SettlementContext) => outputCursor.get(context) ?? 0;
export const restoreLandDispatchCursor = (context: SettlementContext, saved?: number) => {
  if (saved !== undefined) outputCursor.set(context, saved);
  else outputCursor.delete(context);
};

/** Installed before restore/ticking, so a saved unload has the same immediate handover as a live one. */
export const initializeLandTransportReuse = (context: SettlementContext) => {
  const collect = (sourceUid?: number) => {
    const jobs: LandReuseJob[] = [];
    for (const owner of economyOwners(context))
      withStorageCapacityPhase(context, () => scheduleDeliveryPhase(context, {
        cartCoverage: createCartCoverageCache(), collect: job => jobs.push(job), owner,
        reservations: createTransportReservationIndex(context), sourceUid }));
    return jobs;
  };
  const dispatch = (job: LandReuseJob, actor: SettlementActor, pickup?: WalkingCarrierPickup) =>
    withStorageCapacityPhase(context, () => {
    const options = { actor, allowClaim: false, sourceUid: job.source.uid, pickup };
    if (job.sourceInput) {
      const route = context.options.roads.route(job.source.access, job.destination.access);
      return route && sendSingleWare(context, job.source, job.destination, job.ware, route.points,
        false, true, options) ? 1 : 0;
    }
    return sendWare(context, job.source, job.destination, job.ware, job.limit, Boolean(job.upgrade), options);
    });
  const service = createLandReuseScheduler(context, collect, dispatch);
  reuseSchedulers.set(context, service);
  context.tryReuseTransport = (actor, source) => service.atBoundary(actor, source);
};

export const scheduleDeliveries = (context: SettlementContext) => {
  markTickPhase("schedule.reuse");
  reuseSchedulers.get(context)?.schedule();
  markTickPhase("schedule.delivery");
  // One dispatch per economy and pass: the player's pass sees exactly its own candidates first.
  let dispatched = false;
  for (const owner of economyOwners(context))
    dispatched = withStorageCapacityPhase(context, () =>
      scheduleDeliveryPhase(context, { allowClaim: false, allowReturning: false,
        cartCoverage: createCartCoverageCache(), owner })) || dispatched;
  return dispatched;
};
const scheduleDeliveryPhase = (context: SettlementContext, options: LandDispatchOptions = {}) => {
  for (const transfer of context.transfers) {
    const remaining = transfer.count - (transfer.id === undefined ? 0 : nextTransferReservations(context.actors, transfer.id));
    if (remaining <= 0) continue;
    const source = context.buildings.find((building) => building.uid === transfer.source);
    const destination = context.buildings.find((building) => building.uid === transfer.destination);
    if (destination && !inPass(context, options, destination)) continue;
    let claimed = false;
    const sent = source && destination ? sendWare(context, source, destination, transfer.ware, remaining, false,
      { ...options, allowClaim: options.allowClaim !== false && transfer.id !== undefined,
        transferId: transfer.id, onClaim: () => { claimed = true; } }) : 0;
    if (sent) {
      if (!claimed) transfer.count -= sent;
      // Finished orders leave the list: saves only accept outstanding transfers.
      if (transfer.count <= 0) context.transfers = context.transfers.filter(order => order !== transfer);
      return true;
    }
  }
  for (const building of context.buildings) {
    if (building.construction === 1 || (building.foundationProgress ?? 1) < 1 ||
      !inPass(context, options, building)) continue;
    for (const [ware, amount] of Object.entries(building.required)) {
      const missing = amount - (building.input[ware] ?? 0) - (building.incoming[ware] ?? 0) -
        (building.constructionConsumed?.[ware] ?? 0);
      if (missing > 0 && deliverDemand(context, building, ware, missing, false, options)) return true;
    }
  }
  for (const building of context.buildings) {
    if (!inPass(context, options, building)) continue;
    for (const [ware, missing] of Object.entries(workshopUpgradeDemand(building)))
      if (missing > 0 && deliverDemand(context, building, ware, missing, !!building.workshopUpgrade?.reserved, options))
        return true;
  }
  // Expeditions and shipyards are the player's (v1 is land only).
  if (options.owner === undefined || options.owner === PLAYER_FACTION) {
    for (const building of context.buildings)
      for (const [ware, missing] of Object.entries(context.naval?.expeditionDemand(building.uid) ?? {}))
        if (missing > 0 && deliverDemand(context, building, ware, missing, false, options)) return true;
    for (const building of context.buildings)
      for (const [ware, missing] of Object.entries(context.naval?.shipyardDemand?.(building.uid) ?? {}))
        if (missing > 0 && deliverDemand(context, building, ware, missing, false, options)) return true;
  }
  if (serveConsumerDemands(context, tavernDemands(context, options), options)) return true;
  if (serveConsumerDemands(context, productionInputDemands(context, options), options)) return true;
  if (deliverFisheryBoats(context, options)) return true;
  if (serveConsumerDemands(context, militarySupplyDemands(context, options), options)) return true;
  for (const source of context.buildings) for (const [ware] of passSawmillInputs(context, options, source)) {
    const destinations = options.collect ? reachableStorages(context, source, undefined, ware)
      : [nearestOpenStorage(context, source, ware)].filter(entry => entry !== undefined);
    for (const destination of destinations) {
      if (!canReserveStorageDelivery(context, destination.building)) continue;
      const route = context.options.roads.route(source.access, destination.building.access);
      if (route && sendSingleWare(context, source, destination.building, ware, route.points,
        false, true, options)) return true;
    }
  }
  // A computer economy's rotation starts at 0 each pass (stateless, nothing saved; EAI1a D17).
  const playerPass = options.owner === undefined || options.owner === PLAYER_FACTION;
  const start = playerPass ? outputCursor.get(context) ?? 0 : 0;
  for (let offset = 0; offset < context.buildings.length; offset++) {
    const index = (start + offset) % context.buildings.length;
    const source = context.buildings[index]!;
    if (STORAGE_IDS.has(source.typeId) || !inPass(context, options, source)) continue;
    for (const [ware, count] of Object.entries(source.output)) {
      if (!count) continue;
      const destinations = options.collect ? reachableStorages(context, source, undefined, ware)
        : [nearestOpenStorage(context, source, ware)].filter(entry => entry !== undefined);
      for (const entry of destinations) if (sendWare(context, source, entry.building, ware, Infinity, false, options)) {
        if (playerPass) outputCursor.set(context, (index + 1) % context.buildings.length);
        return true;
      }
    }
  }
  return scheduleStorageExports(context, options);
};
/** Give concurrent site deliveries distinct piles instead of stacking all carriers on pile zero. */
const freeConstructionInputSlot = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding,
  ware: string,
  start: number
) => {
  const cost = (Object.keys(building.required ?? {}).length
    ? building.required
    : getConstructionCost(building.typeId)) as ConstructionMaterials;
  const capacity = constructionStockDisplayCapacity(cost, ware);
  if (!capacity) return start;
  const used = new Set<number>();
  for (const other of context.actors) {
    if (other === actor || other.stockBuilding !== building.uid) continue;
    const contact = other.stockContact;
    if (contact?.ware === ware) used.add(contact.slot);
  }
  for (let offset = 0; offset < capacity; offset += 1) {
    const slot = (start + offset) % capacity;
    if (!used.has(slot)) return slot;
  }
  return start % capacity;
};

const beginStockWalk = (
  context: SettlementContext,
  actor: SettlementActor,
  kind: "input" | "output"
) => {
  const delivery = actor.delivery!;
  const building = context.buildings.find(
    (entry) => entry.uid === (kind === "output" ? delivery.source : delivery.destination)
  )!;
  if (kind === "input" && resumeRemoteStockDelivery(context, actor, building)) return;
  let inputStock = building.input[delivery.ware] ?? 0;
  if (isCatapultAmmoStock(building, delivery.ware))
    inputStock = building.catapultSupply?.ground ?? 0;
  const slot = kind === "output" ? Math.max(0, countGoods(building.output) - 1) : inputStock;
  const inputSlot = kind === "input" && building.construction < 1
    ? freeConstructionInputSlot(context, actor, building, delivery.ware, slot)
    : slot;
  const inputPickup = kind === "output" && delivery.sourceInput;
  const stockKind = inputPickup ? "input" : kind;
  const stockSlot = inputPickup ? Math.max(0, (building.input[delivery.ware] ?? 0) - 1) : inputSlot;
  actor.stockBuilding = building.uid;
  actor.stockContact = stockContact(context, building, stockKind, delivery.ware, stockSlot);
  const unfinishedSite = kind === "input" && building.construction < 1;
  // An unfinished site's input piles sit inside its foundation. The courtyard-only path rejects the
  // foundation and the outside approach; the site's own construction access already permits workers
  // through the plot, so use the plain land search for this final pile leg.
  const path =
    DMath.hypot(actor.x - actor.stockContact.approach.x, actor.z - actor.stockContact.approach.z) <
    0.15
      ? []
      : unfinishedSite
        ? findGroundPath(context, actor, actor.stockContact.approach, undefined, () => true)
        : groundPath(context, actor, actor.stockContact.approach, building.uid);
  if (path) setActorPath(actor, path, kind === "output" ? "pickupStockWalk" : "deliveryStockWalk");
  else {
    actor.phase = kind === "output" ? "carrierPickupBlocked" : "carrierDeliveryBlocked";
    actor.action = "idle";
    actor.timer = 1;
  }
};
const leaveStockLoaded = (context: SettlementContext, actor: SettlementActor) => {
  const source = context.buildings.find((entry) => entry.uid === actor.delivery!.source)!;
  const destination = context.buildings.find((entry) => entry.uid === actor.delivery!.destination)!;
  const route = context.options.roads.route(source.access, destination.access);
  const path = route && groundPath(context, actor, source.access, source.uid);
  if (route && path) setActorPath(actor, [...path, ...route.points], "deliver");
  else {
    if (actor.phase === "pickupTransfer") {
      const dx = actor.x - source.x,
        dz = actor.z - source.z;
      const normal =
        Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) || 1 };
      for (const side of [1, -1, 0]) {
        const point = {
          x: actor.x + normal.x * 0.9 - normal.z * side * 0.6,
          z: actor.z + normal.z * 0.9 + normal.x * side * 0.6
        };
        if (
          context.actors.some(
            (other) =>
              other !== actor &&
              other.visible &&
              DMath.hypot(other.x - point.x, other.z - point.z) < 0.3
          )
        )
          continue;
        const parking = groundPath(context, actor, point, source.uid);
        if (parking) {
          setActorPath(actor, parking, "carrierLoadedParking");
          return;
        }
      }
    }
    actor.phase = "carrierLoadedBlocked";
    actor.action = "idle";
    actor.timer = 1;
  }
};
const finishDelivery = (context: SettlementContext, actor: SettlementActor) => {
  const destination = context.buildings.find((entry) => entry.uid === actor.delivery!.destination)!;
  const ware = actor.delivery!.ware, units = actor.wareUnits ?? 1;
  const storage = destination.construction === 1 && STORAGE_IDS.has(destination.typeId);
  if (isCatapultAmmoStock(destination, ware) && !actor.delivery!.upgrade) {
    const accepted = depositCatapultGroundStone(destination, units, ware);
    addGood(destination.incoming, ware, -accepted);
    if (accepted < units) {
      actor.wareUnits = units - accepted; actor.phase = "carrierDeliveryBlocked"; actor.timer = 1;
      clearWareTransfer(actor); return;
    }
  } else {
    addGood(destination.incoming, ware, -units);
    if (actor.delivery!.upgrade) {
      const upgrade = destination.workshopUpgrade;
      if (upgrade?.incoming) addGood(upgrade.incoming, ware, -1);
      addGood(upgrade?.reserved ?? (storage ? destination.inventory : destination.output), ware);
    } else addGood(storage ? destination.inventory : destination.input, ware, units);
  }
  actor.ware = null;
  actor.wareScale = undefined;
  actor.wareUnits = undefined;
  actor.delivery = undefined;
  clearWareTransfer(actor);
  destination.door = 1;
  if (context.tryReuseTransport?.(actor, destination)) return;
  if (storage) {
    actor.home = destination.uid;
    actor.phase = "inside";
    actor.visible = false;
    actor.action = "idle";
    return;
  }
  if (destination.typeId >= 10 && destination.typeId <= 13 && destination.hasDoor) {
    setActorPath(actor, exitPath(destination), "exitDelivery");
    return;
  }
  if (!returnCarrierHome(context, actor, destination)) {
    actor.phase = "returnBlockedCarrier";
    actor.visible = true;
    actor.action = "idle";
    actor.timer = 1;
  }
};
const busyAtSite = (other: SettlementActor) => ["construct", "work", "deposit"].includes(other.phase);
/** A person, or a crew working on the spot, occupies this route point for the carrier. */
const carrierPointBlocked = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  forEachNearbyTrafficActor(context, point, .48, (other) =>
    other !== actor &&
    other.visible &&
    DMath.hypot(other.x - point.x, other.z - point.z) <
      (busyAtSite(other) ? 0.45 : actorSeparation(actor, other) + 0.02)
  );
const siteCrewOnPoint = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  forEachNearbyTrafficActor(context, point, .45, (other) =>
    other !== actor &&
    other.visible &&
    busyAtSite(other) &&
    DMath.hypot(other.x - point.x, other.z - point.z) < 0.45
  );
const carrierNeedsDetour = (
  context: SettlementContext,
  actor: SettlementActor,
  next: SettlementPoint | undefined,
  stalled: boolean
) => {
  if (!next) return false;
  if (stalled) return true;
  const clear = isCarrierLegClear(context, actor, (origin) =>
    isGroundSegmentClear(context, origin, next, undefined, (point) =>
      isOwnStockCourtyard(context, actor, point)
    )
  );
  if (!clear) return true;
  return carrierPointBlocked(context, actor, next) &&
    (actor.timer > 0.75 || siteCrewOnPoint(context, actor, next));
};
/** Splice a bounded people-aware detour around a crowd or a newly blocked straight leg. */
const detourCrowdedCarrier = (
  context: SettlementContext,
  actor: SettlementActor,
  dt: number,
  stalled: boolean
) => {
  const needsDetour = carrierNeedsDetour(context, actor, actor.path[actor.pathIndex], stalled);
  if (!canRetryCarrierDetour(actor, dt, needsDetour, () => requestNavigationRepair(context, actor))) return;
  const blocked = (point: SettlementPoint) => carrierPointBlocked(context, actor, point);
  for (const index of carrierDetourCandidates(actor, (point) => !blocked(point))) {
    const waypoint = actor.path[index]!;
    const detour = findGroundPath(
      context,
      actor,
      waypoint,
      blocked,
      (point) => isOwnStockCourtyard(context, actor, point),
      stalled ? 0.125 : 0.5,
      512
    );
    if (!detour) continue;
    setActorPath(actor, [...detour, ...actor.path.slice(index + 1)], actor.phase);
    actor.timer = 0;
    return;
  }
};
/** Courtyard exit access belongs only to the current return leg. */
const releaseExitedCarrierCourt = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.stockBuilding === undefined || !["home", "deliver", "pickup"].includes(actor.phase)) return;
  const yard = context.buildings.find(site => site.uid === actor.stockBuilding);
  if (yard && Math.abs(actor.x - yard.x) <= yard.width / 2 + .15 &&
    Math.abs(actor.z - yard.z) <= yard.depth / 2 + .15) return;
  actor.stockBuilding = undefined;
};

/** Legacy/repaired journeys must reach the public approach before reserving an interior passage. */
const repairRemoteStorageEntry = (context: SettlementContext, actor: SettlementActor) => {
  let phase = ({ enterDelivery: "deliver", enterHome: "home", enterPickup: "pickup" } as Record<string, string>)[actor.phase];
  // Door-queue waiting places keep off the roads on purpose; the FIFO owns their rejoin path. Read
  // as an off-road pickup, a queued pickup that took the HQ turn idled there and held it for minutes.
  const offRoadPickup = !isManagedStorageArrival(context, actor) && carrierPickupLeavesRoads(context, actor);
  if (offRoadPickup) phase = "pickup";
  if (!phase) return true;
  let uid = actor.home;
  if (phase === "deliver") uid = actor.delivery?.destination ?? uid;
  if (phase === "pickup") uid = actor.delivery?.source ?? uid;
  const building = context.buildings.find(site => site.uid === uid);
  if (phase === "pickup" && actor.delivery && building) {
    const target = context.buildings.find(site => site.uid === actor.delivery!.destination);
    if (target && !context.options.roads.route(building.access, target.access) &&
      cancelUnreachableTask(context, actor)) return true;
  }
  if (!building || (!offRoadPickup &&
    DMath.hypot(actor.x - building.access.x, actor.z - building.access.z) < 3)) return true;
  // Only a short local court/road join may use terrain routing. Inter-building transit stays on roads.
  const recovery = carrierRoadRecoveryPath(context, actor, building.access);
  if (!recovery) { actor.action = "idle"; recordMovementOutcome(actor, "invalid-route"); return false; }
  actor.stockBuilding = recovery.court;
  actor.navigationRecovery = undefined;
  actor.storageArrivalBuilding = undefined;
  actor.storageArrivalOrder = undefined;
  setActorPath(actor, recovery.path, phase);
  return true;
};

/**
 * A claim that made no progress before pickup is cancelled; after pickup the cargo is kept and only
 * the destination promise is released. Returning uses the existing home path, so nothing teleports
 * and a missing path leaves the carrier in the visible retry state.
 */
const expireCarrierDelivery = (context: SettlementContext, actor: SettlementActor) => {
  const delivery = actor.delivery;
  // A carrier cut off by a removed bridge keeps its delivery and waits (owner 2026-11-07).
  if (!delivery || actor.bridgeWait || !deliveryLeaseExpired(context, delivery)) return false;
  const released = releaseDeliveryClaim(context, actor);
  if (!released) return false;
  actor.navigationRecovery = undefined;
  if (actor.phase === "inside" && !released.pickedUp) {
    actor.path = [];
    actor.pathIndex = 0;
    actor.action = "idle";
    actor.visible = false;
    return true;
  }
  if (!actor.visible) {
    actor.phase = "home";
    if (recoverUndepartedCarrier(context, actor)) return true;
  }
  const from = context.buildings.find(building => building.uid ===
    (released.destination ?? released.source));
  if (from && returnCarrierHome(context, actor, from)) return true;
  if (from) actor.building = from.uid;
  actor.phase = "returnBlockedCarrier";
  actor.action = "idle";
  actor.visible = true;
  actor.timer = 1;
  return true;
};

const CARRIER_DETOUR_PHASES = new Set(["deliver", "home", "pickup"]);
const updateCarrierStep = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (!repairRemoteStorageEntry(context, actor)) return;
  releaseExitedCarrierCourt(context, actor);
  if (actor.phase === "inside") return;
  if (actor.phase === "pickupTransfer") {
    if (!advanceWareTransfer(actor, dt)) return;
    clearWareTransfer(actor);
    leaveStockLoaded(context, actor);
    return;
  }
  if (actor.phase === "deliveryTransfer") {
    if (!advanceWareTransfer(actor, dt)) return;
    finishDelivery(context, actor);
    return;
  }
  if (
    ["carrierPickupBlocked", "carrierDeliveryBlocked", "carrierLoadedBlocked"].includes(actor.phase)
  ) {
    if (actor.queueTarget) {
      moveActor(context, actor, dt);
      return;
    }
    faceWaitingDestination(actor, dt);
    actor.timer -= dt;
    if (actor.timer > 0) return;
    actor.timer = 1;
    if (actor.phase === "carrierLoadedBlocked") leaveStockLoaded(context, actor);
    else
      beginStockWalk(context, actor, actor.phase === "carrierPickupBlocked" ? "output" : "input");
    return;
  }
  if (actor.phase === "returnBlockedCarrier") {
    actor.action = "idle";
    actor.timer -= dt;
    if (actor.timer > 0) return;
    actor.timer = 1;
    const destination = context.buildings.find((entry) => entry.uid === actor.building)!;
    returnCarrierHome(context, actor, destination);
    return;
  }
  if (actor.phase === "exitLoaded" && actor.pathIndex >= 2) actor.phase = "deliver";
  const stalled = carrierJourneyStalled(actor, dt) && !isHoldingStorageTurn(context, actor);
  // A carrier still indoors waits for its door turn: no people-aware detour (or repair grant) applies yet.
  if (!actor.queueTarget && actor.visible && CARRIER_DETOUR_PHASES.has(actor.phase))
    detourCrowdedCarrier(context, actor, dt, stalled);
  const arrived = moveActor(context, actor, dt);
  if (!arrived) return;
  if (actor.phase === "exitDelivery") {
    const destination = context.buildings.find(building => building.uid === actor.building)!;
    if (!returnCarrierHome(context, actor, destination)) {
      actor.phase = "returnBlockedCarrier";
      actor.timer = 1;
    }
    return;
  }
  if (actor.phase === "carrierLoadedParking") {
    actor.phase = "carrierLoadedBlocked";
    actor.action = "idle";
    actor.timer = 1;
    return;
  }
  if (actor.phase === "home") {
    const home = context.buildings.find((entry) => entry.uid === actor.home)!;
    if (!canEnterDoor(context, actor, home)) return;
    setActorPath(actor, entrancePath(home), "enterHome");
    return;
  }
  if (actor.phase === "pickup") {
    const source = context.buildings.find((building) => building.uid === actor.delivery!.source)!;
    const destination = context.buildings.find(
      (building) => building.uid === actor.delivery!.destination
    )!;
    const route = context.options.roads.route(source.access, destination.access);
    if (!route) {
      actor.action = "idle";
      actor.timer -= dt;
      if (actor.timer <= 0) {
        actor.timer = 1;
        cancelUnreachableTask(context, actor);
      }
      return;
    }
    if (STORAGE_IDS.has(source.typeId) && source.hasDoor) {
      if (!canEnterDoor(context, actor, source)) return;
      setActorPath(actor, entrancePath(source), "enterPickup");
      return;
    }
    if (!STORAGE_IDS.has(source.typeId)) {
      beginStockWalk(context, actor, "output");
      return;
    }
    actor.ware = actor.delivery!.ware;
    setActorPath(actor, route.points, "deliver");
    return;
  }
  if (actor.phase === "enterPickup") {
    const source = context.buildings.find((building) => building.uid === actor.delivery!.source)!;
    const destination = context.buildings.find(
      (building) => building.uid === actor.delivery!.destination
    )!;
    const route = context.options.roads.route(source.access, destination.access);
    if (!route) {
      actor.action = "idle";
      actor.timer -= dt;
      if (actor.timer <= 0) {
        actor.timer = 1;
        cancelUnreachableTask(context, actor);
      }
      return;
    }
    actor.visible = false;
    actor.ware = actor.delivery!.ware;
    source.door = 1;
    setActorPath(actor, [...exitPath(source), ...route.points], "exitLoaded");
    return;
  }
  if (actor.phase === "pickupStockWalk") {
    const source = context.buildings.find((entry) => entry.uid === actor.delivery!.source)!;
    const ware = actor.delivery!.ware;
    const sourceGoods = actor.delivery!.sourceInput ? source.input : source.output;
    if (!(sourceGoods[ware] ?? 0) || (source.typeId === 16 && isCatapultAmmoKind(ware) && actor.delivery!.sourceInput &&
      !catapultOutgoingStone(source, ware))) {
      actor.phase = "carrierPickupBlocked";
      actor.action = "idle";
      actor.timer = 1;
      return;
    }
    const contact = stockContact(
      context,
      source,
      actor.delivery!.sourceInput ? "input" : "output",
      ware,
      actor.delivery!.sourceInput ? Math.max(0, (source.input[ware] ?? 0) - 1)
        : Math.max(0, countGoods(source.output) - 1)
    );
    if (DMath.hypot(contact.approach.x - actor.x, contact.approach.z - actor.z) > 0.15) {
      actor.phase = "carrierPickupBlocked";
      actor.timer = 0;
      return;
    }
    actor.stockContact = contact;
    addGood(sourceGoods, ware, -1);
    actor.delivery!.reserved = false;
    actor.ware = ware;
    startWareTransfer(actor, "pickup", ware, contact);
    actor.phase = "pickupTransfer";
    return;
  }
  if (actor.phase === "deliveryStockWalk") {
    // Nation changes invalidate the old ware's stock dimensions and grip. Re-enter through the
    // live bay before starting a transfer; the carried goods and delivery claim stay with the actor.
    if (!actor.stockContact || actor.stockContact.ware !== actor.ware) {
      beginStockWalk(context, actor, "input");
      return;
    }
    startWareTransfer(actor, "putdown", actor.ware!, actor.stockContact!);
    actor.phase = "deliveryTransfer";
    return;
  }
  if (actor.phase === "exitLoaded") actor.phase = "deliver";
  if (actor.phase === "deliver" || actor.phase === "enterDelivery") {
    const destination = context.buildings.find(
      (building) => building.uid === actor.delivery!.destination
    )!;
    const storage = destination.construction === 1 && STORAGE_IDS.has(destination.typeId);
    const indoorMine = destination.construction === 1 && destination.typeId >= 10 && destination.typeId <= 13;
    if ((storage || indoorMine) && actor.phase === "deliver" && destination.hasDoor) {
      if (!canEnterDoor(context, actor, destination)) return;
      setActorPath(actor, entrancePath(destination), "enterDelivery");
      return;
    }
    if (!storage && !indoorMine) {
      beginStockWalk(context, actor, "input");
      return;
    }
    finishDelivery(context, actor);
    return;
  }
  if (actor.navigationReturnCargo && actor.ware) {
    const home = context.buildings.find(entry => entry.uid === actor.home)!;
    addGood(home.inventory, actor.ware, actor.wareUnits ?? 1);
    actor.ware = null;
    actor.wareScale = undefined;
    actor.wareUnits = undefined;
    actor.navigationReturnCargo = undefined;
  }
  actor.phase = "inside";
  actor.visible = false;
  actor.action = "idle";
};

/** Deliveries lease their destination claim; only a real movement/handling milestone renews it. */
export const updateCarrier = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  reconcileNextDelivery(context, actor);
  if (recoverUndepartedCarrier(context, actor) || expireCarrierDelivery(context, actor)) {
    releaseNextDelivery(context, actor); return;
  }
  const progress = carrierClaimProgress(actor);
  updateCarrierStep(context, actor, dt);
  reconcileNextDelivery(context, actor);
  refreshCarrierClaimOnProgress(context, actor, progress);
};

/** Demand is served first. Never send to a warehouse exporting the same ware. */
const scheduleStorageExports = (context: SettlementContext, options: LandDispatchOptions = {}) => {
  for (const source of context.buildings) {
    if (source.construction !== 1 || !STORAGE_IDS.has(source.typeId) || !inPass(context, options, source)) continue;
    for (const [ware, enabled] of Object.entries(source.exports ?? {})) {
      if (!enabled || availableGood(context, source, ware) < 1) continue;
      const destinations = context.buildings.filter(destination => destination !== source &&
        destination.construction === 1 && STORAGE_IDS.has(destination.typeId) &&
        servesBuildingEconomy(context, destination, source) &&
        destination.accepts[ware] !== false && destination.exports?.[ware] !== true)
        .map(destination => ({ destination,
          route: routeMetrics(context.options.roads, source.access, destination.access).route }))
        .filter(entry => entry.route).sort((a, b) => a.route!.cost - b.route!.cost || a.destination.uid - b.destination.uid);
      for (const { destination } of destinations)
        if (sendWare(context, source, destination, ware, Infinity, false, { ...options, fallback: true })) return true;
    }
  }
  return false;
};
