import { DMath } from "../math/deterministic-math";
import type { MilitaryCombatant } from "./military-combat-rules";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import { isSingleLeg } from "./military-long-routes";
import { militaryCrowdPath } from "./military-routing";
import { isOwnDoorLane } from "./settlement-entrance";
import { isMountedNavigationClear, isNavigationClear, searchGroundPath } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import { nearbyTrafficActors } from "./settlement-person-index";
import { actorSeparation, isTrafficPassThrough, isTrafficSegmentClear, setQueueTarget } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

interface Watch { closest: number; elapsed: number; level: number; target: SettlementPoint }
export type MilitaryStuckSave = SavedEntries<Watch>;
interface Obstacle { initial: number; separation: number; x: number; z: number }
/**
 * How a search treats bodies. `local` (L2): every body blocks, the door lane is open, half-tile
 * nodes. `crowd` (L3, like `militaryCrowdPath`): only resting soldiers and horses block, a soldier
 * pressed into one may move away from it, quarter-tile nodes (narrow shores and gangway feet).
 */
interface SearchMode { crowd: boolean; step: number; visits: number }
const LOCAL_SEARCH: SearchMode = { crowd: false, step: .5, visits: 128 };

/** Ladder steps (seconds without gaining ground): side-step, local repath, free spot or re-plan, warning. */
const SIDE_STEP_SECONDS = 1;
const REPATH_SECONDS = 2.5;
const REPLAN_SECONDS = 5;
const WARNING_SECONDS = 10;
/** Searches (L2 and L3) across all soldiers per tick. */
const REPAIRS_PER_TICK = 2;
/** Bodies further than this (tiles; a horse's length plus margin) never block a point. */
const BODY_REACH = 2.2;
/** A bounded search stays near its line: bodies further than this off it are not collected. */
const SEARCH_MARGIN = 3;
/** L3 searches: each free spot near the goal, and the re-plan round the crowd (an unbounded one took 40+ ms). */
const SPOT_SEARCH: SearchMode = { crowd: true, step: .25, visits: 1500 };
const REPLAN_SEARCH: SearchMode = { crowd: true, step: .25, visits: 6000 };
/**
 * A rider's search visit samples a horse's clearance along every edge (a few times a walker's cost), so its
 * L3 searches get smaller budgets (counts, so the outcome never depends on the machine): its worst L3 step
 * stays within a few milliseconds instead of 4 x 1500 + 6000 mounted visits (over 100 ms before the fast path).
 */
const MOUNTED_SPOT_SEARCH: SearchMode = { ...SPOT_SEARCH, step: .5, visits: 400 };
const MOUNTED_REPLAN_SEARCH: SearchMode = { ...REPLAN_SEARCH, step: .5, visits: 1500 };
/** Free spots near the goal whose path is searched in one L3 step (a failed search is the costly part). */
const SPOT_PATH_TRIES = 4;
const SPOT_RADII = [.5, 1, 2, 3];
const SPOT_ANGLES = 8;
const NEAR_GOAL = 3;

/**
 * Soldier recovery (battle AI plan, Phase 2 stuck ladder): never cancels orders, cargo or population,
 * and never parks a unit in a door. Every search is bounded and collects the bodies near its line once,
 * so a stuck soldier in a crowded battle costs a fraction of a millisecond (it used to cost 40+ ms).
 */
