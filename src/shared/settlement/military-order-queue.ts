import { admitPlayerOrder } from "../script-world/script-order-guard";
import { MILITARY_QUEUE_MAX_STEPS, MILITARY_QUEUE_PHASES, MILITARY_QUEUE_STRAGGLER_SECONDS } from "./constants";
import {
  copyQueuedStep, type CurrentMilitaryStep, isMarchBusy, isQueuedMilitaryStep, memberFinished,
  type MilitaryOrderQueueSave, type MilitaryOrderQueueView, mostFinished, type QueuedMilitaryStep,
  type QueueMilitaryRefusal, type QueueMilitaryResult
} from "./military-order-queue-rules";
import type { TargetMilitaryOutcome, TargetMilitaryRefusal } from "./settlement-combat-chase";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

interface QueueOrders {
  commandAccepted: (ids: readonly number[], point: SettlementPoint, mode: QueuedGroundMode) => number[];
  targetAccepted: (ids: readonly number[], uid: number) => TargetMilitaryOutcome;
  siegeAccepted: (ids: readonly number[], uid: number) => readonly number[];
  garrisonAccepted: (ids: readonly number[], uid: number) => readonly number[];
  returnAccepted: (ids: readonly number[], uid: number) => readonly number[];
  boardAccepted: (ids: readonly number[], ship: number) => readonly number[];
}
type QueuedGroundMode = Extract<QueuedMilitaryStep, { kind: "ground" }>["mode"];

interface QueueCombat {
  actorById: (uid: number) => SettlementActor | undefined;
  /** A member of a large order still waiting for its paced turn (in a building, or standing). */
  marchPending: (uid: number) => boolean;
  /** Why the player cannot chase `uid` now (null: it is in sight and on land). */
  chaseRefusal: (uid: number) => TargetMilitaryRefusal | null;
}

interface IssueOutcome { accepted: readonly number[]; reason: QueueMilitaryRefusal }

const copyQueue = (queue: MilitaryOrderQueueSave): MilitaryOrderQueueSave => ({
  current: queue.current.kind === "active" ? { kind: "active" } : copyQueuedStep(queue.current),
  id: queue.id,
  pending: queue.pending.map(copyQueuedStep),
  ...(queue.straggle ? { straggle: queue.straggle } : {})
});

/**
 * Shift queue (owner 2026-11-17, phase 1: ground points and enemy units). A queue belongs to the group of player
 * soldiers whose combat state names it. The next step starts only when the current one is finished for the whole
 * group (or for most of it after a straggler wait). It is issued through the ordinary ground / targetMilitary
 * orders, so formation, pace and the queued march for large groups stay those orders' own. Any other march
 * (a plain right click included) takes a soldier out of its queue; a queue without members is dropped.
 */
