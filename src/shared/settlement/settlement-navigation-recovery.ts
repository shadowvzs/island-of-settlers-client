import { DMath } from "../math/deterministic-math";
import { STUCK_REPAIR_ATTEMPTS } from "./constants";
import { isManagedStorageArrival } from "./settlement-door-traffic";
import { isOwnStockCourtyard, ownDoorLaneProbe } from "./settlement-entrance";
import { isFishingShoreStep } from "./settlement-fishing";
import { ADVENTURE_BEACH } from "./settlement-landing-phases";
import { buildRevisionSinceLoad, roadRevisionSinceLoad } from "./settlement-load-revisions";
import { NAVAL_DECK_PHASES } from "./settlement-naval-phases";
import {
  isMountedNavigationClear, isNavigationClear, isNavigationFootprintClear, searchGroundPath
} from "./settlement-navigation";
import { forEachNearbyTrafficActor } from "./settlement-person-index";
import { requestNavigationRepair } from "./settlement-repair-budget";
import { publicWalkPath } from "./settlement-terrain-routing";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** Soldiers in these phases find their own way round (military steering, a rider riding on off a beach). */
const SOLDIER_FREE_PHASES = ["militaryField", "militaryLeaving", ADVENTURE_BEACH];

export type MovementOutcome =
  | "moving"
  | "arrived"
  | "door-queue"
  | "stock-wait"
  | "yield-wait"
  | "static-blocked"
  | "person-blocked"
  | "invalid-route"
  | "interaction";
export interface NavigationProgressSave {
  remaining: number;
  sampled: number;
  outcome: MovementOutcome;
  pathMatchesCurrent: boolean;
}
export interface NavigationRecoveryState {
  sampler?: NavigationProgressSave;
  task: string;
  elapsed: number;
  attempts: number;
  revision: string;
  blocked: boolean;
  notified: boolean;
  /** The whole remaining way was re-planned once for this task and navigation revision. */
  replanned?: boolean;
}
interface Progress {
  path: SettlementPoint[];
  remaining: number;
  sampled: number;
  outcome: MovementOutcome;
}
const progress = new WeakMap<SettlementActor, Progress>();
/** Capture meaningful half-second sampling without duplicating the actor's saved route. */
export const saveNavigationRecovery = (actor: SettlementActor): NavigationRecoveryState | undefined => {
  const state = actor.navigationRecovery;
  if (!state) return undefined;
  const sample = progress.get(actor);
  return sample ? { ...state, sampler: { remaining: sample.remaining, sampled: sample.sampled,
    outcome: sample.outcome, pathMatchesCurrent: sample.path === actor.path } } : { ...state };
};
/** A stalled walker asks for a route repair after this long without journey progress. */
const REPAIR_AFTER_SECONDS = 5;
const remainingDistance = (actor: SettlementActor) => {
  let result = 0;
  let previous: SettlementPoint = actor;
  for (let index = actor.pathIndex; index < actor.path.length; index++) {
    const point = actor.path[index]!;
    result += DMath.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return result;
};
const stateFor = (actor: SettlementActor) => {
  let state = progress.get(actor);
  if (!state) {
    state = {
      path: actor.path,
      remaining: remainingDistance(actor),
      sampled: 0,
      outcome: "interaction"
    };
    progress.set(actor, state);
  }
  return state;
};
export const beginActorMovement = (actor: SettlementActor) => {
  stateFor(actor).outcome = "interaction";
};
export const recordMovementOutcome = (actor: SettlementActor, outcome: MovementOutcome) => {
  stateFor(actor).outcome = outcome;
};
export const movementOutcome = (actor: SettlementActor) => stateFor(actor).outcome;
/** Counted from the last load, so a reloaded and a resumed island record the same revisions (D3). */
const revisionFor = (context: SettlementContext) =>
  `${buildRevisionSinceLoad(context)}/${roadRevisionSinceLoad(context)}/${context.buildings.length}`;
export interface SavedNavigationRevisionAlias { actor: number; saved: string; actual: string }
const loadedRevisions = new WeakMap<SettlementActor, { saved: string; actual: string }>();
export const saveNavigationRevisionAliases = (context: SettlementContext): SavedNavigationRevisionAlias[] =>
  context.actors.flatMap(actor => { const value = loadedRevisions.get(actor);
    return value ? [{ actor: actor.uid, ...value }] : []; });
const actorRevision = (context: SettlementContext, actor: SettlementActor) => {
  const actual = revisionFor(context);
  const loaded = loadedRevisions.get(actor);
  return loaded?.actual === actual ? loaded.saved : actual;
};

/** Retain actors, tools, cargo and ownership on terminal failure; navigation edits permit a retry. */
export const holdNavigationFailure = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.navalOrder !== undefined &&
    NAVAL_DECK_PHASES.includes(actor.phase)) {
    actor.navigationRecovery = undefined;
    return false;
  }
  if (actor.job === "Soldier" && SOLDIER_FREE_PHASES.includes(actor.phase)) { actor.navigationRecovery = undefined; return false; }
  const state = actor.navigationRecovery;
  if (!state?.blocked) return false;
  const destination = actor.path.at(-1);
  if (!destination || state.task !== `${actor.phase}/${destination.x}/${destination.z}`) {
    actor.navigationRecovery = undefined;
    return false;
  }
  if (state.revision !== actorRevision(context, actor)) {
    state.blocked = false;
    state.attempts = 0;
    state.elapsed = 0;
    state.revision = actorRevision(context, actor);
    return false;
  }
  actor.action = "idle";
  return true;
};
const notifyFailure = (
  context: SettlementContext,
  actor: SettlementActor,
  state: NavigationRecoveryState
) => {
  if (state.notified) return;
  state.notified = true;
  context.options.onNavigationFailure?.({
    actorId: actor.uid,
    job: actor.job,
    building: actor.building,
    point: actor.path.at(-1) ?? { x: actor.x, z: actor.z },
    reason: "No reachable route",
    cargo: actor.ware
  });
};

