import { DMath } from "../math/deterministic-math";
import { MOORING_REACH } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import { reliefDepartureHullFits, reliefDepartureNavigation, routeWithReliefDeparture } from "./settlement-relief-departure";
import { avoidTraffic, type ShipTraffic } from "./settlement-ship-avoidance";
import {
  brakeKeepsHullsApart, moveKeepsClear, shipHullFitsSea, type ShipObstacle
} from "./settlement-ship-clearance";
import { changeSpeed, sailArc } from "./settlement-ship-kinematics";
import { createShipProgress } from "./settlement-ship-progress";
import type { createShipRoutePlanner, ShipDestination } from "./settlement-ship-routes";
import {
  advanceShipCursor, manoeuvreShip, remainingRouteLength, sailOrder, sailShip, type ShipMove
} from "./settlement-ship-steering";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** A ship this close to the end of its voyage is docking: it gives way to ships leaving or passing. */
const HARBOUR_APPROACH = 15;
/** A ship held up this long backs and turns its way clear of the ships around it (seconds). */
const JAMMED_SECONDS = 6;
/** Slower than this (tiles/s) a ship is creeping, not making way: it counts as held up. */
const MAKING_WAY = .1;
/** Legs that may end without moving the hull, handed over within one tick. */
const LEG_HAND_OVERS = 2;
/** A manoeuvre swinging slower than this (rad/s) on the oars is held up, not making way. */
const MAKING_SWING = .02;
const wrapAngle = (angle: number) => DMath.atan2(DMath.sin(angle), DMath.cos(angle));

const leavingTheMap = (ship: NavalShip) => Boolean(ship.visitor?.leaving || ship.colony);
const isStill = (ship: NavalShip, move: ShipMove) =>
  DMath.hypot(move.x - ship.x, move.z - ship.z) <= 1e-6 && Math.abs(wrapAngle(move.yaw - ship.yaw)) <= 1e-6;
/** On the last open-water leg, within mooring reach of a berth or anchorage (not the map edge). */
const mooringReach = (ship: NavalShip) => ship.cursor === ship.route.length - 1 && !leavingTheMap(ship) &&
  ship.route[ship.cursor]!.yaw === undefined && remainingRouteLength(ship, ship.route, ship.cursor) <= MOORING_REACH;

export interface ShipHelmOptions {
  /** The ship reached the end of its route (it starts loading, unloading or waiting). */
  arriveAtRouteEnd: (ship: NavalShip) => void;
  context: SettlementContext;
  makeWay: (ship: NavalShip, end: SettlementPoint | undefined) => void;
  obstacles: (ship?: NavalShip) => ShipObstacle[];
  planner: ReturnType<typeof createShipRoutePlanner>;
  /** Retain the destination's allowed berth approaches when a previously chosen heading is blocked. */
  routeEndpoint?: (ship: NavalShip, phase: "positioning" | "sailing") => ShipDestination | undefined;
  sea: Uint8Array;
}

/**
 * The helm of every ship under way: the safe move of each tick, giving way to traffic, braking,
 * and asking for room when held up. Created once per fleet.
 */