export const createMilitaryOrderQueues = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, orders: QueueOrders, combat: QueueCombat
) => {
  const queues = new Map<number, MilitaryOrderQueueSave>();
  /**
   * A player soldier that marches with a group now: alive, not besieging or going home, outside on land or
   * waiting for its paced turn to leave a building.
   */
  const marchable = (soldier: SettlementSoldier) => {
    const state = soldier.combat;
    if (!state || state.faction !== 0 || state.hp <= 0) return false;
    if (state.siege !== undefined || state.returnToStorage) return false;
    const actor = combat.actorById(soldier.actor);
    if (!actor || actor.navalOrder !== undefined) return false;
    return MILITARY_QUEUE_PHASES.has(actor.phase) || combat.marchPending(soldier.actor);
  };
  /** Each queue's members in soldier order; `prune` takes soldiers that can no longer march with it out. */
  const collectMembers = (prune: boolean) => {
    const members = new Map<number, number[]>();
    for (const soldier of soldiers.values()) {
      const id = soldier.combat?.queue;
      if (id === undefined) continue;
      const current = queues.get(id)?.current;
      const special = current !== undefined && !["active", "ground", "target"].includes(current.kind);
      if (!queues.has(id) || (!special && !marchable(soldier)) || !soldier.combat || soldier.combat.hp <= 0) {
        if (prune) soldier.combat!.queue = undefined;
        continue;
      }
      const group = members.get(id);
      if (group) group.push(soldier.actor);
      else members.set(id, [soldier.actor]);
    }
    return members;
  };
  const enlist = (ids: readonly number[], id: number | undefined) => {
    for (const uid of ids) {
      const state = soldiers.get(uid)?.combat;
      if (state) state.queue = id;
    }
  };
  /**
   * Starts one step with the ordinary orders. A target the soldiers cannot lock onto attack-moves to where it
   * stood (the right click's fallback); when advancing, a target that is already gone is skipped instead.
   */
  const issue = (ids: readonly number[], step: QueuedMilitaryStep, skipMissing: boolean): IssueOutcome => {
    const point = { x: step.x, z: step.z };
    if (step.kind === "ground") return { accepted: orders.commandAccepted(ids, point, step.mode), reason: "noTroops" };
    if (step.kind === "siege") return { accepted: [...orders.siegeAccepted(ids, step.building)], reason: "noTroops" };
    if (step.kind === "garrison")
      return { accepted: [...orders.garrisonAccepted(ids, step.building)], reason: "noTroops" };
    if (step.kind === "store")
      return { accepted: [...orders.returnAccepted(ids, step.building)], reason: "noTroops" };
    if (step.kind === "board")
      return { accepted: [...orders.boardAccepted(ids, step.ship)], reason: "noTroops" };
    if (step.kind !== "target") return { accepted: [], reason: "invalidStep" };
    const outcome = orders.targetAccepted(ids, step.uid);
    if (outcome.ok) return { accepted: outcome.accepted, reason: "noTroops" };
    if (outcome.reason === "noTroops" || (skipMissing && outcome.reason === "targetMissing"))
      return { accepted: [], reason: outcome.reason };
    return { accepted: orders.commandAccepted(ids, point, "attackMove"), reason: outcome.reason };
  };
  const create = (members: readonly number[], current: CurrentMilitaryStep, pending: QueuedMilitaryStep[]) => {
    let id = 1;
    for (const key of queues.keys()) if (key >= id) id = key + 1;
    queues.set(id, { current, id, pending });
    enlist(members, id);
  };
  /** Whether the group finished its current step; counts the straggler wait while most of it has. */
  const stepFinished = (queue: MilitaryOrderQueueSave, group: readonly number[], dt: number) => {
    let finished = 0;
    for (const uid of group) {
      const soldier = soldiers.get(uid)!;
      if (memberFinished(soldier.combat!, queue.current, soldier, combat.actorById(uid))) finished++;
    }
    if (finished === group.length) return true;
    if (!mostFinished(finished, group.length)) { queue.straggle = undefined; return false; }
    const straggle = (queue.straggle ?? 0) + dt;
    if (straggle >= MILITARY_QUEUE_STRAGGLER_SECONDS) return true;
    queue.straggle = straggle;
    return false;
  };
  /** The next step that some member accepts becomes current; with none left the queue ends. */
  const advance = (queue: MilitaryOrderQueueSave, group: readonly number[]) => {
    queue.straggle = undefined;
    const ids = admitPlayerOrder(context, group);
    while (queue.pending.length) {
      const step = queue.pending.shift()!;
      const { accepted } = issue(ids, step, true);
      if (!accepted.length) continue;
      queue.current = step;
      enlist(accepted, queue.id);
      return;
    }
    enlist(group, undefined);
    queues.delete(queue.id);
  };
  const update = (dt: number) => {
    if (!queues.size) return;
    const members = collectMembers(true);
    // Deleting the visited entry while iterating a Map is safe.
    for (const queue of queues.values()) {
      const group = members.get(queue.id);
      if (!group) { queues.delete(queue.id); continue; }
      if (stepFinished(queue, group, dt)) advance(queue, group);
    }
  };
  /** The queue every marchable soldier of the selection marches with, when it is exactly that group. */
  const sharedQueue = (marching: readonly number[]) => {
    const id = soldiers.get(marching[0]!)?.combat?.queue;
    if (id === undefined || !queues.has(id)) return undefined;
    if (!marching.every(uid => soldiers.get(uid)?.combat?.queue === id)) return undefined;
    return collectMembers(false).get(id)?.length === marching.length ? queues.get(id) : undefined;
  };
  /**
   * queueMilitaryOrder: appends `step` to the selection's queue when the selection is exactly its group. Else a
   * busy selection keeps its current order and queues the step after it; an idle one starts the step now.
   */
  const queue = (ids: readonly number[], value: unknown): QueueMilitaryResult => {
    if (!isQueuedMilitaryStep(value)) return { ok: false, reason: "invalidStep" };
    const step = copyQueuedStep(value);
    const selected = [...new Set(ids)];
    const marching = selected.filter(uid => {
      const soldier = soldiers.get(uid);
      return soldier !== undefined && marchable(soldier);
    });
    const queued = selected.filter(uid => soldiers.get(uid)?.combat?.queue !== undefined);
    const shared = queued.length ? sharedQueue(queued) : undefined;
    if (shared) {
      if (shared.pending.length >= MILITARY_QUEUE_MAX_STEPS) return { ok: false, reason: "queueFull" };
      shared.pending.push(step);
      return { immediate: false, ok: true, waiting: shared.pending.length };
    }
    if (marching.some(uid => isMarchBusy(soldiers.get(uid)!.combat!))) {
      create(marching, { kind: "active" }, [step]);
      return { immediate: false, ok: true, waiting: 1 };
    }
    const { accepted, reason } = issue(selected, step, false);
    if (!accepted.length) return { ok: false, reason };
    create(accepted, step, []);
    return { immediate: true, ok: true, waiting: 0 };
  };
  /** Where a step's marker stands: a visible target's body, else the queued point. */
  const stepPoint = (step: QueuedMilitaryStep) => {
    if (step.kind !== "target" || combat.chaseRefusal(step.uid) !== null) return { x: step.x, z: step.z };
    const body = combat.actorById(step.uid)!;
    return { x: body.x, z: body.z };
  };
  /** The group's current order: the mean of the members' destinations and their mode (none while all stand). */
  const activeStep = (group: readonly number[]) => {
    let x = 0, z = 0, count = 0;
    let mode: QueuedGroundMode | undefined;
    for (const uid of group) {
      const state = soldiers.get(uid)?.combat;
      if (!state?.destination) continue;
      x += state.destination.x; z += state.destination.z; count++;
      mode ??= state.order;
    }
    return count ? { kind: "ground" as const, mode: mode ?? "attackMove", x: x / count, z: z / count } : undefined;
  };
  const viewSteps = (queue: MilitaryOrderQueueSave, group: readonly number[]) => {
    const steps: MilitaryOrderQueueView["steps"] = [];
    const current = queue.current.kind === "active" ? activeStep(group) : undefined;
    if (current) steps.push(current);
    for (const step of queue.current.kind === "active" ? queue.pending : [queue.current, ...queue.pending])
      steps.push({ kind: step.kind, ...(step.kind === "ground" ? { mode: step.mode } : {}), ...stepPoint(step) });
    return steps;
  };
  /** The queues for the waypoint display (a read: nothing changes). */
  const snapshot = (): MilitaryOrderQueueView[] => {
    if (!queues.size) return [];
    const members = collectMembers(false);
    return [...queues.values()].flatMap(queue => {
      const group = members.get(queue.id);
      return group ? [{ id: queue.id, members: group, steps: viewSteps(queue, group) }] : [];
    });
  };
  return {
    queue, snapshot, update,
    save: () => queues.size ? [...queues.values()].map(copyQueue) : undefined,
    restore: (saved?: readonly MilitaryOrderQueueSave[]) => {
      queues.clear();
      for (const entry of saved ?? []) queues.set(entry.id, copyQueue(entry));
    }
  };
};

export type MilitaryOrderQueues = ReturnType<typeof createMilitaryOrderQueues>;
