import { DMath } from "../math/deterministic-math";
import { turnYawToward } from "./settlement-geometry";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/** Waypoints closer than this are under the unit's feet: looking at them would spin it on the spot. */
const LOOKAHEAD = .4;
const TURN_RATE = 6;

/** Where a waiting unit looks: its stock handoff, else the first remaining waypoint ahead of it. */
export const waitingFocus = (actor: SettlementActor): SettlementPoint | undefined => {
  if (actor.stockContact) return actor.stockContact.approach;
  for (let index = actor.pathIndex; index < actor.path.length; index++) {
    const point = actor.path[index]!;
    if (DMath.hypot(point.x - actor.x, point.z - actor.z) >= LOOKAHEAD) return point;
  }
  return actor.path[actor.pathIndex];
};

/** Waiting crews keep looking toward their handoff/next waypoint, without moving or snapping. */
export const faceWaitingDestination = (actor: SettlementActor, dt: number) => {
  const target = waitingFocus(actor);
  if (!actor.visible || !target) return;
  const dx = target.x - actor.x;
  const dz = target.z - actor.z;
  if (DMath.hypot(dx, dz) < 0.05) return;
  const heading = DMath.atan2(dx, dz);
  actor.yaw = turnYawToward(actor.yaw, heading, dt * TURN_RATE);
};
