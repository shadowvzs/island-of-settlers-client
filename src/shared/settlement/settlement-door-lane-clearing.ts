import { DMath } from "../math/deterministic-math";
import { isWithinRoadClearance } from "./road-proximity-index";
import { isNearDoorLane } from "./settlement-entrance";
import {
  actorSeparation, chooseCrowdEscapeTarget, chooseYieldTarget, isQueueSpotTaken, isTrafficSegmentClear
} from "./settlement-traffic";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

/** Road lanes keep right of the centreline; a passing crew's shoulder reaches this far out. */
const LANE_REACH = .3;
/** How far out from the access the incoming road still belongs to the entrance corridor. */
const CORRIDOR_REACH = 1.6;
/** The .31 mount lane plus .46 separation and a small margin; foot waiters must clear it too. */
export const STORAGE_WAITING_ROAD_CLEARANCE = .8;

/**
 * How far a waiter's centre must stand from a road or door lane centreline so a crew passing on
 * either lane clears it: a mount needs more room than a settler.
 */
const laneClearance = (actor: SettlementActor) =>
  Math.max(STORAGE_WAITING_ROAD_CLEARANCE, LANE_REACH + actorSeparation(actor, actor));

/** Within `clearance` of any road centreline (bucketed per road revision). */
export const isNearRoad = (context: SettlementContext, point: SettlementPoint, clearance: number) =>
  isWithinRoadClearance(context.options.roads, point, clearance);

/**
 * The crew whose door turn it is walks this corridor in, and departing crews walk it out. A waiter
 * standing on it blocks both (HQ deadlock, owner save 2026-10-20 (5)).
 */
const isOnEntranceCorridor = (
  context: SettlementContext, building: SettlementBuilding, point: SettlementPoint, clearance: number
) => {
  const { access } = building;
  if (DMath.hypot(point.x - access.x, point.z - access.z) >= CORRIDOR_REACH) return false;
  return isNearDoorLane(building, point, clearance) || isNearRoad(context, point, clearance);
};

/** Side slots beside the door line, level with the waiter's projection on it (or nudged outward). */
const sideSlots = (actor: SettlementActor, building: SettlementBuilding, clearance: number) => {
  const { access, doorThreshold } = building;
  const length = DMath.hypot(access.x - doorThreshold.x, access.z - doorThreshold.z) || 1;
  const outX = (access.x - doorThreshold.x) / length, outZ = (access.z - doorThreshold.z) / length;
  const along = Math.max(0, (actor.x - access.x) * outX + (actor.z - access.z) * outZ);
  const slots: SettlementPoint[] = [];
  for (const lateral of [clearance + .05, clearance + .35]) for (const nudge of [0, .3, .6])
    for (const side of [1, -1]) slots.push({
      x: access.x + outX * (along + nudge) - outZ * lateral * side,
      z: access.z + outZ * (along + nudge) + outX * lateral * side
    });
  return slots;
};

/** A free, reachable side slot beside the entrance corridor, or null when the crowd leaves none. */
export const chooseEntranceSideSlot = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  const clearance = laneClearance(actor);
  if (!isOnEntranceCorridor(context, building, actor, clearance)) return null;
  const isAside = (point: SettlementPoint) => !isOnEntranceCorridor(context, building, point, clearance);
  return chooseYieldTarget(context, actor, actor, building.access, true, isAside) ??
    chooseCrowdEscapeTarget(context, actor, isAside) ??
    sideSlots(actor, building, clearance).find(point => isAside(point) &&
      !isQueueSpotTaken(context, actor, point) && isTrafficSegmentClear(context, actor, point, true)) ?? null;
};