export const createMilitaryStuckRecovery = (context: SettlementContext) => {
  const watches = new Map<number, Watch>();
  let repairs = REPAIRS_PER_TICK;
  let warnings = 0;
  const isBody = (actor: SettlementActor, other: SettlementActor) =>
    other !== actor && other.visible && !isTrafficPassThrough(context, actor, other);
  /** A single point: another body stands too close (or a rider's horse does not fit). */
  const blocked = (actor: SettlementActor, point: SettlementPoint) =>
    (actor.mounted && !isMountedNavigationClear(context, point)) ||
    nearbyTrafficActors(context, point, BODY_REACH).some(other => isBody(actor, other) &&
      DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(actor, other));
  const isResting = (other: SettlementActor) =>
    (other.mounted || other.job === "Soldier") && other.action === "idle";
  /** The bodies a search from `actor` to `to` can meet, collected once. */
  const obstaclesNear = (actor: SettlementActor, to: SettlementPoint, crowd: boolean): Obstacle[] => {
    const minX = Math.min(actor.x, to.x) - SEARCH_MARGIN, maxX = Math.max(actor.x, to.x) + SEARCH_MARGIN;
    const minZ = Math.min(actor.z, to.z) - SEARCH_MARGIN, maxZ = Math.max(actor.z, to.z) + SEARCH_MARGIN;
    return context.actors.flatMap(other => {
      if (other.x < minX || other.x > maxX || other.z < minZ || other.z > maxZ || !isBody(actor, other) ||
        (crowd && !isResting(other))) return [];
      return [{ initial: DMath.hypot(actor.x - other.x, actor.z - other.z), separation: actorSeparation(actor, other),
        x: other.x, z: other.z }];
    });
  };
  /** A body blocks a search point; in a crowd search a soldier pressed into one may move away from it. */
  const searchBlocked = (actor: SettlementActor, obstacles: readonly Obstacle[], crowd: boolean) =>
    (point: SettlementPoint) => (actor.mounted && !isMountedNavigationClear(context, point)) ||
      obstacles.some(body => {
        const distance = DMath.hypot(point.x - body.x, point.z - body.z);
        if (distance >= body.separation) return false;
        return !crowd || body.initial >= body.separation || distance <= body.initial + 1e-8;
      });
  const searchPath = (actor: SettlementActor, to: SettlementPoint, { crowd, step, visits }: SearchMode) =>
    searchGroundPath(context, actor, to, searchBlocked(actor, obstaclesNear(actor, to, crowd), crowd),
      crowd ? undefined : point => isOwnDoorLane(context, actor, point), step, visits).path;

  /** L1: a small step to the less crowded side. */
  const sideStep = (actor: SettlementActor, target: SettlementPoint) => {
    const dx = target.x - actor.x, dz = target.z - actor.z, span = DMath.hypot(dx, dz) || 1;
    for (const side of [1, -1]) {
      const point = { x: actor.x - dz / span * .6 * side, z: actor.z + dx / span * .6 * side };
      if (!isNavigationClear(context, point) || blocked(actor, point) ||
        !isTrafficSegmentClear(context, actor, point, true)) continue;
      setQueueTarget(actor, point, "proactive"); return;
    }
  };
  /** L2: a short way round the bodies to a waypoint a little ahead. */
  const repath = (actor: SettlementActor, target: SettlementPoint) => {
    const index = Math.min(actor.pathIndex + 3, actor.path.length - 1);
    const path = searchPath(actor, actor.path[index] ?? target, LOCAL_SEARCH);
    if (path) setActorPath(actor, [...path, ...actor.path.slice(index + 1)], actor.phase);
  };
  /** L3 near the goal: the nearest free spot within 3 tiles that a short search reaches. */
  const freeSpotNear = (actor: SettlementActor, target: SettlementPoint) => {
    let tries = 0;
    const mode = actor.mounted ? MOUNTED_SPOT_SEARCH : SPOT_SEARCH;
    for (const radius of SPOT_RADII) for (let angle = 0; angle < SPOT_ANGLES; angle++) {
      const heading = angle * Math.PI * 2 / SPOT_ANGLES;
      const point = { x: target.x + DMath.cos(heading) * radius, z: target.z + DMath.sin(heading) * radius };
      if (!isNavigationClear(context, point) || blocked(actor, point)) continue;
      const path = searchPath(actor, point, mode);
      if (path) return { path, point };
      if (++tries >= SPOT_PATH_TRIES) return undefined;
    }
    return undefined;
  };
  /** L3: near the goal take a free spot by it, otherwise re-plan round the crowd (bounded). */
  const replan = (actor: SettlementActor, state: MilitaryCombatant, target: SettlementPoint) => {
    if (actor.phase === "militaryLeaving" && isOwnDoorLane(context, actor, actor)) return;
    // A walker also takes a free spot by an occupied goal from afar; a rider only near it (each failed
    // mounted spot search is costly, and far from the goal the crowd in between is what stops it).
    const near = DMath.hypot(actor.x - target.x, actor.z - target.z) <= NEAR_GOAL ||
      (!actor.mounted && actor.phase === "militaryField" && blocked(actor, target));
    const spot = near ? freeSpotNear(actor, target) : undefined;
    if (spot) {
      state.destination = spot.point; state.routeAge = .5; setActorPath(actor, spot.path, actor.phase); return;
    }
    // Across the island the corridor route is cheap; within one leg a bounded search round the crowd.
    const path = isSingleLeg(actor, target)
      ? searchPath(actor, target, actor.mounted ? MOUNTED_REPLAN_SEARCH : REPLAN_SEARCH)
      : militaryCrowdPath(context, actor, target);
    if (path) { setActorPath(actor, path, actor.phase); state.routeAge = .5; }
  };
  const watchOf = (actor: SettlementActor, target: SettlementPoint) => {
    const watch = watches.get(actor.uid);
    if (watch && DMath.hypot(watch.target.x - target.x, watch.target.z - target.z) <= .1) return watch;
    const fresh = { closest: DMath.hypot(target.x - actor.x, target.z - actor.z), elapsed: 0, level: 0,
      target: { ...target } };
    watches.set(actor.uid, fresh);
    return fresh;
  };
  /** One rung per tick: the next level once its time has come (searches share the tick's budget). */
  const climb = (actor: SettlementActor, state: MilitaryCombatant, target: SettlementPoint, watch: Watch) => {
    if (watch.elapsed >= SIDE_STEP_SECONDS && watch.level < 1) { watch.level = 1; sideStep(actor, target); }
    if (watch.elapsed < REPATH_SECONDS || !repairs) return;
    if (watch.level < 2) { repairs--; watch.level = 2; repath(actor, target); return; }
    if (watch.elapsed >= REPLAN_SECONDS && watch.level < 3) {
      repairs--; watch.level = 3; replan(actor, state, target);
    }
    // L4: counted (tests assert it never happens), then the ladder retries from the repath.
    if (watch.elapsed >= WARNING_SECONDS) { warnings++; watch.elapsed = REPATH_SECONDS; watch.level = 1; }
  };
  const update = (actor: SettlementActor, state: MilitaryCombatant, dt: number) => {
    const target = state.destination ?? (actor.phase === "militaryLeaving" ? actor.path.at(-1) : undefined);
    const busy = state.target !== undefined || (state.siege !== undefined && actor.phase !== "militaryLeaving") ||
      state.attackTime;
    if (!actor.visible || !target || busy) { watches.delete(actor.uid); return; }
    const watch = watchOf(actor, target);
    const distance = DMath.hypot(target.x - actor.x, target.z - actor.z);
    // Shoulder yields can move back and forth forever without gaining ground towards the order.
    if (distance < watch.closest - .12) {
      watch.closest = distance; watch.elapsed = 0; watch.level = 0; return;
    }
    watch.elapsed += dt;
    climb(actor, state, target, watch);
  };
  return {
    beginTick: () => { repairs = REPAIRS_PER_TICK; },
    clear: () => { watches.clear(); warnings = 0; },
    save: (): MilitaryStuckSave => saveEntries(watches),
    restore: (saved: MilitaryStuckSave | undefined) => restoreEntries(watches, saved),
    forget: (uid: number) => watches.delete(uid),
    metrics: () => ({ warnings, watched: watches.size }),
    update
  };
};
