import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { DMath } from "../math/deterministic-math";
import {
  arcTo, brakingSpeed, changeSpeed, OAR_TURN_RATE, sailArc, SHIP_ACCELERATION, SHIP_DECELERATION,
  SHIP_MANOEUVRE_SPEED, SHIP_SPEED,   type ShipMotion, type ShipPose,
shipTurnRate, swingAbout} from "./settlement-ship-kinematics";
import type { ShipRoutePoint } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

export { SHIP_TURN_RATE } from "./settlement-ship-kinematics";

/**
 * The helm: follows a route the way a helmsman would. Open-water legs are sailed by pure pursuit of
 * a point ahead on the course (further ahead the faster the ship goes), slowing for bends and
 * braking to stop on the route end. Manoeuvre legs (`yaw` set) are sailed exactly: an arc ahead or
 * astern, or a slow swing round a keel point.
 */
/**
 * Target speed (astern < 0) and the heading to steer for; without one the helm is held amidships.
 * `stop`: distance left to the end of the voyage, where the ship must have stopped.
 */
export interface HelmOrder { heading?: number; speed: number; stop?: number }
/** The hull after one tick, and how many route points it has passed. */
export interface ShipMove extends ShipMotion { advance: number }

/** Pure-pursuit distance at rest, and its growth per tile/s of speed. */
const LOOKAHEAD = 2.5;
const LOOKAHEAD_PER_SPEED = 2.5;
/** How far beyond the pursuit point the helmsman watches for the next bend. */
const BEND_PREVIEW = 5;
/** Rate of turn ordered per radian of heading error (1/s), before the hull's own limit. */
const HEADING_GAIN = 1.2;
/** Bow within this angle of the course: full sail. */
const ALIGNED = .35;
/** Slowest steerage way while the bow comes round a sharp bend (tiles/s). */
const CRAWL = .2;
/** Last stretch to a stop: the hull holds its heading and only brakes. */
const HOLD_COURSE = 1.5;
/** A course point counts as passed this close (scaled by the pursuit distance). */
const PASSING_SHARE = .6;
/** Stop reached: the remaining keel distance is negligible, or the hull has all but stopped on it. */
const ARRIVED = .02;
const SETTLED_SPEED = .03;
/** Settling onto a point: an arc when it lies this close to the keel line (radians), else a swing first. */
const SETTLE_ARC = .5;
/** Settled on the point (tiles). */
const SETTLED = .02;
/** A settle point closer than this (tiles) is faced fully before the ship comes onto it. */
const SHORT_SETTLE = 1;
/** Easing a grounded hull (old saves, terrain edits) out, holding its heading (tiles/s). */
const DRIFT_SPEED = .3;
/** Heading error (radians) a finished manoeuvre leg takes up. */
const SETTLE_YAW = .02;

const distanceBetween = (a: SettlementPoint, b: SettlementPoint) => DMath.hypot(b.x - a.x, b.z - a.z);
const isManoeuvre = (point: ShipRoutePoint) => point.yaw !== undefined;

/** The course point `distance` along the remaining open-water route; the last point when shorter. */
const pointAhead = (ship: SettlementPoint, route: readonly ShipRoutePoint[], cursor: number, distance: number) => {
  let previous: SettlementPoint = ship, left = distance;
  for (let index = cursor; index < route.length; index++) {
    const point = route[index]!;
    if (isManoeuvre(point)) return previous;
    const length = distanceBetween(previous, point);
    if (length >= left) {
      const share = left / length;
      return { x: previous.x + (point.x - previous.x) * share, z: previous.z + (point.z - previous.z) * share };
    }
    left -= length; previous = point;
  }
  return previous;
};

/** Where the open-water run from `cursor` stops: the route end, or the point a manoeuvre starts from. */
const stopIndex = (route: readonly ShipRoutePoint[], cursor: number) => {
  let index = cursor;
  while (index < route.length - 1 && !isManoeuvre(route[index + 1]!)) index++;
  return index;
};

/** Distance left along the open-water run from the ship to where it stops. */
export const remainingRouteLength = (ship: SettlementPoint, route: readonly ShipRoutePoint[], cursor: number) => {
  let total = 0, previous: SettlementPoint = ship;
  for (let index = cursor, stop = stopIndex(route, cursor); index <= stop && index < route.length; index++) {
    total += distanceBetween(previous, route[index]!); previous = route[index]!;
  }
  return total;
};

