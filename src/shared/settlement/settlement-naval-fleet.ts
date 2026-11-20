import type { ShipFrame } from "../../render-common/ships/ship-frame";
import { SHIP_SAILING_MULTIPLIER } from "../balance/colonies";
import { DMath } from "../math/deterministic-math";
import { createBoatRoutePlanner } from "./harbour-boat-route";
import type { ShuttleState } from "./harbour-shuttle-plan";
import type { MilitaryTroopType } from "./military-combat-rules";
import { spawnDebugShip } from "./settlement-debug-ship";
import { findHarbourDock } from "./settlement-harbour-docks";
import { isOwnBuilding } from "./settlement-home";
import type { EmigratedTroop } from "./settlement-military";
import { createShipArrivals } from "./settlement-naval-arrivals";
import { canBackhaul, isReturningTransport, navalRouteLength } from "./settlement-naval-backhaul";
import { createFleetBerthing, type FleetBerthing, MOORING_REACH } from "./settlement-naval-berthing";
import { type CargoTransfer, createCargoTransfers, releaseHarbourReservedCargo } from "./settlement-naval-cargo-transfer";
import type { ShipOutside } from "./settlement-naval-channel-yield";
import { createNavalFerries } from "./settlement-naval-ferries";
import { createShipHelm } from "./settlement-naval-helm";
import { createHarbourLighters, type LighterJob } from "./settlement-naval-lighters";
import { createNavalMissionRouting } from "./settlement-naval-mission-route";
import { createNavalOrders } from "./settlement-naval-orders";
import { createRewardShips, rewardShipBoundFor } from "./settlement-naval-reward-ships";
import { planHandling, shipAppearance, shipFrame } from "./settlement-naval-ship-handling";
import { createHarbourShuttles } from "./settlement-naval-shuttles";
import { terrainObstructsShip } from "./settlement-naval-terrain";
import { isTradeShip, type TradeShipHooks } from "./settlement-naval-trade";
import { createVisitorShips, faceCourse } from "./settlement-naval-visitors";
import { reliefShipOutsideMap, routeWithReliefDeparture } from "./settlement-relief-departure";
import type { CoastalWorkSite } from "./settlement-sea-navigation";
import type { ShipObstacle } from "./settlement-ship-clearance";
import { createShipRoutePlanner, type ShipDestination, type ShipRoutePoint } from "./settlement-ship-routes";
import type { ShipWorkpoint } from "./settlement-ship-workpoint";
import { voyageTalentRate } from "./settlement-talents";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { shipArrivalEstimate } from "./ship-arrival-estimate";
import type { CargoHandling } from "./ship-cargo-handling";
import { shipRegisterJourney } from "./ship-register-journey";
import { shipRegisterManifest } from "./ship-register-manifest";
import { canSinkShip, SHIP_SINK_SECONDS } from "./ship-sinking";
import { shipTravelSeconds } from "./ship-travel-time";
import type { ShipTroopMission } from "./ship-troop-mission";
import { createShipTroopMissions } from "./ship-troop-missions";
import { SHIPYARD_RECIPES } from "./shipyard-recipes";


/** Cargo manifests count only the finite actors assigned to this vessel. */
export const countNavalPassengerJobs = (
  passengerIds: readonly number[], actors: readonly { uid: number; job: string }[]
) => {
  const aboard = new Set(passengerIds);
  const jobs: Record<string, number> = {};
  for (const actor of actors) {
    if (!aboard.has(actor.uid)) continue;
    jobs[actor.job] = (jobs[actor.job] ?? 0) + 1;
  }
  return jobs;
};

/** Embarked soldiers per troop type (actors and soldiers from another island), for the register's unit icons. */
export const countNavalPassengerTroops = (
  passengerIds: readonly number[], troopType?: (uid: number) => MilitaryTroopType | undefined,
  foreign: readonly EmigratedTroop[] = []
) => {
  const troops: Partial<Record<MilitaryTroopType, number>> = {};
  const types = [...[...new Set(passengerIds)].map(uid => troopType?.(uid)), ...foreign.map(troop => troop.type)];
  for (const type of types) if (type) troops[type] = (troops[type] ?? 0) + 1;
  return troops;
};

const VISITOR_NAMES: Readonly<Record<NavalVisitorRole, string>> = {
  ore: "Ore ship", reward: "Reward ship", supply: "Supply ship", trade: "Trade ship", troops: "Troop ship"
};
const shipName = (ship: { id: number; visitor?: NavalVisitor }) => {
  return ship.visitor ? VISITOR_NAMES[ship.visitor.role ?? "supply"] : `Ship ${ship.id}`;
};
export interface NavalExpedition {
  x: number; z: number; rotation: number; water: SettlementPoint;
}
/** A valid shore claim whose three crew now build the harbour on land. */
export interface NavalFoundingSite {
  uid: number;
  remaining: number[];
  /** The dry landing where the ship's boxes and crew come ashore. */
  shore?: SettlementPoint;
}
export interface NavalExploration { points: SettlementPoint[]; cursor: number; returning: boolean }
/** What an own ship sent to an ended colony brings back to its harbour. */
export interface NavalHomewardLoad { cargo: Goods; troops: EmigratedTroop[] }
/**
 * One ship load of a colony expedition; it leaves the map at `exit` and returns empty, or with
 * `homeward` when it fetched an ended colony's soldiers and wares.
 */
export interface NavalColonyVoyage {
  expeditionId: number; exit: SettlementPoint; boxes: number; voyageSeconds: number; arrived?: boolean;
  /** A voyage to an adventure island: the adventure sailing talent applies, not Shipping. */
  adventure?: true;
  homeward?: NavalHomewardLoad;
  /** Display-only outbound manifest after passengers emigrated from the home simulation. */
  manifest?: { cargo: Goods; jobs: Goods; troops: Partial<Record<MilitaryTroopType, number>> };
}
export type NavalColonyEvent = "depart" | "arrive";
/**
 * Why a ship from another island calls: supplies, a colony's ore, an adventure's reward and survivors,
 * or soldiers from home for a colony's military buildings.
 */
