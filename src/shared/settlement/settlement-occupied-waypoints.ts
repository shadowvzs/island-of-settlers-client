import { DMath } from "../math/deterministic-math";
import { isInOwnDoorPassage, isOwnDoorLane, isOwnStockCourtyard } from "./settlement-entrance";
import { isGroundSegmentClear } from "./settlement-navigation";
import { forEachNearbyTrafficActor } from "./settlement-person-index";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** Within this distance of an occupied point the mover treats it as reached instead of orbiting it. */
const OCCUPIED_REACH = .3;
const MOVING_ACTIONS = new Set(["carry", "walk"]);

/** Standing still for traffic: no shoulder target, and either finished its path or not walking. */
const isStationaryForTraffic = (actor: SettlementActor) =>
  !actor.queueTarget && (actor.pathIndex >= actor.path.length || !MOVING_ACTIONS.has(actor.action) ||
    (actor.queueWait ?? 0) > 0);

/** The first visible stationary unit standing on `point` (within separation), if any. */
const stationaryOccupant = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) => {
  let occupant: SettlementActor | undefined;
  forEachNearbyTrafficActor(context, point, 1.25, other => {
    if (other === actor || !other.visible || !isStationaryForTraffic(other))
      return false;
    if (DMath.hypot(other.x - point.x, other.z - point.z) >= actorSeparation(actor, other) + .05) return false;
    occupant = other;
    return true;
  });
  return occupant;
};

/** Doorways, stock contacts and court points must be stepped on exactly; they are never skipped. */
const isExactPoint = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  isInOwnDoorPassage(context, actor) || isOwnDoorLane(context, actor, point) ||
  isOwnStockCourtyard(context, actor, point) || Boolean(actor.stockContact) || Boolean(actor.wareTransfer);

/** Soldiers and riders keep their formation slots; the military layer resolves its own crowding. */
export const isMilitaryMover = (actor: SettlementActor) => actor.mounted || actor.job === "Soldier";

const isWithinReach = (actor: SettlementActor, occupant: SettlementActor, point: SettlementPoint) =>
  DMath.hypot(point.x - actor.x, point.z - actor.z) <= actorSeparation(actor, occupant) + OCCUPIED_REACH;

/**
 * A unit standing on the next waypoint would make the mover sidestep around it forever. Close to an
 * intermediate waypoint, continue to the following one when that straight leg is clear; close to a
 * free-standing final goal, the goal counts as reached. Exact door and stock points still queue.
 */
export const passOccupiedWaypoint = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) => {
  if (isMilitaryMover(actor) || DMath.hypot(point.x - actor.x, point.z - actor.z) > 1) return "none";
  if (isExactPoint(context, actor, point)) return "none";
  const occupant = stationaryOccupant(context, actor, point);
  if (!occupant || !isWithinReach(actor, occupant, point)) return "none";
  const next = actor.path[actor.pathIndex + 1];
  if (!next) return "arrived";
  if (isExactPoint(context, actor, next) || !isGroundSegmentClear(context, actor, next)) return "none";
  actor.pathIndex++;
  return "advanced";
};

/**
 * After a sidestep the unit may already stand past its current waypoint; walking back to it reads
 * as a reversal. Skip such passed waypoints while the straight leg to the following one is clear.
 */
export const skipPassedWaypoints = (context: SettlementContext, actor: SettlementActor) => {
  if (isMilitaryMover(actor)) return;
  for (let skipped = 0; skipped < 2; skipped++) {
    const point = actor.path[actor.pathIndex], next = actor.path[actor.pathIndex + 1];
    if (!point || !next || isExactPoint(context, actor, point) || isExactPoint(context, actor, next)) return;
    const along = (actor.x - point.x) * (next.x - point.x) + (actor.z - point.z) * (next.z - point.z);
    if (along <= 0 || !isGroundSegmentClear(context, actor, next)) return;
    actor.pathIndex++;
  }
};
