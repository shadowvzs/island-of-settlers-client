import {
  EXPLOIT_RADIUS, HOME_ARRIVAL, INTENT_MUSTER_TICKS, MUSTER_RADIUS, MUSTER_TICKS, RAID_HIT_TICKS, RAID_LOSS_SHARE,
  REGROUP_TICKS, REGROUPED_MORALE, REGROUPED_SPREAD, SCOUT_ABORT_HEALTH, SCOUT_ARRIVAL
} from "../../balance/commander-director";
import type { SettlementPoint } from "../settlement-types";
import { distance, fastestOf, type ForceView } from "./director-forces";
import type {
  DirectorForce, DirectorMacro, DirectorMember, DirectorOrders, DirectorTarget, ForceHandover
} from "./director-types";

/**
 * The fixed methods (A14 plan §5.1, HTN-like task lists) of the director's macros. A method runs once per
 * decision of its force: it issues the running task's orders and moves to the next task when the task is done.
 * Orders are re-issued only on entering a task, so a decision never churns marches.
 */

/** A method's result: keep running, macro finished (the force holds and re-chooses), or force released. */
export type MethodOutcome = "keep" | "done" | "release" | { switch: DirectorMacro };

export interface MethodContext {
  faction: number;
  now: number;
  force: DirectorForce;
  members: readonly DirectorMember[];
  view: ForceView;
  orders: DirectorOrders;
  targets: readonly DirectorTarget[];
  scoutGoals: (from: SettlementPoint) => readonly SettlementPoint[];
  /** The nearest known enemy near the force's home (defend). */
  threat?: SettlementPoint;
  handover?: ForceHandover;
  /** An attack intent's strength goal (×100): the muster also waits for it, up to `INTENT_MUSTER_TICKS`. */
  musterGoal?: number;
}

const enterTask = (force: DirectorForce, task: number, now: number) => {
  force.task = task;
  force.since = now;
};

const memberOf = (context: MethodContext, uid: number | undefined) =>
  uid === undefined ? undefined : context.members.find(member => member.uid === uid);

/** Ready members (not wavering or broken) except `skip`. */
const readyExcept = (context: MethodContext, skip?: number) => context.view.ready.filter(uid => uid !== skip);

const marchAll = (
  context: MethodContext, ids: readonly number[], point: SettlementPoint, mode: "move" | "attackMove"
) =>
  ids.length > 0 && context.orders.march(ids, point, context.faction, mode);

/** Hold: stand at the staging point; the tactical commander defends from there. */
const hold = (context: MethodContext): MethodOutcome => {
  if (context.force.task === 0) {
    marchAll(context, readyExcept(context), context.force.staging, "move");
    enterTask(context.force, 1, context.now);
  }
  return "keep";
};

const sendScout = (context: MethodContext) => {
  const { force } = context;
  const goals = context.scoutGoals(force.staging);
  const scout = fastestOf(context.members, context.view.ready);
  if (!scout || !goals.length) return "done";
  force.scout = scout.uid;
  force.visited = 0;
  marchAll(context, [scout.uid], goals[0]!, "move");
  marchAll(context, readyExcept(context, scout.uid), force.staging, "move");
  enterTask(force, 1, context.now);
  return "keep";
};

const scoutHome = (context: MethodContext, scout: number) => {
  marchAll(context, [scout], context.force.staging, "move");
  enterTask(context.force, 2, context.now);
  return "keep" as const;
};

/** Scout task 1: visit the goals in turn; turn back when hurt or when every goal was visited. */
const visitGoals = (context: MethodContext): MethodOutcome => {
  const { force } = context, scout = memberOf(context, force.scout);
  if (!scout) {
    force.scout = undefined;
    enterTask(force, 0, context.now);
    return "keep";
  }
  if (scout.health < SCOUT_ABORT_HEALTH) return scoutHome(context, scout.uid);
  const goals = context.scoutGoals(force.staging), visited = force.visited ?? 0;
  const goal = goals[visited];
  if (goal && scout.marching && distance(scout, goal) > SCOUT_ARRIVAL) return "keep";
  force.visited = visited + 1;
  const next = goals[visited + 1];
  if (!next) return scoutHome(context, scout.uid);
  marchAll(context, [scout.uid], next, "move");
  return "keep";
};

/** Scout: detach the fastest soldier, visit ≤ 3 goals, return to the staging point. */
const scout = (context: MethodContext): MethodOutcome => {
  const { force } = context;
  if (force.task === 0) return sendScout(context);
  if (force.task === 1) return visitGoals(context);
  const back = memberOf(context, force.scout);
  if (back && back.marching && distance(back, force.staging) > MUSTER_RADIUS) return "keep";
  force.scout = undefined;
  force.visited = undefined;
  return "done";
};

