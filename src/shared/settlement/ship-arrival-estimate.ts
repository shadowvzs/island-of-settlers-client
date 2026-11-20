import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { DMath } from "../math/deterministic-math";
import type { NavalShip } from "./settlement-naval-fleet";
import { OAR_TURN_RATE, SHIP_MANOEUVRE_SPEED, SHIP_SPEED } from "./settlement-ship-kinematics";
import { shipTravelSeconds } from "./ship-travel-time";

/** Live remaining course time; harbour traffic can delay this estimate. `voyageRate`: talents beyond the edge. */
export const shipArrivalEstimate = (ship: NavalShip, voyageRate = 1) => {
  if (ship.phase === "unloading") return 0;
  if (ship.queuedAt || ship.phase === "stranded") return undefined;
  let seconds = ship.phase === "away" ? shipTravelSeconds(Math.max(0, ship.timer)) / voyageRate : 0;
  let x = ship.x, z = ship.z, yaw = ship.yaw;
  for (let i = ship.cursor; i < ship.route.length; i++) {
    const point = ship.route[i]!;
    if (point.pivot !== undefined && point.yaw !== undefined)
      seconds += Math.abs(wrapAngle(point.yaw - yaw)) / OAR_TURN_RATE;
    else seconds += DMath.hypot(point.x - x, point.z - z) /
      (point.yaw === undefined ? SHIP_SPEED : SHIP_MANOEUVRE_SPEED);
    x = point.x; z = point.z; yaw = point.yaw ?? yaw;
  }
  return Math.ceil(seconds);
};
