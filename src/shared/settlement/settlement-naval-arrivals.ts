import type { FleetBerthing } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import type { createHarbourLighters } from "./settlement-naval-lighters";
import { SHIP_SPEED } from "./settlement-ship-kinematics";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";
import { routeLength } from "./ship-cargo-handling";

/** A ship from beyond the map edge may arrive this much before its berth is expected free (seconds). */
const ARRIVAL_SLACK_SECONDS = 15;

interface ShipArrivalsOptions {
  dock: FleetBerthing["dock"];
  lighters: Pick<ReturnType<typeof createHarbourLighters>, "berthFreeIn">;
  planner: ReturnType<typeof createShipRoutePlanner>;
}

/**
 * Just in time (owner, 2026-10-21): a ship beyond the map edge comes in only when a berth of its harbour is
 * expected free about when it gets there (the berth's ship's pier time left and its casting off, against this
 * ship's sailing time); else it stays out of sight, so at most one ship waits in sight off a harbour and the
 * others sail straight in. Coming in early for the lighters was measured and dropped: their estimate from
 * beyond the edge made 6 and 8 visitors slower than the piers alone.
 */
export const createShipArrivals = ({ dock, lighters, planner }: ShipArrivalsOptions) => {
  /** `ship` sailing from `from` to `target` off harbour `uid` gets there about when a berth is free. */
  const arrivesInTime = (ship: NavalShip, uid: number, from: SettlementPoint, target: SettlementPoint) => {
    const freeIn = lighters.berthFreeIn(uid, ship);
    if (freeIn <= 0) return true;
    const way = planner.route({ ...from, yaw: ship.yaw }, target);
    return Boolean(way) && freeIn <= routeLength([from, ...way!]) / SHIP_SPEED + ARRIVAL_SLACK_SECONDS;
  };
  /** A ship back from a colony stays beyond the edge until its home harbour's berth is about free for it. */
  const homeInTime = (ship: NavalShip, exit: SettlementPoint) => {
    const uid = ship.sourceUid, berth = uid === undefined ? undefined : dock(uid);
    return !berth || arrivesInTime(ship, uid!, exit, berth);
  };
  return { arrivesInTime, homeInTime };
};