const mustered = (context: MethodContext) => context.members.every(member =>
  !context.view.ready.includes(member.uid) || distance(member, context.force.staging) <= MUSTER_RADIUS);

/** Strike/raid task 1: the hit. A colony force is handed back to the colony's raid code. */
const hit = (context: MethodContext): MethodOutcome => {
  const { force } = context, ids = readyExcept(context);
  if (force.kind === "colony" && context.handover) {
    context.handover(force.members, force.target);
    return "release";
  }
  const target = context.targets.find(entry => entry.uid === force.target);
  if (force.goal) marchAll(context, ids, force.goal, "attackMove");
  else if (target && !(ids.length && context.orders.siege(ids, target.uid, context.faction)))
    marchAll(context, ids, target, "attackMove");
  enterTask(force, 2, context.now);
  return "keep";
};

/** Strike/raid task 2: press the attack; exploit the next known target near a fallen one, else withdraw. */
const press = (context: MethodContext, raid: boolean): MethodOutcome => {
  const { force, now, view } = context;
  if (raid && (now - force.since >= RAID_HIT_TICKS || view.strength < force.start * (1 - RAID_LOSS_SHARE)))
    return { switch: "withdraw" };
  if (force.goal) return "keep";
  if (context.targets.some(entry => entry.uid === force.target)) return "keep";
  const from = view.centre;
  const next = context.targets.find(entry => distance(entry, from) <= EXPLOIT_RADIUS);
  if (!next) return { switch: "withdraw" };
  force.target = next.uid;
  return hit(context);
};

/** Strike and raid: muster at the staging point, hit the known target, press or exploit, else withdraw. */
const strike = (context: MethodContext, raid: boolean): MethodOutcome => {
  const { force, now } = context;
  if (force.task === 0) {
    if (force.kind === "wave") return hit(context);
    if (now === force.since) marchAll(context, readyExcept(context), force.staging, "move");
    const { musterGoal } = context;
    const gathered = mustered(context) && context.view.strength >= (musterGoal ?? 0);
    const limit = musterGoal === undefined ? MUSTER_TICKS : INTENT_MUSTER_TICKS;
    if (!gathered && now - force.since < limit) return "keep";
    return hit(context);
  }
  return force.task === 1 ? hit(context) : press(context, raid);
};

/** Regroup: gather at the staging point until close and steady again (≤ 30 s). */
const regroup = (context: MethodContext): MethodOutcome => {
  const { force, now, view } = context;
  if (force.task === 0) {
    marchAll(context, readyExcept(context), force.staging, "move");
    enterTask(force, 1, now);
    return "keep";
  }
  const gathered = view.spread < REGROUPED_SPREAD && view.moraleMean >= REGROUPED_MORALE;
  return gathered || now - force.since >= REGROUP_TICKS ? "done" : "keep";
};

/** Defend: the force goes for the known enemy near its home; the tactical commander fights it there. */
const defend = (context: MethodContext): MethodOutcome => {
  const { force } = context;
  if (force.kind === "colony" && context.handover) {
    context.handover(force.members, undefined);
    return "release";
  }
  if (force.task === 0 && context.threat) {
    marchAll(context, readyExcept(context), context.threat, "attackMove");
    enterTask(force, 1, context.now);
  }
  return "keep";
};

/** Withdraw: everyone walks home; a member at home goes into an own building there (or leaves the force). */
const withdraw = (context: MethodContext): MethodOutcome => {
  const { force } = context;
  if (force.task === 0) {
    marchAll(context, readyExcept(context), force.home, "move");
    enterTask(force, 1, context.now);
    return "keep";
  }
  const home = context.members.filter(member => distance(member, force.home) <= HOME_ARRIVAL || !member.marching);
  if (force.kind === "colony" && context.handover && home.length) context.handover(home.map(m => m.uid), undefined);
  else for (const member of home) context.orders.rejoin(member.uid, context.faction);
  force.members = force.members.filter(uid => !home.some(member => member.uid === uid));
  return force.members.length ? "keep" : "release";
};

/** Runs the macro's method for one decision. */
export const runMethod = (macro: DirectorMacro, context: MethodContext): MethodOutcome => {
  switch (macro) {
    case "scout": return scout(context);
    case "raid": return strike(context, true);
    case "strike": return strike(context, false);
    case "regroup": return regroup(context);
    case "defend": return defend(context);
    case "withdraw": return withdraw(context);
    default: return hold(context);
  }
};
