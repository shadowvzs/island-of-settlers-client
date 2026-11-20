import type { ShipFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { createHarbourBerths } from "./settlement-harbour-berths";
import type { NavalShip } from "./settlement-naval-fleet";
import { createNavalTerrainRefresh } from "./settlement-naval-terrain";
import { isCollectingTradeShip, isTradeShip, tradePierTurn } from "./settlement-naval-trade";
import { routeWithReliefDeparture } from "./settlement-relief-departure";
import {
  ANCHORAGE_SPACING, findShipAnchorage, sampleShipLane, type ShipApproach
} from "./settlement-ship-anchorage";
import { createShipOverlapTest, type ShipObstacle, shipsOverlap } from "./settlement-ship-clearance";
import type { createShipRoutePlanner, ShipDestination, ShipRoutePoint } from "./settlement-ship-routes";
import { createStaticSeaExitLookup } from "./settlement-static-sea-exit";
import type { Goods, SettlementContext, SettlementPoint } from "./settlement-types";
import { troopMissionWater } from "./ship-troop-mission";

/** A ship hemmed in this close to its berth or anchorage moors where it lies (tiles). */
export const MOORING_REACH = 3;
/** A ship bound for the neighbouring berth holds up one casting off only once it is this close (tiles). */
const CASTING_OFF_REACH = 24;
/** Waiting spots a ship plans a way to before it gives up for this tick (each is a route search). */
const ANCHORAGE_ROUTE_TRIES = 4;

/** A leaving visitor sails off the map. */
const visitorEndpoint = (ship: NavalShip): ShipDestination | undefined =>
  ship.visitor?.leaving ? ship.visitor.relief?.tail?.target ?? ship.visitor.exit : undefined;
/** Lying still until a berth is free: at a waiting spot, or wherever it was held up on its way to load. */
const waitsForBerth = (ship: NavalShip) => ship.phase === "stranded" && !ship.terrainBlocked &&
  (ship.queuedAt !== undefined || ship.retryPhase === "positioning");
/**
 * Lies still with nothing to do here: an idle own ship, or a loaded troop ship waiting off a harbour with no
 * order (2026-11-17). Both step aside for a ship whose way they block.
 */
const waitsWithTroops = (ship: NavalShip) => ship.phase === "loading" &&
  ship.troopMission?.waitingOff !== undefined && !ship.troopMission.target && !ship.troopMission.boarding.length;
/** A loaded troop ship at a harbour berth, boarding done, with no order: it gives the berth up when asked. */
const holdsTroopsAtBerth = (ship: NavalShip) => ship.phase === "loading" &&
  ship.troopMission?.harbourUid !== undefined && !ship.troopMission.target && !ship.troopMission.anchor &&
  !ship.troopMission.boarding.length && Boolean(ship.passengers?.length);
export const liesAside = (ship: NavalShip) => (ship.phase === "idle" && !ship.visitor) || waitsWithTroops(ship);
/** The harbour a ship is bound for: idle ships make room off it. */
const boundFor = (ship: NavalShip) => {
  const loading = ship.phase === "positioning" || ship.retryPhase === "positioning";
  return loading ? ship.sourceUid : ship.destinationUid ?? ship.sourceUid;
};

export interface FleetBerthingOptions {
  construction: () => readonly ShipObstacle[];
  context: SettlementContext;
  planner: ReturnType<typeof createShipRoutePlanner>;
  sea: Uint8Array;
  ships: NavalShip[];
}

/**
 * Where the fleet's ships lie and wait: harbour berths, waiting spots (anchorages) off the
 * approaches, the hulls other ships keep clear of, and idle ships making way. Created once per fleet.
 */
export const createFleetBerthing = ({ construction, context, planner, sea, ships }: FleetBerthingOptions) => {
  const staticSeaExit = createStaticSeaExitLookup(context.options.world, () => planner.masks.turning);
  const seaExitAt = (point: SettlementPoint & { yaw?: number },
    accepts?: (point: SettlementPoint) => boolean) => {
    const offshore = planner.offshore({ ...point, yaw: point.yaw ?? 0 });
    return offshore && staticSeaExit(offshore, accepts);
  };
  /** Harbour berths (one or two per harbour): the water beside the pier and the heading the hull lies on. */
  const berths = createHarbourBerths(context, sea, planner);
  const requesting = new Set<NavalShip>();
  /** How a loaded troop ship waiting off a harbour makes way (installed by the troop missions). */
  let troopShipYield: ((ship: NavalShip, ways: readonly ShipApproach[]) => void) | undefined;
  /** Where an idle ship goes with no waiting spot free: open water, else out of the channel (owner, 2026-11-17). */
  let channelYield: ((ship: NavalShip, harbourUid: number, ways: readonly ShipApproach[]) => void) | undefined;
  /**
   * Hulls in the water (and ship construction sites); with `reserved`, also the berths and
   * anchorages other ships are bound for, which berth choices keep clear of.
   */
  const obstacles = (ship?: NavalShip, reserved = false) => {

    const held: ShipObstacle[] = [...construction()];
    for (const other of ships) {
      if (other === ship || other.phase === "away") continue;
      held.push(other);
      if (!reserved) continue;
      const end = other.route.at(-1), previous = other.route.at(-2) ?? other;
      if (!end || !["positioning", "sailing"].includes(other.phase)) continue;
      const berth = { ...end, yaw: end.yaw ?? DMath.atan2(end.x - previous.x, end.z - previous.z) };
      // A reservation the asking ship already lies on cannot be kept clear: its own way out matters.
      if (!ship || !shipsOverlap(ship, berth)) held.push(berth);
    }
    return held;
  };
  const harbor = (uid: number) =>
    context.buildings.find((b) => b.uid === uid && b.typeId === 39 && b.construction === 1);
  /**
   * A harbour's berth: without `ship` its first one; for a ship the berth it is bound for or lies at,
   * else a free one. Undefined while every berth is taken (an idle ship lying at one makes room).
   */
  const dock = (uid: number, ship?: NavalShip) => {
    refreshTerrain();
    if (!harbor(uid)) { berths.forget(uid); return undefined; }
    let known = berths.forHarbour(uid);
    if (!ship) return known[0];
    // A cold restore initially knows only the first berth. Validate an existing second-berth
    // reservation before queue gating; its ship was already admitted before this queue formed.
    if (["positioning", "sailing"].includes(ship.phase) && ship.route.length &&
      !known.some(berth => holdsBerth(ship, berth))) known = berths.forHarbour(uid, true);
    const held = known.find(berth => holdsBerth(ship, berth));
    if (held) return held;
    // Trade ships come to the pier one at a time, in queue order; the others wait offshore.
    if (!tradePierTurn(ships, ship, uid)) return undefined;
    if (behindQueue(uid, ship)) return undefined;
    const freeIn = (list: readonly ShipDestination[]) => list.find(berth => !berthHolder(berth, ship));
    // Otherwise the second berth is looked for only once the first one is taken.
    const all = freeIn(known) ? known : berths.forHarbour(uid, true), free = freeIn(all);
    // Side by side berths are worked one manoeuvre at a time: no ship comes in while another one
    // is coming in to or getting out of its neighbour.
    if (free && (all.length === 1 || !manoeuvringAt(all, ship))) return free;
    if (free) return undefined;
    const holders = all.map(berth => berthHolder(berth, ship));
    const idle = holders.find(holder => holder?.phase === "idle" && !holder.visitor);
    if (idle) stepAside(idle, uid, []);
    // A loaded troop ship lying at the berth with nothing to do leaves it too (where the bay has room).
    const troops = holders.find(holder => holder && holdsTroopsAtBerth(holder));
    if (troops) troopShipYield?.(troops, []);
    return undefined;
  };
  /** Another ship under way to one of the berths, or still close to one on its way out. */
  const manoeuvringAt = (all: readonly ShipDestination[], ship: NavalShip, reach = Infinity) =>
    ships.some(other => {
      if (other === ship || (other.phase !== "positioning" && other.phase !== "sailing")) return false;
      return all.some(berth => {
        const distance = DMath.hypot(other.x - berth.x, other.z - berth.z);
        return distance < ANCHORAGE_SPACING || (holdsBerth(other, berth) && distance < reach);
      });
    });
  /**
   * A ship lying at one of two side by side berths casts off only while no ship works the other one;
   * a ship still far off on its way in to it does not hold it up.
   */
  const neighbourManoeuvring = (ship: NavalShip) => {
    const uid = ship.phase === "loading" ? ship.sourceUid : ship.destinationUid;
    const all = uid !== undefined && harbor(uid) ? berths.forHarbour(uid) : [];
    return all.length > 1 && all.some(berth => holdsBerth(ship, berth)) &&
      manoeuvringAt(all, ship, CASTING_OFF_REACH);
  };
  /** The ship is bound for the berth, or lies at it. */
  const holdsBerth = (ship: NavalShip, berth: SettlementPoint) => {
    const end = ship.route.at(-1), underWay = ship.phase === "positioning" || ship.phase === "sailing";
    if (underWay) return Boolean(end) && DMath.hypot(end!.x - berth.x, end!.z - berth.z) < 1;
    return DMath.hypot(ship.x - berth.x, ship.z - berth.z) < MOORING_REACH;
  };
  /** Another ship lying at (or bound for) the berth. */
  const berthHolder = (berth: ShipDestination, ship: NavalShip) => {
    const pose = { ...berth, yaw: berth.yaw ?? 0 };
    return ships.find(other => other !== ship && other.phase !== "away" && (shipsOverlap(pose, other) ||
      (["positioning", "sailing"].includes(other.phase) && other.route.length > 0 &&
        DMath.hypot(other.route.at(-1)!.x - berth.x, other.route.at(-1)!.z - berth.z) < 1)));
  };
  /** The ships holding the harbour's berths (other than `ship`); undefined where a berth is free. */
  const berthHolders = (uid: number, ship: NavalShip) =>
    berths.forHarbour(uid, true).map(berth => berthHolder(berth, ship));
  /**
   * An idle own ship lies at one of the harbour's berths (and is asked to make room), or is still close
   * to it under way to a waiting spot.
   */
  const clearingBerth = (uid: number, ship: NavalShip) => berths.forHarbour(uid).some(berth => {
    const holder = berthHolder(berth, ship);
    if (!holder || holder.visitor) return false;
    return holder.phase === "idle" || (holder.phase === "sailing" && holder.anchorage !== undefined);
  });
  /**
   * The harbour's berth is taken: the ship sails to a waiting spot off the approaches and lies there
   * (retrying) until the berth is free. False when it already waits there or no spot is free.
   */
  const waitForBerth = (ship: NavalShip, uid: number) => {
    // Only the first ship in the queue waits off the harbour; the others wait at the map edge.
    const atEdge = queuedNear(uid, ship) !== undefined;
    const waiting = ship.queuedAt && Boolean(ship.waitsAtEdge) === atEdge &&
      DMath.hypot(ship.queuedAt.x - ship.x, ship.queuedAt.z - ship.z) < MOORING_REACH;
    const spot = !waiting && (anchorage(uid, ship, [], true, atEdge) ||
      anchorage(uid, ship, [], true, atEdge, true));
    if (spot && route(ship, spot, "sailing")) { queueAt(ship, spot, atEdge); return true; }
    // A loaded hull may still occupy its departure berth while its destination is queued.
    // Like idle/queued yielding ships, it asks neighbours to clear a geometrically safe spot
    // even when no route to that spot is free yet; otherwise both harbours can hold each other.
    const blocked = !waiting && (spot || anchorage(uid, ship, [], false, atEdge) ||
      anchorage(uid, ship, [], false, atEdge, true));
    if (blocked) makeWay(ship, blocked, uid);
    ship.phase = "stranded"; ship.timer = 1; return false;
  };
  /** The ship waits for a berth at `spot`: off the harbour, or (behind the first one) at the map edge. */
  const queueAt = (ship: NavalShip, spot: SettlementPoint, atEdge: boolean) => {
    ship.queuedAt = spot;
    ship.waitsAtEdge = atEdge || undefined;
  };
  /** The ship heads for its berth: it no longer waits in the queue. */
  const leaveQueue = (ship: NavalShip) => { ship.queuedAt = undefined; ship.waitsAtEdge = undefined; };
  /**
   * The ship waiting off the harbour is first in the queue: `ship` (not waiting there itself) comes in after
   * it. Among trade ships their queue numbers decide (`tradePierTurn`).
   */
  const behindQueue = (uid: number, ship: NavalShip) => {
    if (ship.queuedAt && !ship.waitsAtEdge) return false;
    const first = queuedNear(uid, ship);
    // A trade ship waiting for its payment lets every ship pass.
    return first !== undefined && !isCollectingTradeShip(first) && !(isTradeShip(first) && isTradeShip(ship));
  };
  /** The ship (other than `ship`) waiting off harbour `uid` for a berth: the first in its queue. */
  const queuedNear = (uid: number, ship?: NavalShip) => ships.find(other => other !== ship &&
    other.queuedAt !== undefined && !other.waitsAtEdge && !other.terrainBlocked && !other.visitor?.leaving &&
    boundFor(other) === uid);
  /**
   * Trade and reward ships bring committed arrivals: every finished harbour takes them (storage settings aside), so
   * a reward never strands at sea (plan item 35).
   */
  const accepting = (uid: number, cargo: Goods, ship?: NavalShip) => {
    const building = harbor(uid);
    if (building && ship && (isTradeShip(ship) || ship.visitor?.role === "reward")) return building;
    return building && Object.keys(cargo).every((ware) => building.accepts[ware] !== false || context.storagePools?.pools.find(pool =>
      pool.id === building.storagePoolId)?.collect?.includes(ware));
  };
  const route = (ship: NavalShip, destination: ShipDestination, phase: ShipFrame["phase"]) => {
    const held = obstacles(ship);
    // Stranded ships never reach the sailing helm's jam recovery. Give them its same backed
    // manoeuvre escape when the ordinary departure cannot clear the hulls around them.
    const path = routeWithReliefDeparture(context.options.world, sea, ship, destination, held, planner) ||
      (ship.phase === "stranded" && routeWithReliefDeparture(context.options.world, sea, ship, destination, held, planner, true));
    if (!path) return false;
    // A fresh course starts with the helm's grace for getting under way (a ship leaving a berth from rest is
    // not yet "held up": it would otherwise count as lying at its waiting spot on its first tick).
    ship.route = path; ship.cursor = 0; ship.phase = phase; ship.retryPhase = undefined; ship.timer = 2;
    ship.terrainBlocked = undefined; return true;
  };
  /**
   * The water another ship will sail through next: the rest of its voyage, its way out to sea from
   * where it loads or unloads, or (waiting) its way to the berth. An idle ship is going nowhere.
   */
  const shipWay = (other: NavalShip, berth: SettlementPoint, exit: SettlementPoint): readonly ShipRoutePoint[] => {
    if (other.phase === "positioning" || other.phase === "sailing") return other.route.slice(other.cursor);
    if (other.phase === "idle") return [];
    const busy = other.phase === "loading" || other.phase === "unloading";
    return planner.route(other, busy ? exit : berth) ?? [];
  };
  /** The water every other ship in the water sails through next near harbour `uid` (waiting spots keep off it). */
  const trafficWays = (uid: number, ship: NavalShip): ShipApproach[] => {
    const berth = berths.forHarbour(uid)[0], exit = berth && seaExitAt(berth);
    if (!berth || !exit) return [];
    return ships.filter(other => other !== ship && other.phase !== "away")
      .map(other => ({ from: other as SettlementPoint, path: shipWay(other, berth, exit) }));
  };
  /** Visitors still beyond the map edge that will sail in (a waiting spot keeps clear of their entry). */
  const arrivingVisitors = (ship?: NavalShip) => ships.filter(other =>
    other !== ship && other.phase === "away" && other.visitor !== undefined && !other.visitor.leaving);
  /** The ways in of the visitors bound for harbour `uid`: from their entry at the map edge to each berth. */
  const visitorWaysIn = (visitors: readonly NavalShip[], uid: number, all: readonly ShipDestination[]) =>
    visitors.filter(visitor => visitor.destinationUid === uid).flatMap(visitor => {
      const entry = visitor.visitor!.exit;
      return all.map(each => ({ from: entry, path: planner.route({ ...entry, yaw: 0 }, each) ?? [] }));
    });
  /**
   * The open-water ways in and out of a harbour's berths: the approach and departure lane of every
   * berth, for a boat service that must keep out of sea-ship channels (BOAT-P01).
   */
  const lanesFor = (uid: number): readonly (readonly ShipRoutePoint[])[] => {
    const all = berths.forHarbour(uid, true), exit = all[0] && seaExitAt(all[0]);
    if (!exit) return [];
    return all.flatMap(each => {
      const out = planner.route({ ...each, yaw: each.yaw ?? 0 }, exit);
      const back = planner.route({ ...exit, yaw: 0 }, each);
      return [out, back].flatMap(path => path ? [path] : []);
    });
  };
  /**
   * Open water near the harbour (`atEdge`: near the map edge where ships leave from it) where `ship` (or a
   * new ship) can wait clear of every approach.
   */
  const anchorage = (
    uid: number, ship?: NavalShip, ways: readonly ShipApproach[] = [], mustReach = true, atEdge = false, overflow = false
  ) => {
    const all = berths.forHarbour(uid), berth = all[0], exit = berth && seaExitAt(berth);
    if (!berth || !exit) return null;
    // Every berth's ways out to sea and in from it (ships berth bow first, so these differ in tight water).
    const lanes = all.flatMap(each => {
      const lane = planner.route({ ...each, yaw: each.yaw ?? 0 }, exit);
      const inbound = planner.route({ ...exit, yaw: 0 }, each) ?? [];
      return lane ? [{ from: each, path: lane }, { from: exit, path: inbound }] : [];
    });
    if (!lanes.length) return null;
    const others = ships.filter(other => other !== ship && other.phase !== "away");
    const visitors = arrivingVisitors(ship), entries = visitors.map(other => other.visitor!.exit);
    const approaches = [...lanes, ...others.map(other =>
      ({ from: other as SettlementPoint, path: shipWay(other, berth, exit) })),
    ...visitorWaysIn(visitors, uid, all), ...ways];
    // The berth itself may be busy; the spot only needs a way to it once it is free. Waiting ships
    // lie in turning-clear water, so they can always swing and sail off without manoeuvring. The
    // ship itself must get there past the others (a few spots are tried, nearest first).
    let tries = 0;
    // A stranded hull may need that same escape before it can reach any waiting spot.
    const reachable = (point: ShipDestination) => !ship || !mustReach || (tries++ < ANCHORAGE_ROUTE_TRIES &&
      Boolean(planner.route(ship, point, obstacles(ship)) ||
        (ship.phase === "stranded" && planner.route(ship, point, obstacles(ship), true))));
    return findShipAnchorage(all, approaches, [...obstacles(ship, true), ...entries], { overlaps: createShipOverlapTest(),
      usable: reachable, waterClear: point => planner.connected(point, exit) }, atEdge ? exit : berth, overflow);
  };
  /**
   * An empty ship back from a colony voyage waits off the harbour instead of docking: a returning
   * ship must never sit on the berth (or the lane to it) that the next load needs.
   */
  const returnToAnchorage = (ship: NavalShip) => {
    const spot = ship.sourceUid === undefined ? null : anchorage(ship.sourceUid, ship);
    if (!spot || !route(ship, spot, "sailing")) return false;
    ship.anchorage = spot;
    return true;
  };
  /** A ship beyond the map edge waits there while another ship holds or heads for the way in. */
  const entryClear = (ship: NavalShip, entry: SettlementPoint) => obstacles(ship, true).every(other =>
    DMath.hypot(other.x - entry.x, other.z - entry.z) >= ANCHORAGE_SPACING);
  /** An idle ship in the way of a ship bound for `harbourUid` moves to another waiting spot. */
  const stepAside = (idle: NavalShip, harbourUid: number, ways: readonly ShipApproach[], askOthers = true) => {
    if (waitsWithTroops(idle)) { troopShipYield?.(idle, ways); return; }
    const spot = anchorage(harbourUid, idle, ways) ?? anchorage(harbourUid, idle, ways, true, false, true);
    if (spot && route(idle, spot, "sailing")) { idle.anchorage = spot; return; }
    // Hemmed in by other ships that have nothing to do: they make room first (once, no chain).
    const blocked = anchorage(harbourUid, idle, ways, false) ?? anchorage(harbourUid, idle, ways, false, false, true);
    if (blocked && askOthers) makeWay(idle, blocked, harbourUid, false);
    // No waiting spot at all (a narrow channel): open water, or out of the channel while the other ship passes.
    else if (!blocked) channelYield?.(idle, harbourUid, ways);
  };
  /** A ship waiting for a berth that lies in another ship's way moves to another waiting spot off that harbour. */
  const shiftQueue = (queued: NavalShip, ways: readonly ShipApproach[], askOthers = true) => {
    const positioning = queued.phase === "positioning" || queued.retryPhase === "positioning";
    const uid = (positioning ? queued.sourceUid : queued.destinationUid)!;
    const atEdge = queued.queuedAt ? Boolean(queued.waitsAtEdge) : queuedNear(uid, queued) !== undefined;
    const spot = anchorage(uid, queued, ways, true, atEdge) ?? anchorage(uid, queued, ways, true, atEdge, true);
    if (spot && route(queued, spot, positioning ? "positioning" : "sailing")) { queueAt(queued, spot, atEdge); return; }
    // A queued hull can be hemmed in just like an idle hull. Neighbours yield once, without a chain.
    const blocked = askOthers && (anchorage(uid, queued, ways, false, atEdge) ??
      anchorage(uid, queued, ways, false, atEdge, true));
    if (blocked) makeWay(queued, blocked, uid, false);
  };
  /**
   * Idle/waiting hulls make room off the requested lane. An incoming approach also backs off a
   * loaded departure beside the same pier, retaining its loading intent and joining the queue.
   */
  const anchorageHarbour = (ship: NavalShip) => {
    if (!ship.anchorage) return undefined;
    // Idle hulls ordered aside have no cargo endpoints. Their saved anchorage still identifies
    // a harbour neighbourhood, so they can ask its idle neighbours to yield after a reload too.
    return context.buildings.filter(building => building.typeId === 39 && building.construction === 1)
      .sort((a, b) => DMath.hypot(a.x - ship.x, a.z - ship.z) -
        DMath.hypot(b.x - ship.x, b.z - ship.z))[0]?.uid;
  };
  /** An admitted approach backs off when it blocks a loaded neighbour casting off that same pier. */
  const incomingObstructsDeparture = (departing: NavalShip, incoming: NavalShip) => {
    if (!["positioning", "sailing"].includes(incoming.phase) || departing.sourceUid === undefined ||
      boundFor(incoming) !== departing.sourceUid || departing.phase === "positioning" ||
      departing.phase === "loading" || departing.retryPhase === "positioning" ||
      !Object.values(departing.cargo).some(count => count > 0)) return false;
    const all = berths.forHarbour(departing.sourceUid, true);
    return all.some(berth => DMath.hypot(departing.x - berth.x, departing.z - berth.z) < CASTING_OFF_REACH) &&
      all.some(berth => holdsBerth(incoming, berth) &&
        DMath.hypot(incoming.x - berth.x, incoming.z - berth.z) < CASTING_OFF_REACH);
  };
  const clearWay = (ship: NavalShip, end: SettlementPoint | undefined,
    harbourUid = boundFor(ship) ?? anchorageHarbour(ship), chain = true) => {
    // A lane through a loaded neighbour cannot be cleared by a yield request. Plan around
    // fixed hulls/construction first, omitting only the idle/queued ships this request may move.
    const yielding = new Set(ships.filter(other => !requesting.has(other) &&
      (liesAside(other) || waitsForBerth(other) || incomingObstructsDeparture(ship, other))));
    const held = obstacles(ship).filter(other => !yielding.has(other as NavalShip));
    const path = end && harbourUid !== undefined && (routeWithReliefDeparture(context.options.world, sea, ship, end, held, planner) ||
      routeWithReliefDeparture(context.options.world, sea, ship, end, held, planner, true) ||
      routeWithReliefDeparture(context.options.world, sea, ship, end, [], planner));
    if (!path) return;
    const ways = [{ from: ship as SettlementPoint, path }], samples = sampleShipLane(ship, path);
    for (const other of ships) {
      const idle = liesAside(other);
      if (requesting.has(other) || (!idle && !waitsForBerth(other) && !incomingObstructsDeparture(ship, other))) continue;
      if (!samples.some(sample => shipsOverlap(sample, other))) continue;
      if (idle) stepAside(other, harbourUid!, ways, chain);
      else shiftQueue(other, ways, chain);
    }
  };
  const makeWay = (ship: NavalShip, end: SettlementPoint | undefined, harbourUid?: number, chain = true) => {
    // A neighbour's one-level yield must never retarget an ancestor while its caller is still
    // deciding whether it is loading or unloading. This stack is synchronous, not saved state.
    if (requesting.has(ship)) return;
    requesting.add(ship);
    try { clearWay(ship, end, harbourUid, chain); }
    finally { requesting.delete(ship); }
  };
  /** The ship heads for a berth of harbour `uid`; idle and waiting ships lying on its way make room first. */
  const routeToBerth = (ship: NavalShip, berth: ShipDestination, phase: "positioning" | "sailing", uid: number) => {
    makeWay(ship, berth, uid);
    return route(ship, berth, phase);
  };
  /** Where an exploring ship sails next (none once it is returning). */
  const explorationPoint = (ship: NavalShip) => ship.exploration && !ship.exploration.returning
    ? ship.exploration.points[ship.exploration.cursor] : undefined;
  const routeEndpoint = (ship: NavalShip, phase: "positioning" | "sailing") => {
    if (phase === "positioning") return ship.ferryAt ?? ship.queuedAt ?? dock(ship.sourceUid!, ship);
    return ship.ferryAt ?? ship.anchorage ?? ship.queuedAt ?? visitorEndpoint(ship) ?? ship.colony?.exit ??
      ship.expedition?.water ?? explorationPoint(ship) ?? troopMissionWater(ship) ?? dock(ship.destinationUid!, ship);
  };
  const refreshTerrain = createNavalTerrainRefresh(context.options.world, sea, {
    ships, docks: berths, planner, endpoint: routeEndpoint, route
  });
  return {
    /** Installs how waiting troop ships make way (they hold soldiers, so the missions decide where). */
    setTroopShipYield: (handler: (ship: NavalShip, ways: readonly ShipApproach[]) => void) => {
      troopShipYield = handler;
    },
    /** Installs where idle ships go when their harbour has no waiting spot free. */
    setChannelYield: (handler: (ship: NavalShip, harbourUid: number, ways: readonly ShipApproach[]) => void) => {
      channelYield = handler;
    },
    accepting, anchorage, berthHolders, berths, clearingBerth, dock, entryClear, harbor, lanesFor, leaveQueue, makeWay,
    neighbourManoeuvring, obstacles, queueAt, queuedNear, refreshTerrain, returnToAnchorage, route, routeEndpoint,
    routeToBerth, seaExitAt, trafficWays, waitForBerth
  };
};

export type FleetBerthing = ReturnType<typeof createFleetBerthing>;