export type NavalVisitorRole = "ore" | "reward" | "supply" | "trade" | "troops";
/** A ship from another island: it unloads, may pick up wares, then sails off the map again. */
export interface NavalVisitor {
  exit: SettlementPoint; pickup: string[]; leaving?: boolean;
  /** Absent on supply ships and in older saves. */
  role?: NavalVisitorRole;
  sourceColony?: number;
  /** Own soldiers to collect at the colony harbour; boarding uses the normal physical passage. */
  pickupTroops?: number[];
  /** Role `trade`: the trade delivery it serves and its pier queue number (settlement-naval-trade.ts). */
  /** `collecting`: sent ahead while carriers still bring the payment; it waits offshore until it is ready. */
  trade?: { collecting?: true; delivery: string; queue: number };
  /** New physical relief jobs are explicit versioned payloads; ordinary legacy visitors remain unchanged. */
  relief?: { version: 1; questId: string; tail?: import("./settlement-relief-departure").ReliefDepartureTail };
}

/** The fleet's saved value state; `shuttles` is absent in saves made before the nearby boat service. */
export interface NavalFleetSave {
  ships: NavalShip[];
  orders: NavalOrder[];
  nextShip: number;
  nextOrder: number;
  shuttles?: ShuttleState;
}
export interface NavalOrder {
  id: number; sourceUid: number; destinationUid: number; cargo: Goods;
  /** Own unloading ship reserved for this next ordinary transport leg. */
  preferredShipId?: number;
  /** Receiving pool survives replacement of its harbour while this physical load is in flight. */
  destinationPoolId?: number;
  /** Automatic target deficit before the capacity-limited batch; not additional cargo. */
  demand?: Goods;
  passengers?: number[]; expedition?: NavalExpedition; exploration?: NavalExploration; colony?: NavalColonyVoyage;
  /** The idle own ship reserved by the preparation that queued this load. */
  shipId?: number;
}
export interface NavalPassengerHooks extends TradeShipHooks {
  /** Current uncovered target need, excluding this pending order from committed arrivals. */
  remainingTransportNeed?(order: NavalOrder): number | undefined;
  ready(ids: readonly number[]): boolean;
  embark(ids: readonly number[]): void;
  /** Walks reserved passengers along the physical harbour pier; true once every passenger is aboard. */
  loadPassengers?(ship: NavalShip, dt: number): boolean;
  /** Troop ships (MIL-SHIPS-SIM): the harbour pier passage alone, without a commander's own boarding. */
  loadTroopPassengers?(ship: NavalShip): boolean;
  /** Sends passengers ashore over the destination harbour's pier; true once every one is inside. */
  unloadPassengers?(ship: NavalShip): boolean;
  release(ids: readonly number[], destination: number): void;
  found?(expedition: NavalExpedition, cargo: Goods, passengers: number[], shipId: number):
    NavalFoundingSite | null;
  /** A founding ship is recalled after landing: evacuate the unfinished site before it sails home.
   *  False keeps the operation (a completed anchor or no safe recovery harbour). */
  cancelFounding?(ship: NavalShip): boolean;
  colonyVoyage?(expeditionId: number, event: NavalColonyEvent, cargo: Goods, passengers: number[]): void;
  /** Wares a visiting ship took aboard; they leave this island for good. */
  visitorLoaded?(goods: Goods): void;
  reserveTroops?(ids: readonly number[], harbour: SettlementBuilding): number[] | null;
  visitorTroopsDepart?(ids: readonly number[]): void;
  /** Soldiers from another island go ashore at the harbour as stored soldiers. */
  landTroops?(troops: readonly EmigratedTroop[], harbourUid: number): void;
}
export interface NavalShip extends ShipFrame {
  cargo: Goods; route: ShipRoutePoint[]; cursor: number; timer: number;
  /** Way along the keel (tiles/s, astern < 0); absent in older saves (at rest). */
  speed?: number;
  /** The dock porters' job while loading or unloading at a pier (absent in older saves: none). */
  handling?: CargoHandling;
  retryPhase?: "positioning" | "sailing";
  terrainBlocked?: boolean;
  sourceUid?: number; destinationUid?: number; orderId?: number; cancelled?: boolean; passengers?: number[]; expedition?: NavalExpedition; exploration?: NavalExploration;
  /** An idle ship held exclusively for one expedition preparation (negative preparation id). */
  reservedFor?: number;
  /** A ship sailing to, or being taken apart at, a shipyard work site. */
  dismantle?: {
    yardUid: number;
    site: CoastalWorkSite & { work?: ShipWorkpoint };
    progress: number;
    /** Remaining refund units, credited one per dismantle step. */
    refund: string[];
    worker?: number;
  };
  /** Pending ordinary settler/ware leg; does not replace the current voyage before unloading. */
  nextOrderId?: number;
  /** Last physically completed harbour contact, retained during an empty parking return. */
  lastHarbourUid?: number;
  destinationPoolId?: number;
  /** A landed founding site whose crew, cargo and this ship remain one operation until settled. */
  foundingSiteUid?: number;
  colony?: NavalColonyVoyage;
  visitor?: NavalVisitor;
  /** Soldiers from another island aboard (no actors on this island until they land). */
  troops?: EmigratedTroop[];
  /** Empty and back from a colony voyage: sailing to wait here, clear of the harbour berth. */
  anchorage?: SettlementPoint;
  /** Loaded, its harbour's berth taken: sailing to (or lying at) this waiting spot until it is free. */
  queuedAt?: SettlementPoint;
  /** Behind the first ship of the queue, `queuedAt` lies at the map edge (NAV-02 queue rules). */
  waitsAtEdge?: boolean;
  /** Loading or unloading at its waiting spot, worked by the harbour's lighters (NAV-03). */
  lighters?: LighterJob;
  /** Box by box unloading (or a visitor's pickup loading) at a harbour: the boxes already moved. */
  transfer?: CargoTransfer;
  /** Bound for (or lying at) this waiting spot, where the harbour's lighters ferry its passengers (2026-10-21). */
  ferryAt?: SettlementPoint;
  gone?: boolean;
  /** A player-controlled troop voyage (MIL-SHIPS-SIM): boarding, sailing, anchored or landing soldiers. */
  troopMission?: ShipTroopMission;
  /** Out of a narrow channel to let another ship pass: sailing out, or waiting beyond the map edge (2026-11-17). */
  outside?: ShipOutside;
}
/** The ship lies at `spot` (within its mooring reach). */
const lyingAt = (ship: NavalShip, spot?: SettlementPoint) =>
  Boolean(spot) && DMath.hypot(spot!.x - ship.x, spot!.z - ship.z) < MOORING_REACH;
/** The harbour a ship works at or is bound for (a visitor beyond the map edge counts for its harbour). */
const servedHarbour = (ship: NavalShip) => {
  if (ship.phase === "idle" || (ship.phase === "away" && !ship.visitor)) return undefined;
  const loading = ship.phase === "positioning" || ship.phase === "loading" || ship.retryPhase === "positioning";
  return loading ? ship.sourceUid : ship.destinationUid;
};
/**
 * Where a ship from another island calls (owner, 2026-10-15): of the player's finished harbours with
 * a berth, a pickup goes where its wares are stored, then the fewest ships per berth working there
 * or on their way; ties keep `preferred` (the home harbour), then the order they were built in.
 */
