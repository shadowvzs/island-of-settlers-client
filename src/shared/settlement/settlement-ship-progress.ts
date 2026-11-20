import { DMath } from "../math/deterministic-math";
import { OAR_TURN_RATE, type ShipPose } from "./settlement-ship-kinematics";

interface Progress extends ShipPose {
  seconds: number; travelSeconds: number; travelX: number; travelZ: number;
  goal?: { x: number; z: number; distance: number; seconds: number };
}

/** Small repeated forward/backward steps must not conceal a ship stuck at the same pose. */
export const createShipProgress = (patience: number) => {
  const progress = new WeakMap<object, Progress>();
  const maximumStillSeconds = Math.max(patience * 4, Math.PI * 4 / OAR_TURN_RATE);
  return (ship: ShipPose, dt: number, goal?: { x: number; z: number }) => {
    const previous = progress.get(ship);
    if (!previous) {
      progress.set(ship, { x: ship.x, yaw: ship.yaw, z: ship.z, seconds: 0,
        travelSeconds: 0, travelX: ship.x, travelZ: ship.z });
      return true;
    }
    if (goal) {
      const distance = DMath.hypot(ship.x - goal.x, ship.z - goal.z), target = previous.goal;
      if (!target || target.x !== goal.x || target.z !== goal.z)
        previous.goal = { x: goal.x, z: goal.z, distance, seconds: 0 };
      else {
        if (distance < target.distance - 1) { target.distance = distance; target.seconds = 0; }
        else target.seconds += dt;
        // A wide forward/back loop may travel and swing substantially without approaching its
        // unchanged open-water waypoint. It needs the same safe recovery as a stationary hull.
        if (target.seconds >= maximumStillSeconds) return false;
      }
    } else previous.goal = undefined;
    if (DMath.hypot(ship.x - previous.travelX, ship.z - previous.travelZ) > 1) {
      previous.travelSeconds = 0;
      previous.travelX = ship.x; previous.travelZ = ship.z;
    } else previous.travelSeconds += dt;
    // Alternating sizeable swings must not hide an indefinitely stationary hull. Allow four
    // complete centre about-turns; bow/stern swings move the centre and renew this allowance.
    if (previous.travelSeconds >= maximumStillSeconds) return false;
    const turn = Math.abs(DMath.atan2(DMath.sin(ship.yaw - previous.yaw), DMath.cos(ship.yaw - previous.yaw)));
    // A slow real manoeuvre can advance its hull or swing it in place. Both count; tiny
    // oscillation around the same position and heading counts neither indefinitely.
    if (DMath.hypot(ship.x - previous.x, ship.z - previous.z) > 1 || turn > .3) {
      previous.x = ship.x; previous.yaw = ship.yaw; previous.z = ship.z; previous.seconds = 0;
      return true;
    }
    previous.seconds += dt;
    return previous.seconds < patience;
  };
};
