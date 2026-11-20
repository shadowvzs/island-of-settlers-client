import {
  SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SPACING, SAILING_SHIP_TURN_RADIUS
} from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import type { ShipObstacle } from "./settlement-ship-clearance";
import { createShipLaneIndex } from "./settlement-ship-lane-index";
import type { ShipRoutePoint } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

/** Waiting ships keep a full hull length of open water from the berth and from each other. */
export const ANCHORAGE_SPACING = SAILING_SHIP_OVERALL_LENGTH + SAILING_SHIP_SPACING;
/** From the berth also a turning radius more: a ship getting out of it swings round its bow or stern. */
const BERTH_CLEARANCE = ANCHORAGE_SPACING + SAILING_SHIP_TURN_RADIUS;
const LANE_STEP = 1;
/** Waiting spots are searched on rings around the berth, nearest first. */
const RING_RADII = Array.from({ length: 15 }, (_, index) => 12 + index * 2);
const RING_DIRECTIONS = 24;
/**
 * Farther out (a harbour at the end of a long channel), rings a few tiles apart along their arc: the open
 * water beyond the channel is often only reachable there (NAV-01).
 */
const OUTER_RING_RADII = Array.from({ length: 10 }, (_, index) => 42 + index * 2);
const OUTER_RING_ARC = 5;
/** Offsets (and headings) of every ring point from the berth, nearest ring first; computed once. */
const ringOffsets = (rings: readonly { directions: number; radius: number }[]) => rings
  .flatMap(({ directions, radius }) => Array.from({ length: directions }, (_, index) => {
    const angle = index / directions * Math.PI * 2;
    return { x: DMath.sin(angle) * radius, yaw: angle + Math.PI / 2, z: DMath.cos(angle) * radius };
  }));
const RING_OFFSETS = ringOffsets([
  ...RING_RADII.map(radius => ({ directions: RING_DIRECTIONS, radius })),
  ...OUTER_RING_RADII.map(radius => ({ directions: Math.round(Math.PI * 2 * radius / OUTER_RING_ARC), radius }))
]);
/** Overflow bays at map edges need farther water after all ordinary spots are obstructed. */
const OVERFLOW_RING_OFFSETS = ringOffsets(Array.from({ length: 17 }, (_, index) => {
  const radius = 64 + index * 4;
  return { directions: Math.round(Math.PI * 2 * radius / OUTER_RING_ARC), radius };
}));
/** A waiting ship lies on whatever heading it arrived on: the spot keeps clear of the ways on any of these. */
const WAITING_HEADINGS = [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4];

interface AnchorageHooks {
  overlaps(a: ShipObstacle, b: ShipObstacle): boolean;
  /** The hull fits the water there and the ship can sail from there to the berth. */
  usable(point: ShipObstacle): boolean;
  /** Pure necessary water condition; rejecting here must not consume a route attempt. */
  waterClear?(point: ShipObstacle): boolean;
}
/** A way ships sail: from the berth out to sea, or from a ship to the berth. */
export interface ShipApproach { from: SettlementPoint; path: readonly ShipRoutePoint[] }

/** Points every `LANE_STEP` tiles along the lane and on every course point, each facing along it. */
export const sampleShipLane = (start: SettlementPoint, lane: readonly ShipRoutePoint[]) => {
  const samples: ShipObstacle[] = [];
  let previous = start;
  for (const point of lane) {
    const length = DMath.hypot(point.x - previous.x, point.z - previous.z);
    const yaw = DMath.atan2(point.x - previous.x, point.z - previous.z);
    for (let travelled = LANE_STEP; travelled < length; travelled += LANE_STEP) {
      const share = travelled / length;
      samples.push({ x: previous.x + (point.x - previous.x) * share,
        yaw, z: previous.z + (point.z - previous.z) * share });
    }
    // Every course point itself, on its own heading where it has one (manoeuvres in tight water).
    samples.push({ x: point.x, yaw: point.yaw ?? (length > 1e-9 ? yaw : 0), z: point.z });
    previous = point;
  }
  return samples;
};


/**
 * The nearest spot around `center` (by default the harbour's first berth) where a ship can wait without
 * blocking any of its berths, another ship, or any way a ship sails to or from them (so waiting ships never
 * deadlock a harbour).
 */
export const findShipAnchorage = (
  berths: readonly SettlementPoint[], approaches: readonly ShipApproach[], held: readonly SettlementPoint[],
  hooks: AnchorageHooks, center: SettlementPoint = berths[0]!, overflow = false
) => {
  const ways = approaches.flatMap(approach => sampleShipLane(approach.from, approach.path));
  const laneOverlaps = createShipLaneIndex(ways);
  const clear = (point: ShipObstacle) =>
    berths.every(berth => DMath.hypot(berth.x - point.x, berth.z - point.z) >= BERTH_CLEARANCE) &&
    held.every(other => DMath.hypot(other.x - point.x, other.z - point.z) >= ANCHORAGE_SPACING) &&
    !laneOverlaps(point, way => WAITING_HEADINGS.some(turn =>
      hooks.overlaps({ ...point, yaw: point.yaw + turn }, way)));
  // Points on rings around the centre, nearest ring first, each facing around it.
  for (const offset of overflow ? OVERFLOW_RING_OFFSETS : RING_OFFSETS) {
    const point = { x: center.x + offset.x, yaw: offset.yaw, z: center.z + offset.z };
    if (hooks.waterClear && !hooks.waterClear(point)) continue;
    if (clear(point) && hooks.usable(point)) return point;
  }
  return null;
};
