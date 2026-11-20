import { isOwnDoorLane, isOwnStockCourtyard } from "./settlement-entrance";
import { buildRevisionSinceLoad } from "./settlement-load-revisions";
import { findGroundPath, isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { requestNavigationRepair } from "./settlement-repair-budget";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
const retries = new WeakMap<SettlementActor, { revision: number; remaining: number }>();
/**
 * One repair attempt per actor per second (at once after a building edit), within the island's
 * global repair budget: a static search repeats its last answer until the world or actor changes.
 */
const claimRepairAttempt = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  // The retained epoch's count: equal across a reload, so a restored wait keeps counting (AI-RELOAD-DRIFT).
  const revision = buildRevisionSinceLoad(context),
    previous = retries.get(actor);
  if (previous && previous.revision === revision && (previous.remaining -= dt) > 0) return false;
  if (!requestNavigationRepair(context, actor)) return false;
  retries.set(actor, { revision, remaining: 1 });
  return true;
};
/** Path indices a detour may rejoin; an empty route (a yield towards a queue target) has none. */
const detourCandidates = (actor: SettlementActor) => {
  const remaining = actor.path.length - actor.pathIndex;
  const candidates = [actor.pathIndex, actor.pathIndex + Math.ceil(remaining / 4),
    actor.pathIndex + Math.ceil(remaining / 2), actor.path.length - 1];
  return [...new Set(candidates)].filter(index => index >= 0 && index < actor.path.length);
};
/**
 * Repair only the obstructed local segment; retain the original road's later waypoints and destination.
 * `rejoin` is the caller's wider repair, tried in the same throttled attempt when no local detour exists.
 */
export const findObstacleDetour = (
  context: SettlementContext,
  actor: SettlementActor,
  dt: number,
  rejoin?: () => SettlementPoint[] | null
) => {
  if (!claimRepairAttempt(context, actor, dt)) return null;
  const allows = (point: { x: number; z: number }) =>
    isOwnDoorLane(context, actor, point) || isOwnStockCourtyard(context, actor, point);
  // A rider's detour needs a horse's clearance all the way, or it walks into the next obstacle.
  const blocked = actor.mounted ? (point: { x: number; z: number }) => !isMountedNavigationClear(context, point)
    : undefined;
  for (const index of detourCandidates(actor)) {
    const destination = actor.path[index]!;
    if (!isNavigationClear(context, destination, allows(destination)) || blocked?.(destination)) continue;
    // Stock lanes have quarter-body turns; the public half-tile grid cuts their corners.
    const fine = actor.stockBuilding !== undefined;
    const detour = findGroundPath(context, actor, destination, blocked, allows,
      fine ? .125 : .5, fine ? 4096 : 512);
    if (!detour) continue;
    retries.delete(actor);
    return [...detour, ...actor.path.slice(index + 1)];
  }
  const rejoined = rejoin?.() ?? null;
  if (rejoined) retries.delete(actor);
  return rejoined;
};

/** [actor uid, seconds until its next repair attempt]: only waits still running at this build revision. */
export type SavedObstacleDetourWait = [number, number];

/** A wait from an older build revision, or one already over, acts as no wait at all and is left out. */
export const saveObstacleDetourWaits = (context: SettlementContext): SavedObstacleDetourWait[] => {
  const revision = buildRevisionSinceLoad(context);
  return context.actors.flatMap(actor => {
    const wait = retries.get(actor);
    return wait && wait.revision === revision && wait.remaining > 0 ? [[actor.uid, wait.remaining]] : [];
  });
};

/** Restores the running waits at the loaded island's current build revision (after the load's own edits). */
export const restoreObstacleDetourWaits = (context: SettlementContext, saved?: readonly SavedObstacleDetourWait[]) => {
  if (!saved) return;
  const revision = buildRevisionSinceLoad(context);
  const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
  for (const [uid, remaining] of saved) {
    const actor = actors.get(uid);
    if (actor) retries.set(actor, { revision, remaining });
  }
};