/**
 * Owner 2026-11-07: a foot walker whose local repairs failed `STUCK_REPAIR_ATTEMPTS` times in a row
 * against a static obstacle re-plans its whole remaining way to the same destination, once per task
 * and navigation revision. The 512-visit local searches never find a long way round a built-up
 * block, so the walker repeated them for ever. Only the path changes, through the same repair as a
 * local detour; a destination off public ground, or no way found, leaves everything as it was.
 */
const replanStuckWalk = (
  context: SettlementContext, actor: SettlementActor, state: NavigationRecoveryState,
  outcome: MovementOutcome, destination: SettlementPoint, repair: (path: SettlementPoint[]) => void
) => {
  if (state.attempts < STUCK_REPAIR_ATTEMPTS || state.replanned || actor.mounted ||
    outcome !== "static-blocked") return;
  state.replanned = true;
  if (!isNavigationClear(context, destination)) return;
  const path = publicWalkPath(context, actor, destination);
  const end = path?.at(-1);
  if (!path || !end || end.x !== destination.x || end.z !== destination.z) return;
  repair(path);
};

const taskOf = (phase: string, destination: SettlementPoint) => `${phase}/${destination.x}/${destination.z}`;
/**
 * A12: the phase and destination a recovery task string was built from. Equal parts (by `===`) build
 * an equal string, so the per-tick task test needs no number formatting; anything else (a loaded
 * state, a changed task) compares the strings as before.
 */
