import { WORKER_COLLISION_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { getBuilding } from "./settlement-building-index";
import { isNearDoorLane, passageBuilding } from "./settlement-entrance";
import { isNavigationFootprintClear } from "./settlement-navigation";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import { forEachNearbyTrafficActor } from "./settlement-person-index";
import { isTrafficSegmentClear, setQueueTarget } from "./settlement-traffic";
import { recordTrafficBlocker } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A unit within this distance of a hidden actor's threshold keeps the door shut. */
const DOORSTEP_RADIUS = .25;
/** The squatter steps this far clear of the door, approach and road access lane. */
const DOORSTEP_LANE_CLEARANCE = .35;
const DOORSTEP_PATIENCE = .5;
const SIDE_STEPS = [.45, .6, .8] as const;
/** Away from the wall, so a body beside the door does not clip the building. */
const OUTWARD_STEPS = [0, .25, .5] as const;

export const doorstepSquatter = (context: SettlementContext, actor: SettlementActor) => {
  let squatter: SettlementActor | undefined;
  forEachNearbyTrafficActor(context, actor, DOORSTEP_RADIUS, other => {
    if (other === actor || !other.visible || DMath.hypot(other.x - actor.x, other.z - actor.z) >= DOORSTEP_RADIUS)
      return false;
    squatter = other;
    return true;
  });
  return squatter;
};

/** Units of this building passing its own door are traffic, not squatters; they clear it themselves. */
const isUsingDoor = (squatter: SettlementActor, building: SettlementBuilding) =>
  passageBuilding(squatter) === building.uid && squatter.pathIndex < squatter.path.length;

/**
 * A doorway is never a waiting spot: whoever stands on it steps sideways off the door lane, even a
 * protected idler such as a waiting leveler. It does not walk back, so the next exit stays free.
 */
const requestDoorstepYield = (
  context: SettlementContext, squatter: SettlementActor, building: SettlementBuilding
) => {
  if (squatter.queueTarget || squatter.mounted || squatter.wareTransfer || isUsingDoor(squatter, building))
    return false;
  const { access, doorThreshold: door } = building;
  const length = DMath.hypot(access.x - door.x, access.z - door.z);
  if (!length) return false;
  const outX = (access.x - door.x) / length, outZ = (access.z - door.z) / length;
  for (const distance of SIDE_STEPS) for (const outward of OUTWARD_STEPS) for (const side of [1, -1]) {
    const point = { x: squatter.x - outZ * distance * side + outX * outward,
      z: squatter.z + outX * distance * side + outZ * outward };
    if (isNearDoorLane(building, point, DOORSTEP_LANE_CLEARANCE)) continue;
    if (!isNavigationFootprintClear(context, point, () => false, WORKER_COLLISION_RADIUS)) continue;
    if (!isTrafficSegmentClear(context, squatter, point, true)) continue;
    setQueueTarget(squatter, point, "doorstep");
    return true;
  }
  return false;
};

/** A hidden actor behind an occupied threshold queues visibly for deadlock handling, then asks for room. */
export const waitAtBlockedDoorstep = (
  context: SettlementContext, actor: SettlementActor, squatter: SettlementActor, dt: number
) => {
  recordMovementOutcome(actor, "door-queue");
  recordTrafficBlocker(actor, squatter, dt);
  actor.timer += dt;
  if (actor.timer < DOORSTEP_PATIENCE) return;
  const building = getBuilding(context, passageBuilding(actor));
  if (building) requestDoorstepYield(context, squatter, building);
};
