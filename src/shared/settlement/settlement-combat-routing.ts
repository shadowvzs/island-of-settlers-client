import { DMath } from "../math/deterministic-math";
import type { MilitaryCombatant } from "./military-combat-rules";
import { MOUNTED_SETTLE_RADIUS } from "./military-formation";
import { followCorridor, militaryLegPath } from "./military-routing";
import type { CombatCore } from "./settlement-combat-core";
import { moveActor, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/** Within this distance (tiles) of its point next to a moving foe, a soldier heads straight for it. */
const CHASE_LEG = 4;
/** Marching routes planned per tick (spreads a whole army's searches over a few ticks). */
const MARCH_PLANS_PER_TICK = 3;
/** A long march regroups (new places and paces) once its first soldier is this close (tiles). */
const REGROUP_RADIUS = 20;

/** New places and paces for a long march's group from where its members are now. */
type Regroup = (uids: readonly number[], destination: SettlementPoint) => void;

/** How field soldiers plan, walk, stand and arrive; `beginTick` resets the per-tick route budget. */
export const createCombatRouting = ({
  arriving, context, marches, memoryOf, movement, settling, steering
}: CombatCore, regroup: Regroup) => {
  let legPlans = 0;
  /** Routes the soldier towards `target`; false only when no way leads there at all. */
  const plan = (actor: SettlementActor, state: MilitaryCombatant, target: SettlementPoint) => {
    // Shared flow fields guide group marches; A* handles individual and short routes.
    if (movement.plan(actor, state, target)) return true;
    const leg = marches.nextLeg(actor, target), goal = leg?.goal, final = actor.path.at(-1);
    // A soldier standing aside for traffic (idle, shoulder target) keeps its route: re-planning
    // would cancel the yield and walk it straight back into the blocker (reverse jitter).
    if (goal && actor.pathIndex < actor.path.length && final &&
      DMath.hypot(final.x - goal.x, final.z - goal.z) < .01) return true;
    if ((state.routeAge ?? 0) > 0) return true;
    // A group marching in step reaches its corridor points (or regroups) together: those routes are
    // planned a few per tick (the current leg is still walked meanwhile), not all in one tick.
    const marching = goal !== target || state.order === "move";
    if (marching && legPlans >= MARCH_PLANS_PER_TICK) return true;
    if (marching) legPlans++;
    state.routeAge = .5;
    const path = leg && (leg.via.length > 1 ? followCorridor(context, actor, leg.via, actor.mounted)
      : militaryLegPath(context, actor, leg.goal, actor.mounted));
    if (path) { setActorPath(actor, path, "militaryField"); return true; }
    actor.path = []; actor.pathIndex = 0; actor.action = "idle";
    // A leg that cannot be walked is passed over; the next one is tried on the following tick.
    if (!marches.skipLeg(actor.uid)) return false;
    state.routeAge = 0;
    return true;
  };
  const stand = (actor: SettlementActor) => {
    actor.path = []; actor.pathIndex = 0; actor.action = "idle"; steering.halt(actor.uid);
  };
  /** One tick along the path: field soldiers steer round each other, others walk the worker way. */
  const move = (actor: SettlementActor, dt: number) =>
    actor.phase === "militaryField" && actor.visible ? steering.steer(actor, dt) : moveActor(context, actor, dt);
  const walk = (actor: SettlementActor, dt: number) => {
    if (actor.pathIndex >= actor.path.length && !actor.queueTarget) {
      actor.action = "idle"; steering.halt(actor.uid); return;
    }
    move(actor, dt);
  };
  const arrive = (actor: SettlementActor, state: MilitaryCombatant) => {
    state.destination = undefined; actor.path = []; actor.pathIndex = 0; actor.queueTarget = undefined;
    actor.queueWait = 0; state.marchSpeed = undefined; settling.forget(actor.uid); movement.leave(actor.uid);
    // A move, retreat or rally ends as a guard at the place reached; an attack move keeps seeking.
    const memory = memoryOf(actor.uid);
    if (state.order === "move" || state.order === "retreat" || memory.guardOnArrival) state.order = undefined;
    memory.guardOnArrival = undefined;
    state.rallyRunning = undefined;
    memory.anchor = { x: actor.x, z: actor.z }; memory.ignored = undefined;
  };
  /** Walks on to the ordered place, or settles close by when comrades already fill the way there. */
  const marchTo = (actor: SettlementActor, state: MilitaryCombatant, ordered: SettlementPoint, dt: number) => {
    const block = arriving.approach(actor.uid, actor, REGROUP_RADIUS);
    if (block) regroup(block.uids, block.destination);
    const destination = state.destination ?? ordered;
    const progress = settling.progress(actor.uid, actor, destination, dt,
      actor.mounted ? MOUNTED_SETTLE_RADIUS : undefined);
    if (progress === "replan") { actor.path = []; actor.pathIndex = 0; state.routeAge = 0; }
    // A place no way leads to (taken by a rock or a building since) ends the march where it stands.
    if (progress !== "settle" && plan(actor, state, destination)) return true;
    arrive(actor, state); actor.action = "idle";
    return false;
  };
  /**
   * Heads for a point near a moving foe: the last straight leg follows the point every tick (a route
   * is only searched every half second, and a stale end point would stop the chase short).
   */
  const chase = (actor: SettlementActor, state: MilitaryCombatant, point: SettlementPoint) => {
    plan(actor, state, point);
    if (actor.pathIndex !== actor.path.length - 1 ||
      DMath.hypot(point.x - actor.x, point.z - actor.z) > CHASE_LEG) return;
    actor.path[actor.pathIndex] = { x: point.x, z: point.z };
  };
  const beginTick = () => { legPlans = 0; };
  return { arrive, beginTick, chase, marchTo, move, plan, stand, walk };
};

export type CombatRouting = ReturnType<typeof createCombatRouting>;
