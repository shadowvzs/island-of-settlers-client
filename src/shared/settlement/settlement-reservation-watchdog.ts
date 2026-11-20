import { DMath } from "../math/deterministic-math";
import { actorSeparation, chooseYieldTarget, isShoveableIdler, setQueueTarget } from "./settlement-traffic";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export interface SavedReservationWatch {
  elapsed: number; goal?: SettlementPoint; point: SettlementPoint; yielded: boolean;
}
interface Watch {
  actor: SettlementActor;
  elapsed: number;
  goal?: SettlementPoint;
  point: SettlementPoint;
  release: () => void;
  valid: () => boolean;
  yielded: boolean;
}
const clocks = createTransientMap<number>();
export const reservationTime = (context: SettlementContext) => clocks.get(context) ?? 0;
const watches = createTransientMap<Map<string, Watch>>();
export const restoreReservationTime = (context: SettlementContext, time: number) => clocks.set(context, time);
export const saveReservationWatch = (context: SettlementContext, key: string, actor?: SettlementActor): SavedReservationWatch | undefined => {
  const watch = watches.get(context)?.get(key);
  return watch && (!actor || watch.actor === actor) ? { elapsed: watch.elapsed, goal: watch.goal, point: { ...watch.point }, yielded: watch.yielded } : undefined;
};
export const restoreReservationWatch = (context: SettlementContext, key: string, saved?: SavedReservationWatch) => {
  const watch = watches.get(context)?.get(key);
  if (watch && saved) Object.assign(watch, saved);
};
/** Live reservation watches; a quiet skip must not step past one that could shove or release. */
export const reservationWatchCount = (context: SettlementContext) => watches.get(context)?.size ?? 0;

export const watchReservation = (context: SettlementContext, key: string, actor: SettlementActor,
  valid: () => boolean, release: () => void, goal?: SettlementPoint) => {
  let held = watches.get(context);
  if (!held) { held = new Map(); watches.set(context, held); }
  const known = held.get(key);
  if (known?.actor === actor) { known.goal = goal; return; }
  held.set(key, { actor, elapsed: 0, goal, point: { x: actor.x, z: actor.z }, release, valid, yielded: false });
};

const isWithin = (point: SettlementPoint, other: SettlementActor, distance: number) =>
  DMath.hypot(other.x - point.x, other.z - point.z) < distance;
const isAhead = (actor: SettlementActor, other: SettlementActor, target: SettlementPoint) =>
  (other.x - actor.x) * (target.x - actor.x) + (other.z - actor.z) * (target.z - actor.z) > 0;
/** People on the owner's goal, or touching the owner on the side it must walk to. */
const findPersonBlockers = (context: SettlementContext, actor: SettlementActor, target: SettlementPoint) =>
  context.actors.filter(other => {
    if (other === actor || !other.visible) return false;
    const reach = actorSeparation(actor, other) + .12;
    return isWithin(target, other, reach) || (isWithin(actor, other, reach) && isAhead(actor, other, target));
  });

/** Inspect only reservation owners, once per simulation tick; never interrupt physical handoffs. */
export const updateReservationWatchdogs = (context: SettlementContext, dt: number) => {
  clocks.set(context, reservationTime(context) + dt);
  const held = watches.get(context);
  if (!held) return;
  for (const [key, watch] of held) {
    const { actor } = watch;
    if (!watch.valid() || !actor.visible || !context.actors.includes(actor)) { held.delete(key); continue; }
    const target = actor.queueTarget ?? actor.path[actor.pathIndex] ?? watch.goal;
    if (!target || actor.wareTransfer || DMath.hypot(actor.x - watch.point.x, actor.z - watch.point.z) >= .12) {
      watch.elapsed = 0;
      watch.point = { x: actor.x, z: actor.z };
      watch.yielded = false;
      continue;
    }
    watch.elapsed += dt;
    // Crowd searches only at recovery thresholds, rather than scanning every owner every tick.
    if (watch.elapsed < 4 || (watch.yielded && watch.elapsed < 8)) continue;
    const blockers = findPersonBlockers(context, actor, target);
    if (!blockers.length) {
      watch.elapsed = 0;
      watch.yielded = false;
      continue;
    }
    if (watch.elapsed >= 4 && !watch.yielded) {
      watch.yielded = true;
      for (const blocker of blockers) {
        if (!isShoveableIdler(blocker) || blocker.wareTransfer || blocker.queueTarget) continue;
        const shoulder = chooseYieldTarget(context, blocker, actor, target, true);
        if (shoulder) setQueueTarget(blocker, shoulder, "stationary");
      }
    }
    if (watch.elapsed < 8) continue;
    watch.release();
    held.delete(key);
  }
};

export const reservationWatchOrder = (context: SettlementContext) => [...watches.get(context)?.keys() ?? []];
export const restoreReservationWatchOrder = (context: SettlementContext, order: readonly string[]) => {
  const held = watches.get(context);
  if (!held) return;
  const ordered = new Map<string, Watch>();
  for (const key of order) { const watch = held.get(key); if (watch) ordered.set(key, watch); }
  for (const [key, watch] of held) if (!ordered.has(key)) ordered.set(key, watch);
  watches.set(context, ordered);
};