const bestHarbourFor = (
  context: SettlementContext, ships: readonly NavalShip[], orders: readonly NavalOrder[],
  berths: FleetBerthing["berths"], pickup: readonly string[], preferred?: number
) => {
  /** Ships working at or bound for the harbour, and loads still waiting there for a ship. */
  const harbourTraffic = (uid: number) => ships.filter(ship => servedHarbour(ship) === uid).length +
    orders.filter(order => order.sourceUid === uid).length;
  const candidates = context.buildings.filter(building => building.typeId === 39 && building.construction === 1 &&
    isOwnBuilding(building));
  const rank = (building: SettlementBuilding) => {
    const count = berths.forHarbour(building.uid, true).length;
    if (!count) return [];
    const stocked = pickup.some(ware => (building.inventory[ware] ?? 0) > 0);
    return [{ elsewhere: Number(building.uid !== preferred), uid: building.uid,
      unstocked: Number(pickup.length > 0 && !stocked), waiting: harbourTraffic(building.uid) / count }];
  };
  const ranked = candidates.flatMap(rank).sort((a, b) =>
    a.unstocked - b.unstocked || a.waiting - b.waiting || a.elsewhere - b.elsewhere);
  return ranked[0]?.uid;
};
/** An unloaded ship with no load waiting leaves the berth for a clear waiting spot. */
/** An unloading ship lies at the harbour it delivers to (not an expedition beach or a scouting point). */
const landsAtHarbour = (ship: NavalShip, accepting: FleetBerthing["accepting"], harbor: FleetBerthing["harbor"]) =>
  !ship.expedition && !(ship.exploration && !ship.exploration.returning) &&
  Boolean(accepting(ship.destinationUid!, ship.cargo, ship) && harbor(ship.destinationUid!));
const clearHarbourBerth = (ship: NavalShip, uid: number, orders: readonly NavalOrder[],
  anchorage: FleetBerthing["anchorage"], route: FleetBerthing["route"]) => {
  if (orders.some(order => order.sourceUid === uid)) return;
  // A ship unloaded by lighters already lies at a waiting spot clear of every approach: it stays there.
  if (ship.lighters) return;
  const spot = anchorage(uid, ship);
  if (spot && route(ship, spot, "sailing")) ship.anchorage = spot;
};
const clearShipToIdle = (ship: NavalShip) => {
  Object.assign(ship, { anchorage: undefined, cargo: {}, cargoCount: 0, destinationPoolId: undefined, destinationUid: undefined,
    ferryAt: undefined, foundingSiteUid: undefined, handling: undefined, queuedAt: undefined, reservedFor: undefined,
    transfer: undefined, waitsAtEdge: undefined,
    exploration: undefined, orderId: undefined, outside: undefined, passengers: [], phase: "idle", sourceUid: undefined,
    troopMission: undefined, troops: undefined });
};
/** A troop ship done at harbour `uid` is idle there and leaves the berth like an unloaded ship. */
const parkAfterTroops = (ship: NavalShip, uid: number, orders: readonly NavalOrder[], berthing: FleetBerthing) => {
  clearShipToIdle(ship);
  ship.lastHarbourUid = uid;
  clearHarbourBerth(ship, uid, orders, berthing.anchorage, berthing.route);
};
/** Expedition ship claims and their landed founding lifetime; one owner per operation. */
const createShipOperations = (ships: NavalShip[], orders: NavalOrder[],
  dock: (uid: number) => ShipDestination | undefined,
  planner: ReturnType<typeof createShipRoutePlanner>, context: SettlementContext) => {
  const reserveShip = (sourceUid: number, operationId: number) => {
    const berth = dock(sourceUid);
    if (!berth) return null;
    const candidates = ships.filter(ship => ship.phase === "idle" && !ship.visitor &&
      ship.orderId === undefined && ship.reservedFor === undefined && ship.nextOrderId === undefined &&
      !ship.passengers?.length &&
      !ship.troops?.length && !Object.values(ship.cargo).some(count => count > 0) &&
      Boolean(planner.route(ship, berth)));
    candidates.sort((a, b) => DMath.hypot(a.x - berth.x, a.z - berth.z) -
      DMath.hypot(b.x - berth.x, b.z - berth.z) || a.id - b.id);
    const ship = candidates[0];
    if (!ship) return null;
    ship.reservedFor = operationId;
    return ship.id;
  };
  const releaseShipReservation = (operationId: number) => {
    const ship = ships.find(candidate => candidate.reservedFor === operationId);
    if (!ship) return false;
    ship.reservedFor = undefined;
    return true;
  };
  const reservedShip = (shipId: number) =>
    ships.some(ship => ship.id === shipId && ship.reservedFor !== undefined) ? shipId : null;
  const expeditionTargets = () => [...orders.flatMap(order => order.expedition ? [order.expedition] : []),
    ...ships.flatMap(ship => ship.expedition ? [ship.expedition] : [])];
  /** An idle own ship that can physically reach this harbour's berth now. */
  const hasIdleShipAt = (sourceUid: number) => {
    const berth = dock(sourceUid);
    if (!berth) return false;
    return ships.some(ship => ship.phase === "idle" && !ship.visitor &&
      ship.orderId === undefined && ship.reservedFor === undefined && ship.nextOrderId === undefined &&
      !ship.passengers?.length &&
      !ship.troops?.length && !Object.values(ship.cargo).some(count => count > 0) &&
      Boolean(planner.route(ship, berth)));
  };
  /** A ship finishing a delivery here can take the next load without an empty remote approach. */
  const canServeTransportAt = (sourceUid: number) => ships.some(ship =>
    canBackhaul(ship, sourceUid)) || hasIdleShipAt(sourceUid) ||
    ships.some(ship => ship.phase === "idle" && !ship.visitor && ship.reservedFor === undefined &&
      ship.nextOrderId !== undefined && orders.some(order => order.id === ship.nextOrderId &&
        order.sourceUid === sourceUid && order.preferredShipId === ship.id)) ||
    ships.some(ship => isReturningTransport(ship) && ship.nextOrderId === undefined &&
      ship.reservedFor === undefined && dock(sourceUid) !== undefined &&
      Boolean(planner.route(ship, dock(sourceUid)!)));
  /** The sea route between two own harbours: demand must not promise an unreachable trip. */
  const transportDistance = (sourceUid: number, destinationUid: number) => {
    const start = dock(sourceUid), end = dock(destinationUid);
    if (!start || !end) return Infinity;
    const route = planner.route({ ...start, yaw: start.yaw ?? 0 }, end);
    return route ? navalRouteLength(start, route) : Infinity;
  };
  const canReachHarbour = (sourceUid: number, destinationUid: number) =>
    Number.isFinite(transportDistance(sourceUid, destinationUid));
  /** Boxes of this ware already promised to the receiving harbour by orders or real ship manifests. */
  const coverageFor = (destinationUid: number, ware: string) =>
    orders.reduce((sum, order) => sum + (order.destinationUid === destinationUid &&
      !order.expedition && !order.exploration && !order.colony ? order.cargo[ware] ?? 0 : 0), 0) +
    ships.reduce((sum, ship) => sum + (ship.destinationUid === destinationUid && ship.phase !== "away" &&
      !ship.visitor && !ship.expedition && !ship.exploration && !ship.colony && ship.foundingSiteUid === undefined ?
      ship.cargo[ware] ?? 0 : 0), 0);
  const coverageForPool = (poolId: number, ware: string) => {
    const receiver = (destinationUid: number | undefined, saved: number | undefined, cancelled = false) =>
      context.buildings.find(building => building.uid === destinationUid)?.storagePoolId ??
        (cancelled ? undefined : saved);
    return orders.reduce((sum, order) => sum + (!order.expedition && !order.exploration && !order.colony &&
      receiver(order.destinationUid, order.destinationPoolId) === poolId ? order.cargo[ware] ?? 0 : 0), 0) +
      ships.reduce((sum, ship) => sum + (ship.phase !== "away" && !ship.visitor && !ship.expedition &&
        !ship.exploration && !ship.colony && ship.foundingSiteUid === undefined &&
        receiver(ship.destinationUid, ship.destinationPoolId, ship.cancelled) === poolId ? ship.cargo[ware] ?? 0 : 0), 0);
  };
  const foundingShip = (shipId: number) =>
    ships.find(ship => ship.id === shipId && ship.foundingSiteUid !== undefined);
  const withdrawFoundingCargo = (shipId: number, ware: string, count = 1) => {
    const ship = foundingShip(shipId);
    const amount = Math.min(count, ship?.cargo[ware] ?? 0);
    if (!ship || amount <= 0) return 0;
    ship.cargo[ware] = (ship.cargo[ware] ?? 0) - amount;
    if (ship.cargo[ware]! <= 0) delete ship.cargo[ware];
    ship.cargoCount -= amount;
    return amount;
  };
  const addFoundingCargo = (shipId: number, ware: string, count: number) => {
    const ship = foundingShip(shipId);
    if (!ship || count <= 0) return false;
    ship.cargo[ware] = (ship.cargo[ware] ?? 0) + count;
    ship.cargoCount += count;
    return true;
  };
  /** Finished (or recovered) founding: the ship becomes idle and free for other work. */
  const releaseFoundingShip = (shipId: number) => {
    const ship = foundingShip(shipId);
    if (!ship) return false;
    clearShipToIdle(ship);
    return true;
  };
  return {
    addFoundingCargo, canReachHarbour, canServeTransportAt, coverageFor, coverageForPool, expeditionShip: (shipId: number) => ships.find(ship => ship.id === shipId),
    expeditionTargets, foundingShip, hasIdleShipAt, releaseFoundingShip, releaseShipReservation, reserveShip,
    reservedShip, transportDistance, withdrawFoundingCargo
  };
};
/** Observation only: copy a bounded upcoming path, never expose or replan the live route. */
const shipRouteView = (ships: readonly NavalShip[], id: number) => {
  const ship = ships.find(entry => entry.id === id);
  if (!ship || (ship.phase !== "sailing" && ship.phase !== "positioning")) return null;
  const points = ship.route.slice(ship.cursor, ship.cursor + 64).map(point => ({ x: point.x, z: point.z }));
  const last = ship.route.at(-1);
  return points.length ? { points, index: 0, truncated: ship.route.length - ship.cursor > 64,
    destination: last && { x: last.x, z: last.z } } : null;
};
/**
 * How much faster a ship's time beyond the map edge runs: adventure voyages and an adventure's reward
 * ship follow the adventure sailing talent, every other voyage (trade, supply, ore, troops, colony) Shipping.
 */