export const createShipHelm = ({ arriveAtRouteEnd, context, makeWay, obstacles, planner, routeEndpoint, sea }: ShipHelmOptions) => {
  /** Turning-clear water floats any heading; elsewhere the whole hull is tested. */
  const afloat = (pose: ShipObstacle, ship?: NavalShip) => {
    const { world } = context.options, x = Math.floor(pose.x), z = Math.floor(pose.z);
    const departure = ship && reliefDepartureNavigation(world, sea, ship);
    if (departure) return departure.hullFits(pose);
    const inside = x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ;
    return (inside && Boolean(planner.masks.turning[z * world.cellsX + x])) || shipHullFitsSea(world, sea, pose);
  };
  /** Ships under way and at rest as the others see them this tick (see settlement-ship-avoidance.ts). */
  let traffic = new Map<NavalShip, ShipTraffic>();
  /** The same entries as one reusable list; avoidTraffic skips its own entry by identity. */
  const trafficList: ShipTraffic[] = [];
  /** Seconds each ship under way has been held up without making way (transient helm memory). */
  const heldUp = new WeakMap<NavalShip, number>();
  const progresses = createShipProgress(JAMMED_SECONDS);
  const recovery = new WeakMap<NavalShip, { remaining: number; route: NavalShip["route"] }>();
  const toTraffic = (ship: NavalShip): ShipTraffic => {
    const underWay = ship.phase === "positioning" || ship.phase === "sailing";
    const leg = ship.route[ship.cursor];
    const inbound = underWay && !leavingTheMap(ship) &&
      remainingRouteLength(ship, ship.route, ship.cursor) < HARBOUR_APPROACH;
    return { inbound, restricted: !underWay || leg?.yaw !== undefined, speed: ship.speed ?? 0,
      stuck: heldUp.get(ship) ?? 0, x: ship.x, yaw: ship.yaw, z: ship.z };
  };
  /** Takes this tick's view of the ships in the water (before any ship moves). */
  const refreshTraffic = (ships: readonly NavalShip[]) => {
    traffic = new Map();
    trafficList.length = 0;
    for (const ship of ships) {
      if (ship.phase === "away") continue;
      const entry = toTraffic(ship);
      traffic.set(ship, entry);
      trafficList.push(entry);
    }
  };
  /** The helm's move for this tick: a manoeuvre leg sailed exactly, or the open-water course. */
  const helmMove = (ship: NavalShip, dt: number): ShipMove => {
    const motion = { speed: ship.speed ?? 0, x: ship.x, yaw: ship.yaw, z: ship.z };
    if (ship.route[ship.cursor]!.yaw !== undefined) return manoeuvreShip(motion, ship.route, ship.cursor, dt);
    ship.cursor = advanceShipCursor(motion, ship.route, ship.cursor);
    const own = traffic.get(ship) ?? toTraffic(ship);
    const planned = sailOrder(motion, ship.route, ship.cursor);
    // A proven jam follows its freshly collision-planned roomy route briefly. Soft look-ahead
    // must not keep steering it into the same loop; safeMove/braking still enforce every hull/shore check.
    const recovering = recovery.get(ship);
    const order = recovering?.route === ship.route && recovering.remaining > 0 ? planned :
      avoidTraffic(own, planned, { afloat: pose => afloat(pose, ship), traffic: trafficList });
    return sailShip(motion, ship.route, ship.cursor, order, dt);
  };
  /** Entering the pose must keep the hull afloat and clear of every other ship (backing off is allowed). */
  const moveAllowed = (ship: NavalShip, pose: ShipObstacle) => {
    const { world } = context.options;
    if (reliefDepartureHullFits(world, sea, ship, ship) && !afloat(pose, ship)) return false;
    return obstacles(ship).every(other => moveKeepsClear(ship, pose, other));
  };
  /**
   * The helm's move when it is safe. In open water, a turn that would swing the hull into a ship
   * close alongside is held off for the tick and the ship sails straight on along its keel instead.
   */
  const safeMove = (ship: NavalShip, move: ShipMove, dt: number): ShipMove | null => {
    if (moveAllowed(ship, move)) return move;
    if (ship.route[ship.cursor]?.yaw !== undefined || move.yaw === ship.yaw) return null;
    const straight = { ...sailArc(ship, move.speed * dt, 0), advance: 0, speed: move.speed };
    return moveAllowed(ship, straight) ? straight : null;
  };
  /**
   * The helm's safe move for this tick. A leg that ends without moving the hull (already settled on
   * its pose) hands the tick on to the next leg, so the ship never stalls for a tick between legs.
   * When no move is safe the hull brakes straight on along its keel if it can, else it stops.
   */
  const nextMove = (ship: NavalShip, dt: number) => {
    let move = safeMove(ship, helmMove(ship, dt), dt);
    for (let handOver = 0; handOver < LEG_HAND_OVERS && move?.advance && isStill(ship, move) &&
      ship.route[ship.cursor + move.advance]; handOver++) {
      ship.cursor += move.advance; ship.yaw = move.yaw;
      move = safeMove(ship, helmMove(ship, dt), dt);
    }
    return move ?? brakingMove(ship, dt);
  };
  /**
   * Braking on along the manoeuvre arc being sailed, else straight on along the keel; a ship cut off
   * at short notice may use up the rig clearance as it brakes, never touching hulls or the shore.
   */
  const brakingMove = (ship: NavalShip, dt: number,
    curvature = ship.route[ship.cursor]?.curvature ?? 0): ShipMove | null => {
    if (!ship.speed) return null;
    const speed = changeSpeed(ship.speed, 0, dt), distance = speed * dt;
    const move = { ...sailArc(ship, distance, curvature * distance), advance: 0, speed };
    if (moveAllowed(ship, move)) return move;
    if (reliefDepartureHullFits(context.options.world, sea, ship, ship) && !afloat(move, ship)) return null;
    return obstacles(ship).every(other => brakeKeepsHullsApart(ship, move, other)) ? move : null;
  };
  /** A ship that has stopped sailing glides on along its keel until its way is off. */
  const coast = (ship: NavalShip, dt: number) => {
    if (!ship.speed) return;
    const move = brakingMove(ship, dt, 0);
    if (!move) { ship.speed = 0; return; }
    ship.x = move.x; ship.z = move.z; ship.speed = move.speed;
  };
  /** A blocked ship asks idle ships in its way to make room, then looks for another way. */
  const waitBlocked = (ship: NavalShip) => {
    const end = routeEndpoint?.(ship, ship.phase === "positioning" ? "positioning" : "sailing") ?? ship.route.at(-1);
    makeWay(ship, end);
    const jammed = (heldUp.get(ship) ?? 0) >= JAMMED_SECONDS;
    const roomy = jammed && end && routeWithReliefDeparture(context.options.world, sea, ship, end, obstacles(ship), planner, true);
    const reroute = roomy || end && routeWithReliefDeparture(context.options.world, sea, ship, end, obstacles(ship), planner);
    if (reroute) {
      ship.route = reroute; ship.cursor = 0;
      if (roomy) recovery.set(ship, { remaining: JAMMED_SECONDS, route: reroute });
    }
    ship.timer = 2;
  };
  /** One tick under way: the helm's move when it is safe; otherwise the ship stops and waits. */
  const sailTick = (ship: NavalShip, dt: number) => {
    const recovering = recovery.get(ship);
    if (recovering) {
      if (recovering.route !== ship.route) recovery.delete(ship);
      else if (ship.route[ship.cursor]?.yaw === undefined) {
        // Manoeuvre legs already follow exact poses. Spend the grace only where soft open-water
        // anticipation is bypassed, and never carry it onto a different route or order.
        recovering.remaining -= dt;
        if (recovering.remaining <= 0) recovery.delete(ship);
      }
    }
    if (!ship.route[ship.cursor]) { arriveAtRouteEnd(ship); return; }
    const move = nextMove(ship, dt);
    const manoeuvring = ship.route[ship.cursor]?.yaw !== undefined;
    const moved = Boolean(move) &&
      (DMath.hypot(move!.x - ship.x, move!.z - ship.z) > 1e-4 || move!.yaw !== ship.yaw);
    // Creeping to and fro, or backing off to open the way, is not making way: only a manoeuvre's
    // slow legs or real way ahead count, so a ship that cannot get on asks for room and replans.
    const step = move ? DMath.hypot(move.x - ship.x, move.z - ship.z) : 0;
    const swing = move ? Math.abs(wrapAngle(move.yaw - ship.yaw)) : 0;
    const makingWay = progresses(ship, dt, manoeuvring ? undefined : ship.route[ship.cursor]) && moved && (manoeuvring
      ? step > MAKING_WAY * dt / 2 || swing > MAKING_SWING * dt : move!.speed > MAKING_WAY);
    if (move) {
      ship.x = move.x; ship.z = move.z; ship.yaw = move.yaw; ship.speed = move.speed;
      ship.cursor += move.advance;
      // Arrived: the ship glides on to a stop while it starts loading, unloading or waiting.
      if (!ship.route[ship.cursor]) { arriveAtRouteEnd(ship); return; }
    } else ship.speed = 0;
    heldUp.set(ship, makingWay ? 0 : (heldUp.get(ship) ?? 0) + dt);
    if (makingWay) { ship.timer = 2; return; }
    // Held up just short of its berth or anchorage, the ship moors where it lies.
    if (mooringReach(ship)) { arriveAtRouteEnd(ship); return; }
    ship.timer -= dt;
    if (ship.timer > 0) return;
    // Bound for a waiting spot, a held-up ship waits where it lies: from there it asks for the berth every
    // second (it may be free by now) instead of trying for good to reach a spot it only waits at.
    if (ship.queuedAt) { arriveAtRouteEnd(ship); return; }
    waitBlocked(ship);
  };
  return { coast, refreshTraffic, sailTick };
};
