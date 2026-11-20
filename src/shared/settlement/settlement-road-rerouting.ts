import { DMath } from "../math/deterministic-math";
import { bridgeDeckAnchorsAt, closedDeckAt } from "./bridge-deck-navigation";
import { isOwnDoorLane, isOwnStockCourtyard } from "./settlement-entrance";
import { isGroundSegmentClear } from "./settlement-navigation";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** Phases whose journey follows the public road graph (re-validated after every graph edit). */
export const ROAD_TRAVEL_PHASES: ReadonlySet<string> =
  new Set(["assigned", "retire", "pickup", "deliver", "home", "exitLoaded"]);
const roadPhases = ROAD_TRAVEL_PHASES;
const routes = new WeakMap<SettlementActor, {
  path: SettlementPoint[]; revision: number; destination: SettlementPoint; blocked: boolean;
}>();

export const invalidateRoadTravel = (context: SettlementContext) => {
  for (const actor of context.actors) {
    if (!roadPhases.has(actor.phase) || !actor.path.length) continue;
    const previous = routes.get(actor);
    routes.set(actor, { path: actor.path, revision: -1,
      destination: previous?.path === actor.path ? previous.destination : actor.path.at(-1)!, blocked: false });
  }
};

/** A graph edit must stop stale journeys before the next movement step. */
export const refreshRoadTravel = (context: SettlementContext, actor: SettlementActor) => {
  const roads = context.options.roads;
  if (!roadPhases.has(actor.phase) || roads.revision === undefined || !roads.segments || !actor.path.length)
    return true;
  let previous = routes.get(actor);
  if (!previous || previous.path !== actor.path) {
    // A new assignment owns its destination even when a graph edit happens before its first step.
    // Retain the old revision so that edit still validates the new journey before it can move.
    previous = { path: actor.path, revision: previous?.revision ?? roads.revision,
      destination: actor.path.at(-1)!, blocked: false };
    routes.set(actor, previous);
  }
  if (previous.revision === roads.revision) return !previous.blocked;
  // On a bridge awaiting removal the journey walks off along its own path (no route may use the deck).
  if (closedDeckAt(context, actor)) {
    previous.revision = roads.revision;
    previous.blocked = false;
    return true;
  }
  // Retain the authored exit until the actor reaches public ground.
  if (!actor.visible || isOwnDoorLane(context, actor, actor) || isOwnStockCourtyard(context, actor, actor))
    return true;
  const endpoints = roads.segments().flatMap(section => [section.start, section.end]);
  endpoints.sort((a, b) => DMath.hypot(a.x - actor.x, a.z - actor.z) -
    DMath.hypot(b.x - actor.x, b.z - actor.z));
  const allowsFoundation = (point: SettlementPoint) =>
    isOwnDoorLane(context, actor, point) || isOwnStockCourtyard(context, actor, point);
  const isReachable = (point: SettlementPoint) =>
    isGroundSegmentClear(context, actor, point, undefined, allowsFoundation);
  const entry = endpoints.find(point => DMath.hypot(point.x - actor.x, point.z - actor.z) <= 0.85 &&
    isReachable(point)) ?? bridgeDeckAnchorsAt(context, actor).find(isReachable);
  // Off the network (a geologist walking back over open ground) there is no road to re-plan from: the journey keeps
  // its own path and is checked again once it stands at a road (EAI3-accept: it was blocked for good).
  if (!entry) return true;
  const route = roads.route(entry, previous.destination);
  previous.revision = roads.revision;
  previous.blocked = !route;
  actor.queueTarget = undefined; actor.queueWait = 0;
  if (!route) { actor.action = "idle"; return false; }
  actor.path = route.points;
  actor.pathIndex = 0;
  previous.path = actor.path;
  return true;
};

/**
 * A journey's pending road check (AI-RELOAD-DRIFT): `stale` when a graph edit since its last check must still
 * re-validate it (also for a journey replaced since, which inherits the stale check), `blocked` when its last
 * check found no route, `destination` when the journey's goal is not its path's end. A check equal to a fresh
 * journey's (current, open, own end) is left out: the first step after a load creates exactly that one.
 */
export interface SavedRoadTravelCheck {
  actor: number;
  blocked?: true;
  destination?: SettlementPoint;
  replaced?: true;
  stale?: true;
}

const isPathEnd = (actor: SettlementActor, point: SettlementPoint) => {
  const end = actor.path.at(-1);
  return end !== undefined && end.x === point.x && end.z === point.z;
};

const savedCheck = (context: SettlementContext, actor: SettlementActor): SavedRoadTravelCheck | undefined => {
  const check = routes.get(actor);
  if (!check) return undefined;
  const stale = check.revision !== context.options.roads.revision;
  // Off a road journey only the revision counts: its next journey gets a new path and inherits it either way.
  if (!roadPhases.has(actor.phase)) return stale ? { actor: actor.uid, stale: true } : undefined;
  if (check.path !== actor.path) return stale ? { actor: actor.uid, replaced: true, stale: true } : undefined;
  const ownEnd = isPathEnd(actor, check.destination);
  if (!stale && !check.blocked && ownEnd) return undefined;
  return { actor: actor.uid, ...(check.blocked ? { blocked: true as const } : {}),
    ...(ownEnd ? {} : { destination: { x: check.destination.x, z: check.destination.z } }),
    ...(stale ? { stale: true as const } : {}) };
};

export const saveRoadTravelChecks = (context: SettlementContext): SavedRoadTravelCheck[] =>
  context.actors.flatMap(actor => savedCheck(context, actor) ?? []);

/** A current, open check of the actor's own journey: what a load gives every person (see the restore below). */
export const markRoadTravelChecked = (context: SettlementContext, actor: SettlementActor) => {
  routes.set(actor, { blocked: false, destination: actor.path.at(-1) ?? actor, path: actor.path,
    revision: context.options.roads.revision ?? 0 });
};

/** A stale check keeps an impossible revision, so the next step re-validates the journey whatever the counter. */
export const restoreRoadTravelChecks = (context: SettlementContext, saved?: readonly SavedRoadTravelCheck[]) => {
  // A current check is not saved, so every person resumes with one (EAI3-accept: a person whose last check was
  // left over from a finished journey otherwise started its next journey unchecked after a load, while the
  // uninterrupted island re-validated it after the next road edit).
  for (const actor of context.actors) markRoadTravelChecked(context, actor);
  if (!saved) return;
  const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
  for (const { actor: uid, blocked, destination, replaced, stale } of saved) {
    const actor = actors.get(uid);
    if (!actor) continue;
    routes.set(actor, { blocked: blocked === true, destination: destination ?? actor.path.at(-1) ?? actor,
      path: replaced ? [] : actor.path, revision: stale ? -1 : context.options.roads.revision ?? 0 });
  }
};