export const shipVoyageRate = (context: Pick<SettlementContext, "talents">, ship: NavalShip) =>
  voyageTalentRate(context, Boolean(ship.colony?.adventure) || ship.visitor?.role === "reward");
/** The ship register's row for a ship. */
const shipSnapshot = (context: SettlementContext, ship: NavalShip) => {
  const rate = shipVoyageRate(context, ship);
  const manifest = shipRegisterManifest(ship, context);
  const passengerCount = Math.max(ship.passengers?.length ?? 0,
    Object.values(manifest.jobs).reduce((sum, count) => sum + count, 0));
  return { ...shipRegisterJourney(ship), ...shipAppearance(ship), id: ship.id, visitor: Boolean(ship.visitor),
    visitorRole: ship.visitor?.role ?? (ship.visitor ? "supply" : undefined), sourceColony: ship.visitor?.sourceColony,
    incoming: Boolean(ship.visitor && !ship.visitor.leaving &&
      (Object.values(ship.cargo).some(count => count > 0) || ship.troops?.length)),
    arrivalSeconds: ship.visitor && !ship.visitor.leaving ? shipArrivalEstimate(ship, rate) : undefined,
    troopRecall: Boolean(ship.visitor?.pickupTroops),
    returningHome: Boolean(ship.visitor?.pickupTroops && ship.visitor.leaving),
    name: ship.visitor?.relief ? "Relief collection ship" : shipName(ship), reliefQuestId: ship.visitor?.relief?.questId, phase: ship.phase,
    cargo: { ...manifest.cargo }, passengerJobs: manifest.jobs,
    aboardPassengers: ship.phase === "away" ? passengerCount : (ship.passengers ?? []).filter(uid =>
      context.actors.some(actor => actor.uid === uid && actor.phase === "navalAboard")).length,
    passengerTroops: manifest.troops,
    sourceUid: ship.sourceUid, destinationUid: ship.destinationUid, orderId: ship.orderId,
    cancelled: ship.cancelled ?? false, passengers: passengerCount, expedition: Boolean(ship.expedition),
    exploration: Boolean(ship.exploration), colony: ship.colony?.expeditionId,
    nextOrderId: ship.nextOrderId, reservedFor: ship.reservedFor, foundingSiteUid: ship.foundingSiteUid,
    awaySeconds: ship.phase === "away" ? shipTravelSeconds(ship.timer) / rate : undefined, x: ship.x, z: ship.z };
};