/** Heading towards a point, or the current heading when the point is (almost) the ship itself. */
const headingTo = (ship: ShipPose, point: SettlementPoint) =>
  distanceBetween(ship, point) <= 1e-6 ? ship.yaw : DMath.atan2(point.x - ship.x, point.z - ship.z);

/** Share of full sail with the bow `offset` radians off the course: full when aligned, a crawl at 90°. */
export const shipSailFactor = (offset: number) => {
  const error = Math.abs(wrapAngle(offset));
  if (error <= ALIGNED) return 1;
  return Math.max(CRAWL / SHIP_SPEED, (Math.PI / 2 - error) / (Math.PI / 2 - ALIGNED));
};

/** Heading the helmsman steers for: the pursuit point on the course, or a manoeuvre's own heading. */
export const desiredShipHeading = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number) => {
  const target = route[cursor];
  if (!target) return ship.yaw;
  if (target.yaw !== undefined) return target.yaw;
  return headingTo(ship, pointAhead(ship, route, cursor, LOOKAHEAD + LOOKAHEAD_PER_SPEED * Math.abs(ship.speed)));
};

/** Heading of the first leg, so ships that appear at the map edge already face their course. */
export const initialRouteHeading = (ship: ShipMotion, route: readonly ShipRoutePoint[]) =>
  desiredShipHeading(ship, route, 0);

/** First course point not yet passed: close points are passed once the pursuit point is beyond them. */
export const advanceShipCursor = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number) => {
  const passing = (LOOKAHEAD + LOOKAHEAD_PER_SPEED * Math.abs(ship.speed)) * PASSING_SHARE;
  let next = cursor;
  while (next < route.length - 1 && !isManoeuvre(route[next]!) && !isManoeuvre(route[next + 1]!) &&
    distanceBetween(ship, route[next]!) <= passing) next++;
  return next;
};

/** What the helmsman orders on an open-water leg: target speed and rate of turn. */
export const sailOrder = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number): HelmOrder => {
  const lookahead = LOOKAHEAD + LOOKAHEAD_PER_SPEED * Math.abs(ship.speed);
  const heading = headingTo(ship, pointAhead(ship, route, cursor, lookahead));
  const bend = wrapAngle(headingTo(ship, pointAhead(ship, route, cursor, lookahead + BEND_PREVIEW)) - ship.yaw);
  const remaining = remainingRouteLength(ship, route, cursor);
  const speed = Math.min(SHIP_SPEED * shipSailFactor(heading - ship.yaw), SHIP_SPEED * shipSailFactor(bend * .7),
    brakingSpeed(remaining));
  return remaining < HOLD_COURSE ? { speed, stop: remaining } : { heading, speed, stop: remaining };
};

/** Sails one tick under `order`: speed changes at bounded acceleration, the bow at its rate limit. */
export const executeSailOrder = (ship: ShipMotion, order: HelmOrder, dt: number): ShipMotion => {
  const speed = changeSpeed(ship.speed, order.speed, dt), limit = shipTurnRate(speed);
  const wanted = order.heading === undefined ? 0 : wrapAngle(order.heading - ship.yaw) * HEADING_GAIN;
  const turn = Math.max(-limit, Math.min(limit, wanted)) * dt;
  return { ...sailArc(ship, speed * dt, turn), speed };
};

/**
 * The route end is reached: on it, or within the last braking stretch once the hull has passed
 * abeam of it or all but stopped.
 */
const arrivedAt = (ship: ShipMotion, end: SettlementPoint) => {
  const distance = distanceBetween(ship, end);
  if (distance <= ARRIVED) return true;
  if (distance > HOLD_COURSE) return false;
  const along = (end.x - ship.x) * DMath.sin(ship.yaw) + (end.z - ship.z) * DMath.cos(ship.yaw);
  return along <= 0 || Math.abs(ship.speed) <= SETTLED_SPEED;
};

/** Signed length of the manoeuvre run from the ship: legs in the same direction until a stop. */
const manoeuvreRun = (ship: ShipPose, route: readonly ShipRoutePoint[], cursor: number) => {
  const first = route[cursor]!, astern = Boolean(first.astern);
  let total = 0, pose: ShipPose = ship;
  for (let index = cursor; index < route.length; index++) {
    const point = route[index]!;
    // Sailing on ahead into open water needs no stop.
    if (!isManoeuvre(point)) return astern ? total : Infinity;
    if (point.pivot !== undefined || Boolean(point.astern) !== astern) return total;
    total += Math.abs(arcTo(pose, point, astern).length);
    pose = { x: point.x, yaw: point.yaw!, z: point.z };
  }
  return total;
};

