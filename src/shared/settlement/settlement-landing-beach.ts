import { DMath } from "../math/deterministic-math";
import { militaryGroundPath } from "./military-routing";
import { horseGap } from "./settlement-horse-bodies";
import { findGroundPath, isMountedNavigationClear } from "./settlement-navigation";
import { moveActor, setActorPath } from "./settlement-paths";
import { nearbyTrafficActors } from "./settlement-person-index";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** A rider who has not reached his next waypoint for this long (seconds) looks for a way round. */
const HELD_SECONDS = 2;
/** A way round takes the bodies standing this near into account, and searches this many nodes at most. */
const DETOUR_RADIUS = 8;
const DETOUR_VISITS = 4000;
/** Riders this near (tiles, two horses' lengths) may touch his horse. */
const HORSE_QUERY = 3.4;

/** Held up through this many ways round, he stops where he is (his gathering place from then on). */
const DETOURS_BEFORE_STOPPING = 3;

/**
 * Seconds since each beach rider last reached a waypoint, and the ways round looked for since
 * (transient: a loaded rider starts afresh).
 */
const held = new WeakMap<SettlementActor, { detours: number; seconds: number }>();

/** He leaves the beach as any rider leaving: at his gathering place (or where he stopped). */
const stopHere = (actor: SettlementActor) => {
  held.delete(actor);
  setActorPath(actor, [{ x: actor.x, z: actor.z }], "militaryLeaving");
};

/** The least gap between the rider's horse and the other riders' near him (tiles). */
const horseRoom = (context: SettlementContext, actor: SettlementActor) =>
  nearbyTrafficActors(context, actor, HORSE_QUERY).reduce((least, other) => other === actor || !other.visible ||
    !other.mounted ? least : Math.min(least, horseGap(actor, other)), Infinity);

/** Where his horse has room and a horse's way to the gathering place he goes on as any rider leaving. */
const rideOnFromHere = (context: SettlementContext, actor: SettlementActor) => {
  const goal = actor.path.at(-1);
  if (!goal || !isMountedNavigationClear(context, actor)) return false;
  const path = militaryGroundPath(context, actor, goal, true);
  if (!path) return false;
  setActorPath(actor, path, "militaryLeaving");
  return true;
};

/** Standing still, or a field soldier stepping back to his place after making way. */
const isStanding = (other: SettlementActor) => other.path.length - other.pathIndex <= (other.phase === "militaryField" ? 1 : 0);

/** A way on foot to the gathering place round the bodies standing still near the rider (if any). */
const rideRoundStandingBodies = (context: SettlementContext, actor: SettlementActor) => {
  const goal = actor.path.at(-1);
  if (!goal) return;
  const standing = nearbyTrafficActors(context, actor, DETOUR_RADIUS).filter(other => other !== actor &&
    other.visible && isStanding(other));
  const isBlocked = (point: SettlementPoint) => standing.some(other =>
    DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(actor, other));
  const detour = findGroundPath(context, actor, goal, isBlocked, undefined, .5, DETOUR_VISITS);
  if (detour) setActorPath(actor, detour, actor.phase);
};

/**
 * One tick of a rider riding on over a narrow beach (owner, 2026-10-15: riders no longer get down to lead
 * their horse). He rides the way on foot with the usual traffic rules (a horse's separation from everyone,
 * idle soldiers step aside) until his horse has room; at the gathering place he leaves as any rider. Held
 * up a while (a soldier standing in the way), he looks for a way round; held up still, he stops there.
 */
export const rideOverBeach = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const waypoint = actor.pathIndex;
  const before = { pathIndex: actor.pathIndex, x: actor.x, y: actor.y, yaw: actor.yaw, z: actor.z };
  const roomBefore = horseRoom(context, actor);
  const arrived = moveActor(context, actor, dt);
  const roomAfter = horseRoom(context, actor);
  if (roomAfter < 0 && roomAfter < roomBefore) {
    // The traffic rules keep riders an ellipse apart; a turning horse may still touch the one ahead.
    Object.assign(actor, before, { action: "idle" });
    return;
  }
  if (arrived) return stopHere(actor);
  if (actor.pathIndex !== waypoint) {
    held.delete(actor);
    rideOnFromHere(context, actor);
    return;
  }
  const hold = held.get(actor) ?? { detours: 0, seconds: 0 };
  held.set(actor, hold);
  hold.seconds += dt;
  if (hold.seconds < HELD_SECONDS) return;
  if (hold.detours >= DETOURS_BEFORE_STOPPING) return stopHere(actor);
  hold.seconds = 0;
  hold.detours++;
  rideRoundStandingBodies(context, actor);
};