/** A restored parking journey resumes its saved anchorage before cargo-unload selection. */
const retryParking = (ship: NavalShip, berthing: FleetBerthing) => {
  if (!ship.anchorage) return false;
  berthing.makeWay(ship, ship.anchorage);
  if (!berthing.route(ship, ship.anchorage, "sailing")) ship.timer = 1;
  return true;
};

/** Restores the same canonical endpoint and keeps any already elapsed physical unloading allowance. */
const renewRestoredShip = (ship: NavalShip, context: SettlementContext, sea: Uint8Array,
  planner: ReturnType<typeof createShipRoutePlanner>, berthing: FleetBerthing) => {
  if (ship.phase === "unloading" && ship.troops?.length && ship.handling) {
    const needed = planHandling(context, ship, false).seconds;
    const extra = Math.max(0, needed - ship.handling.seconds);
    ship.handling = { ...ship.handling, seconds: ship.handling.seconds + extra };
    ship.timer += extra;
  }
  if (!["positioning", "sailing"].includes(ship.phase)) return;
  const endpoint = berthing.routeEndpoint(ship, ship.phase as "positioning" | "sailing");
  // Keep a saved route whose canonical endpoint is unchanged. Replanning it here changes the
  // physical position/cursor of every ship on every load and breaks live/restore endpoint parity.
  const savedEnd = ship.route.at(-1);
  if (endpoint && savedEnd && ship.route.length > ship.cursor &&
    Math.abs(savedEnd.x - endpoint.x) < .01 && Math.abs(savedEnd.z - endpoint.z) < .01) return;
  const renewed = endpoint && routeWithReliefDeparture(context.options.world, sea, ship, endpoint, berthing.obstacles(ship), planner);
  if (renewed) { ship.route = renewed; ship.cursor = 0; }
  else {
    ship.retryPhase = ship.phase as "positioning" | "sailing";
    ship.route = []; ship.phase = "stranded"; ship.timer = 1;
  }
};