/**
 * What is left of a manoeuvre arc: legs planned with a curvature keep it (the heading then ends
 * exactly on the leg's, and any small offset of the hull is not amplified); others take the arc
 * through the hull's pose that ends on the leg's point.
 */
const legRemaining = (pose: ShipPose, leg: ShipRoutePoint, astern: boolean) => {
  const direction = astern ? -1 : 1;
  if (leg.curvature === undefined) {
    const arc = arcTo(pose, leg, astern), length = Math.abs(arc.length);
    return { curvature: length > 0 ? arc.turn / arc.length : 0, length };
  }
  if (Math.abs(leg.curvature) < 1e-9) {
    const along = (leg.x - pose.x) * DMath.sin(pose.yaw) + (leg.z - pose.z) * DMath.cos(pose.yaw);
    return { curvature: 0, length: Math.max(0, along * direction) };
  }
  const distance = wrapAngle(leg.yaw! - pose.yaw) / leg.curvature;
  return { curvature: leg.curvature, length: Math.max(0, distance * direction) };
};

/** A manoeuvre pose's heading, when the hull already lies within a hair of it. */
const settleYaw = (yaw: number, target: number) => Math.abs(wrapAngle(target - yaw)) <= SETTLE_YAW ? target : yaw;

const isArcLeg = (point: ShipRoutePoint, astern: boolean) => point.yaw !== undefined && !point.settle &&
  point.pivot === undefined && !point.drift && Boolean(point.astern) === astern;

/**
 * One tick along the manoeuvre arcs, exactly on each arc through the current pose to its leg's end;
 * the way left over at the end of a leg carries on into the next one in the same direction.
 */
const sailManoeuvreArcs = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number,
  dt: number): ShipMove => {
  const astern = Boolean(route[cursor]!.astern), direction = astern ? -1 : 1;
  const cruise = Math.min(SHIP_MANOEUVRE_SPEED, brakingSpeed(manoeuvreRun(ship, route, cursor)));
  const speed = changeSpeed(ship.speed, direction * Math.max(cruise, .05), dt);
  // Way still on in the other direction is taken off first; the hull never leaves the arc.
  let travel = Math.sign(speed) === direction ? Math.abs(speed) * dt : 0, pose: ShipPose = ship, advance = 0;
  for (let index = cursor; index < route.length && isArcLeg(route[index]!, astern); index++) {
    const { curvature, length } = legRemaining(pose, route[index]!, astern);
    const step = Math.min(travel, length);
    if (step > 0) pose = sailArc(pose, direction * step, curvature * direction * step);
    travel -= step;
    if (length - step > 1e-4) break;
    // The leg ends on its pose: the last hair of heading left by rounding is taken up here.
    pose = { x: pose.x, yaw: settleYaw(pose.yaw, route[index]!.yaw!), z: pose.z };
    advance++;
  }
  // Out of the last arc ahead into open water: the way left over carries the hull on along its keel.
  const next = route[cursor + advance];
  if (travel > 0 && !astern && next && !isManoeuvre(next)) pose = sailArc(pose, travel, 0);
  return { ...pose, advance, speed };
};

/** The hull runs on along its keel while its way comes off (before a swing on the oars). */
const takeOffWay = (ship: ShipMotion, dt: number): ShipMove => {
  const speed = changeSpeed(ship.speed, 0, dt);
  return { ...sailArc(ship, speed * dt, 0), advance: 0, speed };
};

/**
 * Rate of an oar or spring-line swing: it gathers and loses way over the first and last few degrees,
 * and a swing round the bow or stern is slow enough that the far end moves at manoeuvring speed.
 */
const swingRate = (done: number, remaining: number, pivot: number, dt: number) => {
  // The hull centre, `pivot` tiles from the keel point, gathers and loses way like a ship under way.
  const reach = Math.max(Math.abs(pivot), 1);
  const gather = SHIP_ACCELERATION / reach, brake = SHIP_DECELERATION / reach;
  return Math.min(OAR_TURN_RATE, SHIP_MANOEUVRE_SPEED / reach, Math.sqrt(2 * gather * done) + gather * dt,
    Math.sqrt(2 * brake * remaining));
};

