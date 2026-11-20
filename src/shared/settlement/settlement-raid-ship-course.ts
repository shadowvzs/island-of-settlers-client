import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import type { AdventureLanding } from "./settlement-adventure-landing";
import { distanceBetween } from "./settlement-geometry";
import { shipHullFitsSea } from "./settlement-ship-clearance";
import type { SettlementPoint } from "./settlement-types";

/** The raid ship's cruising speed (tiles/s) and the distance it brakes over before it anchors. */
const RAID_SAIL_SPEED = 1.8;
const RAID_BRAKE_DISTANCE = 4;
/** Open water a raid ship sails over to its anchorage and away again, longest first (tiles). */
const RAID_COURSE_SPANS = [24, 16, 8, 4] as const;

/** A raid ship sailing in from `from`, or away to `to`, along its anchoring heading. */
export interface RaidArrival { from: SettlementPoint; elapsed: number; duration: number }
export interface RaidDeparture { to: SettlementPoint; elapsed: number; duration: number }

/** Seconds a raid ship needs for `span` tiles: cruising, then braking evenly to a stop. */
export const raidApproachSeconds = (span: number) => {
  const brake = Math.min(RAID_BRAKE_DISTANCE, span / 2);
  return (span + brake) / RAID_SAIL_SPEED;
};

/**
 * Tiles sailed after `elapsed` of an approach of `span` tiles taking `duration` seconds: cruising,
 * then an even deceleration to rest at the anchorage. Saves before 2026-10-15 timed a constant
 * speed (no braking room in `duration`) and keep sailing in at that speed.
 */
export const raidApproachDistance = (elapsed: number, span: number, duration: number) => {
  const brake = Math.max(0, duration * RAID_SAIL_SPEED - span);
  const cruise = span - brake;
  if (brake <= 1e-6) return Math.min(span, (span / duration) * elapsed);
  const cruiseSeconds = cruise / RAID_SAIL_SPEED;
  if (elapsed <= cruiseSeconds) return RAID_SAIL_SPEED * elapsed;
  const braking = Math.min(elapsed - cruiseSeconds, (2 * brake) / RAID_SAIL_SPEED);
  return Math.min(span, cruise + RAID_SAIL_SPEED * braking -
    (RAID_SAIL_SPEED * RAID_SAIL_SPEED * braking * braking) / (4 * brake));
};

/** Tiles sailed `elapsed` into a departure: the approach in reverse (gathering way, then cruising). */
export const raidDepartureDistance = (elapsed: number, span: number, duration: number) =>
  span - raidApproachDistance(Math.max(0, duration - elapsed), span, duration);

/**
 * The longest clear course along the anchoring heading: astern of the anchorage for the way in
 * (`side` -1), ahead of it for the way out (`side` 1). Undefined when even the shortest is blocked.
 */
export const raidCourse = (world: WorldData, sea: Uint8Array, landing: AdventureLanding, side: -1 | 1) => {
  const { water, yaw } = landing;
  for (const span of RAID_COURSE_SPANS) {
    const end = { x: water.x + side * DMath.sin(yaw) * span, z: water.z + side * DMath.cos(yaw) * span };
    let clear = true;
    for (let step = 0; step <= span * 2 && clear; step++) {
      const t = step / (span * 2);
      clear = shipHullFitsSea(world, sea, { x: end.x + (water.x - end.x) * t, yaw, z: end.z + (water.z - end.z) * t });
    }
    if (clear) return { duration: raidApproachSeconds(span), end };
  }
  return undefined;
};

const between = (from: SettlementPoint, to: SettlementPoint, sailed: number) => {
  const span = distanceBetween(from, to), t = span > 0 ? sailed / span : 1;
  return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
};

/** Where a raid ship lies: sailing in, anchored at `landing.water`, or sailing away. */
export const raidShipPosition = (landing: AdventureLanding, arrival?: RaidArrival, departure?: RaidDeparture) => {
  if (arrival) {
    const span = distanceBetween(arrival.from, landing.water);
    return between(arrival.from, landing.water, raidApproachDistance(arrival.elapsed, span, arrival.duration));
  }
  if (!departure) return landing.water;
  const span = distanceBetween(landing.water, departure.to);
  return between(landing.water, departure.to, raidDepartureDistance(departure.elapsed, span, departure.duration));
};

/** Whether a saved leg of the voyage (arrival or departure, its point at `end`) is malformed. */
export const raidLegError = (leg: { elapsed: number; duration: number } | undefined, end?: SettlementPoint) =>
  leg !== undefined && (!leg || !Number.isFinite(end?.x) || !Number.isFinite(end?.z) ||
    !Number.isFinite(leg.elapsed) || leg.elapsed < 0 || !Number.isFinite(leg.duration) || leg.duration <= 0);