const taskSources = new WeakMap<NavigationRecoveryState, { phase: string; x: number; z: number }>();
const isSameTask = (state: NavigationRecoveryState, phase: string, destination: SettlementPoint) => {
  const source = taskSources.get(state);
  if (source && source.phase === phase && source.x === destination.x && source.z === destination.z) return true;
  if (state.task !== taskOf(phase, destination)) return false;
  taskSources.set(state, { phase, x: destination.x, z: destination.z });
  return true;
};
/** Progress follows route length, so valid winding routes and equivalent repairs cannot fake a stall. */
export const updateNavigationRecovery = (
  context: SettlementContext,
  actor: SettlementActor,
  dt: number,
  repair: (path: SettlementPoint[]) => void,
  cancel: () => boolean
) => {
  if (actor.navalOrder !== undefined &&
    NAVAL_DECK_PHASES.includes(actor.phase)) {
    actor.navigationRecovery = undefined;
    return;
  }
  if (actor.job === "Soldier" && ["militaryField", "militaryLeaving"].includes(actor.phase)) { actor.navigationRecovery = undefined; return; }
  const sample = stateFor(actor);
  const destination = actor.path.at(-1);
  if (
    !actor.visible ||
    !destination ||
    actor.pathIndex >= actor.path.length ||
    actor.job === "Mount" ||
    // Ground detours would pull a cart off its stone road; carts recover through their own replan.
    actor.handcart?.state === "hitched"
  ) {
    actor.navigationRecovery = undefined;
    return;
  }
  const revision = actorRevision(context, actor);
  let state = actor.navigationRecovery;
  if (!state || !isSameTask(state, actor.phase, destination)) {
    state = {
      task: taskOf(actor.phase, destination),
      elapsed: 0,
      attempts: 0,
      revision,
      blocked: false,
      notified: false
    };
    taskSources.set(state, { phase: actor.phase, x: destination.x, z: destination.z });
    actor.navigationRecovery = state;
    sample.path = actor.path;
    sample.remaining = remainingDistance(actor);
    sample.sampled = 0;
  }
  if (state.revision !== revision) {
    state.revision = revision;
    state.attempts = 0;
    if (state.replanned) delete state.replanned;
  }
  if (
    ["interaction", "arrived", "door-queue", "stock-wait"].includes(sample.outcome) ||
    isManagedStorageArrival(context, actor)
  )
    return;
  sample.sampled += dt;
  state.elapsed += dt;
  if (sample.sampled < 0.5 - 1e-8) return;
  sample.sampled = 0;
  const remaining = remainingDistance(actor);
  if (sample.path !== actor.path) {
    sample.path = actor.path;
    sample.remaining = remaining;
  } else if (!actor.queueTarget && remaining < sample.remaining - 0.12) {
    sample.remaining = remaining;
    state.elapsed = 0;
    state.attempts = 0;
    state.notified = false;
  }
  if (actor.job === "Shipwright") return;
  // Two crowded/budget-limited repairs are a cooldown, not a permanent stop. A temporary
  // shoreline queue can disappear without changing the road or building graph revision.
  if (state.attempts >= STUCK_REPAIR_ATTEMPTS) {
    if (state.elapsed + 1e-8 < 18) return;
    state.attempts = 0;
    state.elapsed = REPAIR_AFTER_SECONDS;
  }
  if (state.elapsed + 1e-8 < REPAIR_AFTER_SECONDS || !requestNavigationRepair(context, actor)) return;
  // The actor stands still during these searches, so its own lanes are resolved once (A10b).
  const isOwnLane = ownDoorLaneProbe(context, actor);
  const allows = (point: SettlementPoint) => isOwnLane(point) || isOwnStockCourtyard(context, actor, point);
  const beachRoute = actor.job === "Fisher" && actor.target?.kind === "fish";
  const allowsBeach = beachRoute ? (point: SettlementPoint) => isFishingShoreStep(context, actor, point) : undefined;
  const blocked = (point: SettlementPoint) =>
    (actor.mounted && !isMountedNavigationClear(context, point)) ||
    (!allowsBeach?.(point) && !isNavigationFootprintClear(context, point, allows)) ||
    forEachNearbyTrafficActor(context, point, actor.mounted ? 2.1 : 1.25, (other) =>
      other !== actor && other.visible &&
      DMath.hypot(point.x - other.x, point.z - other.z) < actorSeparation(actor, other));
  // A static proof excludes people: a temporary queue must never cause task cancellation.
  const proof = searchGroundPath(context, actor, destination,
    actor.mounted ? point => !isMountedNavigationClear(context, point) : undefined,
    allows, 0.125, 512, allowsBeach);
  if (proof.status === "no-path") {
    if (!cancel()) {
      state.blocked = true;
      state.revision = actorRevision(context, actor);
      notifyFailure(context, actor, state);
    }
    return;
  }
  state.attempts++;
  for (const index of [actor.pathIndex + 1, actor.pathIndex + 3, actor.path.length - 1].filter(
    (index, position, values) => index < actor.path.length && values.indexOf(index) === position
  )) {
    const result = searchGroundPath(
      context,
      actor,
      actor.path[index]!,
      blocked,
      allows,
      0.125,
      512,
      allowsBeach
    );
    if (result.status !== "found") continue;
    repair([...result.path, ...actor.path.slice(index + 1)]);
    return;
  }
  if (!allowsBeach) replanStuckWalk(context, actor, state, sample.outcome, destination, repair);
};

/**
 * Loaded topology has a fresh graph revision even when the saved route is unchanged. A unit saved
 * frozen by a failed route proves it again at once instead of waiting for a road or building edit
 * (TRAFFIC-01): its task may have become reachable another way (e.g. a refilled output shelf).
 * The notification is kept, so a still-unreachable task does not warn the player twice. A save that
 * retains the revision epoch (D3) keeps the unit frozen as the running island does, so a reload
 * continues to the same state (EAI4-FOLLOWUP: a reload otherwise released a blocked forester).
 */
export const restoreNavigationRecovery = (context: SettlementContext, retainedRevisionEpoch = false,
  aliases?: readonly SavedNavigationRevisionAlias[]) => {
  if (aliases) for (const value of aliases) {
    const actor = context.actors.find(unit => unit.uid === value.actor)!;
    loadedRevisions.set(actor, { saved: value.saved, actual: value.actual });
  }
  for (const actor of context.actors) {
    const state = actor.navigationRecovery;
    if (!state) continue;
    if (state.sampler) progress.set(actor, { remaining: state.sampler.remaining,
      sampled: state.sampler.sampled, outcome: state.sampler.outcome,
      path: state.sampler.pathMatchesCurrent ? actor.path : [] });
    if (!retainedRevisionEpoch) loadedRevisions.set(actor, { saved: state.revision, actual: revisionFor(context) });
    if (!state.blocked || retainedRevisionEpoch) continue;
    Object.assign(state, { attempts: 0, blocked: false, elapsed: REPAIR_AFTER_SECONDS });
  }
};

export const navigationProgressSnapshot = (context: SettlementContext) =>
  context.actors
    .filter((actor) => actor.visible)
    .map((actor) => ({
      actorId: actor.uid,
      job: actor.job,
      phase: actor.phase,
      outcome: progress.get(actor)?.outcome ?? "interaction",
      elapsed: actor.navigationRecovery?.elapsed ?? 0,
      attempts: actor.navigationRecovery?.attempts ?? 0,
      blocked: actor.navigationRecovery?.blocked ?? false,
      queueWait: actor.queueWait ?? 0,
      cargo: actor.ware,
      target: actor.path.at(-1) ?? null
    }));