/** One tick of a slow swing round a keel point (oars or a spring line); way is taken off first. */
const swingManoeuvre = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number,
  dt: number): ShipMove => {
  // All way off first (the brake brings it to exactly 0): the swing never starts from a glide.
  if (ship.speed) return takeOffWay(ship, dt);
  const target = route[cursor]!, remaining = wrapAngle(target.yaw! - ship.yaw);
  const start = route[cursor - 1]?.yaw ?? target.fromYaw;
  const done = start === undefined ? Infinity : Math.abs(wrapAngle(ship.yaw - start));
  const turn = Math.sign(remaining) * Math.min(Math.abs(remaining), swingRate(done, Math.abs(remaining), target.pivot!, dt) * dt);
  const pose = swingAbout(ship, target.pivot!, turn);
  return { ...pose, advance: Math.abs(remaining - turn) <= 1e-6 ? 1 : 0, speed: 0 };
};

/** One tick easing a hull that does not fit where it lies straight out, holding its heading. */
const driftManoeuvre = (ship: ShipMotion, target: ShipRoutePoint, dt: number): ShipMove => {
  const distance = distanceBetween(ship, target), travel = Math.min(distance, DRIFT_SPEED * dt);
  const share = distance > 0 ? travel / distance : 1;
  return { advance: distance - travel <= 1e-5 ? 1 : 0, speed: 0, x: ship.x + (target.x - ship.x) * share,
    yaw: ship.yaw, z: ship.z + (target.z - ship.z) * share };
};

/**
 * One tick settling exactly onto a point a short way off (where an open-water run stopped near a
 * manoeuvre's start): ahead or astern along an arc on the keel, after first swinging on the oars
 * to face it when it lies well off the keel line.
 */
const settleManoeuvre = (ship: ShipMotion, target: ShipRoutePoint, dt: number): ShipMove => {
  const distance = distanceBetween(ship, target);
  if (distance <= SETTLED) return { ...ship, advance: 1, speed: changeSpeed(ship.speed, 0, dt) };
  const bearing = DMath.atan2(target.x - ship.x, target.z - ship.z);
  const astern = Math.abs(wrapAngle(bearing - ship.yaw)) > Math.PI / 2, direction = astern ? -1 : 1;
  const half = wrapAngle(bearing - ship.yaw - (astern ? Math.PI : 0));
  // A point within a tile (a run that overshot its stop) is faced fully first and come onto straight: an arc
  // onto it swung the hull on past the heading the next pivot then turned back from (owner bug 2026-10-22:
  // up to 200° on the way to the pier for half a tile).
  if (Math.abs(half) > (distance < SHORT_SETTLE ? SETTLE_YAW : SETTLE_ARC)) {
    if (ship.speed) return takeOffWay(ship, dt);
    const turn = Math.sign(half) * Math.min(Math.abs(half), OAR_TURN_RATE * dt);
    return { ...swingAbout(ship, 0, turn), advance: 0, speed: 0 };
  }
  const arc = arcTo(ship, target, astern), length = Math.abs(arc.length);
  // Slow enough that the bow never swings faster than the oars could turn it.
  const turning = length > 0 ? OAR_TURN_RATE * length / Math.max(Math.abs(arc.turn), 1e-6) : Infinity;
  const cruise = Math.min(SHIP_MANOEUVRE_SPEED, brakingSpeed(length), turning);
  const speed = changeSpeed(ship.speed, direction * Math.max(.02, cruise), dt);
  const travel = Math.sign(speed) === direction ? Math.min(Math.min(Math.abs(speed), turning) * dt, length) : 0;
  const pose = travel > 0 ? sailArc(ship, direction * travel, arc.turn * travel / length) : ship;
  return { ...pose, advance: length - travel <= SETTLED ? 1 : 0, speed };
};

/** One tick on a manoeuvre leg. */
export const manoeuvreShip = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number,
  dt: number): ShipMove => {
  const target = route[cursor]!;
  if (target.drift) return driftManoeuvre(ship, target, dt);
  if (target.settle) return settleManoeuvre(ship, target, dt);
  if (target.pivot !== undefined) return swingManoeuvre(ship, route, cursor, dt);
  return sailManoeuvreArcs(ship, route, cursor, dt);
};

/** One tick on an open-water leg under `order`; the cursor advances once the run's stop is reached. */
export const sailShip = (ship: ShipMotion, route: readonly ShipRoutePoint[], cursor: number,
  order: HelmOrder, dt: number): ShipMove => {
  const moved = executeSailOrder(ship, order, dt), stop = cursor === stopIndex(route, cursor);
  return { ...moved, advance: stop && arrivedAt(moved, route[cursor]!) ? 1 : 0 };
};