export const createNavalFleet = (context: SettlementContext, sea: Uint8Array, hooks?: NavalPassengerHooks,
  construction: () => readonly ShipObstacle[] = () => []) => {
  const ships: NavalShip[] = [], orders: NavalOrder[] = [];
  const sinking = new Map<number, { frame: ShipFrame; elapsed: number }>();
  const sinkShip = (id: number) => {
    const index = ships.findIndex(ship => ship.id === id);
    const ship = ships[index];
    if (!ship || !canSinkShip(ship, orders)) return false;
    sinking.set(id, { frame: shipFrame(ship), elapsed: 0 });
    ships.splice(index, 1);
    return true;
  };
  let nextShip = 1, nextOrder = 1; const takeOrderId = () => nextOrder++;
  const planner = createShipRoutePlanner(context.options.world, sea);
  const berthing = createFleetBerthing({ construction, context, planner, sea, ships });
  const {
    accepting, anchorage, berths, dock, harbor, leaveQueue, neighbourManoeuvring, obstacles, refreshTerrain,
    returnToAnchorage, route, routeEndpoint, routeToBerth, seaExitAt, waitForBerth
  } = berthing;
  const addShip = (point: SettlementPoint, yaw = 0) => {
    const ship: NavalShip = { id: nextShip++, ...point, y: context.options.world.seaLevel, yaw,
      phase: "idle", cargoCount: 0, cargo: {}, route: [], cursor: 0, timer: 0 };
    ships.push(ship); return ship.id;
  };
  const {
    enterWhenClear, finishVisitor, landTroops, leave, requestTroopPickup, sendVisitor, serveTradeShip,
    serveVisitor, visitorLoaded
  } = createVisitorShips({ addShip, arrivesInTime: (...args) => arrivesInTime(...args),
    beginTransfer: ship => transfers.begin(ship), berthing, context, hooks, planner, sea, ships, takeOrderId });
  const shuttles = createHarbourShuttles({ berthing, context, orders,
    planner: createBoatRoutePlanner(context.options.world, sea), ships });
  const lighters = createHarbourLighters({ berthing, boatClaims: shuttles.claimedBoats, context,
    mooringReach: MOORING_REACH, ships });
  const { arrivesInTime, homeInTime } = createShipArrivals({ dock, lighters, planner });
  const transfers = createCargoTransfers(context, hooks);
  const ferries = createNavalFerries({ berthing, context, hooks, lighters, ships });
  const addShipNearDock = (uid: number) => { const spot = anchorage(uid); return spot && addShip(spot, spot.yaw); };
  /** Sends an idle empty ship to a shipyard work site; the shipyard worker dismantles it there. */
  const dismantleShip = (shipId: number, yardUid: number, site: CoastalWorkSite & { work?: ShipWorkpoint }) => {
    const ship = ships.find(candidate => candidate.id === shipId);
    if (!ship || ship.visitor || ship.phase !== "idle" || ship.dismantle ||
      ship.orderId !== undefined || ship.nextOrderId !== undefined || ship.reservedFor !== undefined ||
      ship.foundingSiteUid !== undefined || ship.colony !== undefined || ship.expedition !== undefined ||
      ship.exploration !== undefined || ship.passengers?.length || ship.troops?.length ||
      Object.values(ship.cargo).some(count => count > 0)) return false;
    const destination = { x: site.water.x, z: site.water.z,
      yaw: site.yaw ?? DMath.atan2(site.water.x - site.land.x, site.water.z - site.land.z) + Math.PI / 2 };
    if (!route(ship, destination, "sailing")) return false;
    ship.dismantle = {
      progress: 0,
      refund: [...Array.from({ length: Math.floor(SHIPYARD_RECIPES.ships.planks / 2) }, () => "planks"),
        ...Array.from({ length: Math.floor(SHIPYARD_RECIPES.ships.cloth / 2) }, () => "cloth")],
      site: {
      land: { ...site.land }, path: site.path.map(point => ({ ...point })),
      water: { ...site.water }, yaw: site.yaw, work: site.work && { ...site.work }
    }, yardUid };
    return true;
  };
  const continueMission = createNavalMissionRouting({ construction, leaveQueue,
    makeWay: berthing.makeWay, planner, route });
  const rewardShips = createRewardShips({ bestHarbour: () => bestHarbourFor(context, ships, orders, berths, []),
    context, harbor });
  /** A reward ship that lost its harbour sails to another one, else its load is credited at home (item 35). */
  const recoverRewardShip = (ship: NavalShip): boolean => {
    const result = rewardShips.recover(ship);
    if (result === "rerouted") return chooseUnload(ship);
    if (result === "credited") return leave(ship);
    ship.phase = "stranded"; ship.timer = 1; return false;
  };
  const chooseUnload = (ship: NavalShip): boolean => {
    if (rewardShips.harbourLost(ship)) return recoverRewardShip(ship);
    if (ship.visitor && (ship.visitor.leaving || !harbor(ship.destinationUid!))) return leave(ship);
    if (ship.colony) return leaveForColony(ship);
    const mission = continueMission(ship);
    if (mission !== null) return mission;
    if (ferryIn(ship)) return true;
    const preferred = accepting(ship.destinationUid!, ship.cargo, ship) && dock(ship.destinationUid!);
    if (preferred && planner.route(ship, preferred)) {
      const intended = dock(ship.destinationUid!, ship);
      if (intended && routeToBerth(ship, intended, "sailing", ship.destinationUid!)) { leaveQueue(ship); return true; }
      if (!intended) return waitForBerth(ship, ship.destinationUid!);
      ship.phase = "stranded"; ship.timer = 1; return false;
    }
    const choices = context.buildings.filter((b) => accepting(b.uid, ship.cargo, ship));
    choices.sort((a, b) => Number(b.uid === ship.destinationUid) - Number(a.uid === ship.destinationUid) ||
      DMath.hypot(a.x - ship.x, a.z - ship.z) - DMath.hypot(b.x - ship.x, b.z - ship.z));
    for (const building of choices) {
      const end = dock(building.uid, ship);
      if (!end || !routeToBerth(ship, end, "sailing", building.uid)) continue;
      ship.destinationUid = building.uid; leaveQueue(ship); return true;
    }
    ship.phase = "stranded"; ship.timer = 1; return false;
  };
  const leaveForColony = (ship: NavalShip) => {
    const colony = ship.colony!;
    if (route(ship, colony.exit, "sailing")) return true;
    const nearest = seaExitAt(ship);
    if (nearest && route(ship, nearest, "sailing")) { colony.exit = nearest; return true; }
    ship.phase = "stranded"; ship.timer = 1; return false;
  };
  const departColony = (ship: NavalShip) => {
    const colony = ship.colony!;
    colony.manifest = { cargo: { ...ship.cargo }, jobs: countNavalPassengerJobs(ship.passengers ?? [], context.actors),
      troops: countNavalPassengerTroops(ship.passengers ?? [], context.military?.troopType, ship.troops) };
    ship.phase = "away"; ship.timer = 2 * colony.voyageSeconds; ship.route = []; ship.cursor = 0;
    hooks?.colonyVoyage?.(colony.expeditionId, "depart", ship.cargo, ship.passengers ?? []);
    ship.cargoCount -= ship.passengers?.length ?? 0;
    ship.passengers = [];
  };
  const updateAway = (ship: NavalShip, dt: number) => {
    const rate = SHIP_SAILING_MULTIPLIER * shipVoyageRate(context, ship);
    // Coming in from beyond the edge under full sail, the ship sails on in the same tick.
    if (!ship.colony) {
      if (rewardShips.harbourLost(ship)) {
        const result = rewardShips.recover(ship);
        if (result === "credited") finishVisitor(ship);
        if (result !== "rerouted") return;
      }
      // New discovered routes wait off-map; legacy visitors have zero remaining sailing time.
      if (ship.visitor && ship.timer > 0) {
        const remaining = ship.timer - dt * rate;
        ship.timer = Math.max(0, remaining);
        if (remaining > 0) return;
        dt = -remaining / rate;
      }
      if (enterWhenClear(ship)) sailTick(ship, dt);
      return;
    }
    const colony = ship.colony;
    ship.timer -= dt * rate;
    if (!colony.arrived && ship.timer <= colony.voyageSeconds) {
      colony.arrived = true;
      hooks?.colonyVoyage?.(colony.expeditionId, "arrive", ship.cargo, []);
      ship.cargo = {}; ship.cargoCount = 0;
    }
    if (ship.timer > 0 || !berthing.entryClear(ship, colony.exit) || !homeInTime(ship, colony.exit)) return;
    // Ships re-enter at the same map edge and sail home empty for the next queued load.
    ship.x = colony.exit.x; ship.z = colony.exit.z; ship.colony = undefined;
    ship.destinationUid = ship.sourceUid; ship.orderId = undefined;
    if (colony.homeward) { bringHome(ship, colony.homeward); return; }
    if (returnToAnchorage(ship) || chooseUnload(ship)) faceCourse(ship);
  };
  /** A ship back from an ended colony carries its soldiers and wares to the harbour berth. */
  const bringHome = (ship: NavalShip, load: NavalHomewardLoad) => {
    ship.cargo = { ...load.cargo }; ship.troops = load.troops.map(troop => ({ ...troop }));
    ship.cargoCount = Object.values(ship.cargo).reduce((sum, count) => sum + count, 0) + ship.troops.length;
    if (chooseUnload(ship)) faceCourse(ship);
  };
  const updateStranded = (ship: NavalShip, dt: number) => {
    if (ship.terrainBlocked) {
      ship.timer -= dt;
      if (ship.timer > 0) return;
      const phase = ship.retryPhase ?? "sailing", endpoint = routeEndpoint(ship, phase);
      if (endpoint && route(ship, endpoint, phase)) return;
      ship.terrainBlocked = terrainObstructsShip(context.options.world, sea, planner, ship, endpoint) || undefined;
      ship.timer = 1;
      return;
    }
    ship.timer -= dt;
    if (ship.timer > 0) return;
    if (retryParking(ship, berthing)) return;
    if (ship.ferryAt) { ferryArrived(ship); return; }
    if (lighters.tryStart(ship)) { if (ship.phase === "unloading" || !ship.visitor) transfers.begin(ship); return; }
    // A ship waiting off a harbour asks for room on its way in to the berth, one bound for its spot on its way there.
    const harbourUid = ship.retryPhase === "positioning" ? ship.sourceUid : ship.destinationUid;
    berthing.makeWay(ship, lyingAt(ship, ship.queuedAt) && harbourUid !== undefined ? dock(harbourUid, ship) ?? dock(harbourUid) :
      routeEndpoint(ship, ship.retryPhase ?? "sailing"));
    if (ship.phase !== "stranded") return;
    if (ship.retryPhase === "positioning") {
      const start = dock(ship.sourceUid!, ship);
      if (start && routeToBerth(ship, start, "positioning", ship.sourceUid!)) leaveQueue(ship);
      else ship.timer = 1;
    } else chooseUnload(ship);
  };
  /** Unloaded: a scout sails on, an expedition founds its colony, else the harbour takes the load. */
  const finishUnloading = (ship: NavalShip) => {
    if (ship.exploration && !ship.exploration.returning) {
      ship.exploration.cursor++;
      if (ship.exploration.cursor >= ship.exploration.points.length) ship.exploration.returning = true;
      chooseUnload(ship); return;
    }
    if (ship.expedition) {
      const founded = hooks?.found?.(ship.expedition, ship.cargo, ship.passengers ?? [], ship.id);
      if (founded) {
        // The shore claim is now a construction site: the ship, its remaining cargo and the
        // landed crew stay one operation until the harbour is finished and unloaded.
        ship.foundingSiteUid = founded.uid;
        ship.expedition = undefined;
        ship.passengers = [];
        ship.cargoCount = Object.values(ship.cargo).reduce((sum, count) => sum + count, 0);
        ship.phase = "founding";
        ship.timer = 0;
        ship.route = []; ship.cursor = 0;
        return;
      }
      // A changed/occupied beachhead returns every passenger and receipt to an existing harbour.
      ship.cancelled = true; ship.expedition = undefined; if (ship.exploration) ship.exploration.returning = true;
      ship.destinationUid = ship.sourceUid;
      chooseUnload(ship); return;
    }
    const destination = accepting(ship.destinationUid!, ship.cargo, ship) && harbor(ship.destinationUid!);
    if (!destination) { chooseUnload(ship); return; }
    if (isTradeShip(ship)) { serveTradeShip(ship, destination); return; }
    for (const [ware, n] of Object.entries(ship.cargo))
      destination.inventory[ware] = (destination.inventory[ware] ?? 0) + n;
    landTroops(ship, destination);
    if (ship.visitor) { serveVisitor(ship, destination); return; }
    if (ship.passengers?.length) hooks?.release(ship.passengers, destination.uid);
    clearShipToIdle(ship);
    ship.lastHarbourUid = destination.uid;
    clearHarbourBerth(ship, destination.uid, orders, anchorage, route);
  };
  /** Loading or unloading at the pier: passengers first, then the porters, then the ship casts off. */
  const updateTransfer = (ship: NavalShip, dt: number) => {
    if (ship.phase === "loading" && ship.passengers?.length && !ship.lighters &&
      !findHarbourDock(context, ship.sourceUid, ship)) {
      const start = dock(ship.sourceUid!, ship);
      if (start && route(ship, start, "positioning")) return;
      ship.retryPhase = "positioning"; ship.phase = "stranded"; ship.timer = 1;
      return;
    }
    // People first, then the porters: nobody shares the pier with the boxes.
    if (!passengersMoved(ship, dt)) return;
    ship.timer = Math.max(0, ship.timer - dt);
    transfers.settle(ship);
    if (ship.timer > 0 || neighbourManoeuvring(ship)) return;
    transfers.settle(ship, true);
    if (ship.phase === "loading") {
      if (ship.passengers?.length) hooks?.embark(ship.passengers);
      ship.handling = undefined;
      if (ship.visitor) { visitorLoaded(ship); return; }
      chooseUnload(ship); return;
    }
    const job = ship.lighters;
    finishUnloading(ship);
    lighters.continueLoading(ship, job);
  };
  const updateShip = (ship: NavalShip, dt: number) => {
    if (ship.visitor?.relief?.tail && reliefShipOutsideMap(context.options.world, ship)) { finishVisitor(ship); return; }
    if (ship.phase === "away") {
      ship.speed = 0;
      if (!troopMissions.channel.update(ship, dt)) updateAway(ship, dt);
      return;
    }
    if (ship.phase === "founding" || ship.phase === "dismantling") { ship.speed = 0; return; }
    if (ship.phase !== "positioning" && ship.phase !== "sailing") coast(ship, dt);
    if (troopMissions.update(ship, dt)) return;
    if (ship.phase === "stranded") { updateStranded(ship, dt); return; }
    if (ship.phase === "idle") return;
    if (ship.phase === "loading" || ship.phase === "unloading") { updateTransfer(ship, dt); return; }
    sailTick(ship, dt);
  };
  /** Passengers walk aboard over the pier while loading, and ashore into the harbour while unloading there. */
  const passengersMoved = (ship: NavalShip, dt: number) => {
    // Ferried passengers follow the lighters' plan (settlement-naval-ferries.ts).
    if (!ship.passengers?.length || ship.lighters) return true;
    if (ship.phase === "loading")
      return hooks?.loadPassengers ? hooks.loadPassengers(ship, dt) : Boolean(hooks?.ready(ship.passengers));
    return !hooks?.unloadPassengers || !landsAtHarbour(ship, accepting, harbor) || hooks.unloadPassengers(ship);
  };
  /** Passengers by boat at the destination: the ship sails to a waiting spot off it (true when it does). */
  const ferryIn = (ship: NavalShip) => {
    const unloadsAtHarbour = !ship.exploration || ship.exploration.returning;
    const spot = unloadsAtHarbour && accepting(ship.destinationUid!, ship.cargo, ship) &&
      ferries.spot(ship.destinationUid!, ship, ship, false);
    if (!spot || !route(ship, spot, "sailing")) return false;
    ship.ferryAt = spot; leaveQueue(ship);
    return true;
  };
  /** At its ferry spot: the lighters take over, it waits for its passengers, or it goes to the pier after all. */
  const ferryArrived = (ship: NavalShip) => {
    const loading = ship.phase === "positioning" || ship.retryPhase === "positioning";
    if (ship.phase === "stranded") ship.phase = loading ? "positioning" : "sailing";
    const result = ferries.start(ship);
    if (result === "started") { if (Object.keys(ship.cargo).length) transfers.begin(ship); return; }
    if (result === "pier") { ship.queuedAt = ship.ferryAt; ship.ferryAt = undefined; }
    ship.retryPhase = loading ? "positioning" : undefined;
    ship.phase = "stranded"; ship.timer = 1;
  };
  const arriveAtRouteEnd = (ship: NavalShip) => {
    if (troopMissions.channel.arrive(ship) || troopMissions.arrive(ship)) return;
    if (ship.dismantle) {
      ship.phase = "dismantling"; ship.speed = 0; ship.route = []; ship.cursor = 0; ship.timer = 0;
      return;
    }
    if (ship.visitor?.leaving) { finishVisitor(ship); return; }
    if (ship.ferryAt) { ferryArrived(ship); return; }
    // At the waiting spot: the ship lies there, asking every second whether the berth is free.
    if (ship.queuedAt) {
      ship.retryPhase = ship.phase === "positioning" ? "positioning" : undefined;
      ship.phase = "stranded"; ship.timer = 1; return;
    }
    if (ship.anchorage) { clearShipToIdle(ship); return; }
    if (ship.colony && ship.phase === "sailing") { departColony(ship); return; }
    const loading = ship.phase === "positioning";
    ship.phase = loading ? "loading" : "unloading";
    ship.handling = planHandling(context, ship, loading);
    ship.timer = ship.handling.seconds;
    if (loading ? !ship.visitor : landsAtHarbour(ship, accepting, harbor)) transfers.begin(ship);
  };
  const { coast, refreshTraffic, sailTick } = createShipHelm({
    arriveAtRouteEnd, context, makeWay: berthing.makeWay, obstacles, planner, routeEndpoint, sea
  });
  const { assignOrders, cancelTransport, canQueue, queueTransport, sendHomeward } = createNavalOrders({
    berthing, chooseUnload, hooks, orders, planner, ferrySpot: ferries.spot,
    releaseLoad: ship => { ferries.abandon(ship); transfers.release(ship); },
    remainingNeed: order => hooks?.remainingTransportNeed?.(order), ships, takeOrderId
  });
  const releaseHarbourReserves = (uid: number) =>
    releaseHarbourReservedCargo(harbor(uid), ships, clearShipToIdle);
  const shipOperations = createShipOperations(ships, orders, dock, planner, context);
  const troopMissions = createShipTroopMissions({ berthing, context, hooks, jetties: shuttles.jettyFrames, planner,
    sea, ships,
    releaseAtHarbour: (ship, uid) => parkAfterTroops(ship, uid, orders, berthing), releaseInPlace: clearShipToIdle });
  const saveState = (): NavalFleetSave => ({ ships, orders, nextShip, nextOrder, shuttles: shuttles.saveState() });
  const restore = (state: NavalFleetSave) => {
    sinking.clear();
    ships.splice(0, ships.length, ...state.ships); orders.splice(0, orders.length, ...state.orders);
    nextShip = state.nextShip; nextOrder = state.nextOrder; berths.clear();
    shuttles.restore(state.shuttles);
    troopMissions.restore();
    for (const ship of ships) renewRestoredShip(ship, context, sea, planner, berthing);
  };
  return { saveState, restore, addShip, addShipNearDock, dismantleShip, sinkShip,
    spawnDebugShip: (point: SettlementPoint) => spawnDebugShip(context.options.world, sea, planner,
      () => obstacles(undefined, true), addShip, point),
    /** A reward ship is still bound for harbour `uid` (its demolition waits). */
    rewardShipBound: (uid: number) => rewardShipBoundFor(ships, uid),
    bestHarbour: (pickup: readonly string[] = [], preferred?: number) =>
      bestHarbourFor(context, ships, orders, berths, pickup, preferred),
    canQueue, queueTransport, cancelTransport, releaseHarbourReserves,
    ...shipOperations,
    requestTroopPickup,
    pendingTroopPickups: () => [...new Set(ships.filter(ship => !ship.visitor?.leaving && !ship.passengers?.length)
      .flatMap(ship => ship.visitor?.pickupTroops ?? []))],
    releaseTroopPickups: (ids: readonly number[]) => {
      const released = new Set(ids);
      for (const ship of ships) if (ship.visitor?.pickupTroops && !ship.visitor.leaving)
        ship.visitor.pickupTroops = ship.visitor.pickupTroops.filter(uid => !released.has(uid));
    },
    sendHomeward,
    /** Player-controlled troop ships (MIL-SHIPS-SIM): commands, fleet hooks and read-only checks. */
    troopMissions,
    shipForPassenger: (uid: number) => ships.find(ship => ship.passengers?.includes(uid)),
    routeView: (id: number) => shipRouteView(ships, id),
    sendVisitor,
    /** The harbour's berths (one, or two where two ships lie side by side without touching). */
    harbourBerths: (uid: number) => harbor(uid) ? berths.forHarbour(uid, true) : [],
    /** Settlers rowing the harbours' lighters and nearby shuttles now (on duty in the population). */
    rowers: () => lighters.rowers() + shuttles.rowers(),
    /** Craft still included in this depot's roster, but physically owned by live water jobs. */
    localBoatClaims: (uid: number) => shuttles.claimedBoats(uid) + ships.reduce((sum, ship) =>
      sum + (ship.lighters?.harbourUid === uid ? ship.lighters.plan.lighters : 0), 0),
    /** Nearby harbour boat shuttle: status, saved jobs and render-only boat frames. */
    harbourShuttles: shuttles.snapshot,
    harbourShuttleStatus: shuttles.status,
    cancelHarbourShuttle: shuttles.cancel,
    shuttleFrames: shuttles.frames,
    shuttleJetties: shuttles.jettyFrames,
    removeHarbourShuttle: shuttles.removeHarbour,
    update: (dt: number) => {
      for (const [id, effect] of sinking) {
        effect.elapsed += dt;
        if (effect.elapsed >= SHIP_SINK_SECONDS) sinking.delete(id);
      }
      refreshTerrain();
      refreshTraffic(ships);
      assignOrders(dt);
      shuttles.update(dt);
      ships.forEach((ship) => updateShip(ship, dt));
      ferries.update();
      lighters.sweep();
      if (ships.some(ship => ship.gone)) ships.splice(0, ships.length, ...ships.filter(ship => !ship.gone));
    },
    seaExit: (uid: number) => {
      const start = dock(uid);
      return start ? seaExitAt(start) : null;
    },
    frames: (): ShipFrame[] => [
      ...ships.filter(ship => ship.phase !== "away").map(ship => {
        const deckHorse = troopMissions.horseOnDeck(ship);
        return deckHorse ? { ...shipFrame(ship), deckHorse } : shipFrame(ship);
      }),
      ...[...sinking.values()].map(effect => ({ ...effect.frame, sinkProgress: effect.elapsed / SHIP_SINK_SECONDS }))
    ],
    snapshot: () => ships.map((ship) => ({ ...shipSnapshot(context, ship), canSink: canSinkShip(ship, orders) })),
    /** The live ship records (read-only, no copy): the per-tick vision pass reads their positions. */
    liveShips: (): readonly NavalShip[] => ships,
    pending: () => orders.map((order) => ({ ...order, cargo: { ...order.cargo } })) };
};
