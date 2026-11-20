import { isHoldingStorageTurn, ownsStorageArrival } from "./settlement-door-traffic";
import { isOwnDoorLane, isOwnStockCourtyard } from "./settlement-entrance";
import { isGroundSegmentClear, isNavigationFootprintClear } from "./settlement-navigation";
import { chooseCrowdEscapeTarget } from "./settlement-traffic";
import type { SettlementActor, SettlementContext } from "./settlement-types";

const blockers = new WeakMap<SettlementActor, { actor: SettlementActor; elapsed: number }>();
export const recordTrafficBlocker = (
  actor: SettlementActor,
  blocker: SettlementActor,
  dt: number
) => {
  const previous = blockers.get(actor);
  blockers.set(actor, {
    actor: blocker,
    elapsed: previous?.actor === blocker ? previous.elapsed + dt : 0
  });
};
export const clearTrafficBlocker = (actor: SettlementActor) => blockers.delete(actor);
const eligible = (context: SettlementContext, actor: SettlementActor) =>
  actor.visible &&
  actor.pathIndex < actor.path.length &&
  !actor.queueTarget &&
  !actor.wareTransfer &&
  actor.job !== "Mount" &&
  !actor.demolitionReturning &&
  !ownsStorageArrival(context, actor) &&
  !isHoldingStorageTurn(context, actor) &&
  !isOwnDoorLane(context, actor, actor) &&
  !isOwnStockCourtyard(context, actor, actor);

/** One stable actor walks to a collision-checked pocket in a small, persistently blocked cycle. */
export const requestTrafficCycleBackout = (context: SettlementContext, actor: SettlementActor) => {
  const cycle: SettlementActor[] = [];
  let current = actor;
  for (let step = 0; step < 8; step++) {
    const relation = blockers.get(current);
    if (!relation || relation.elapsed < 2 || !relation.actor.visible) return false;
    if (cycle.includes(current)) {
      if (current !== actor) return false;
      break;
    }
    cycle.push(current);
    current = relation.actor;
  }
  if (current !== actor || cycle.length < 2) return false;
  const chosen = cycle.filter((unit) => eligible(context, unit)).sort((a, b) => b.uid - a.uid)[0];
  if (!chosen || chosen !== actor) return false;
  const next = chosen.path[chosen.pathIndex]!;
  const target = chooseCrowdEscapeTarget(context, chosen, (point) =>
    isNavigationFootprintClear(context, point) && isGroundSegmentClear(context, point, next)
  );
  if (!target) return false;
  chosen.queueTarget = target;
  chosen.queueWait = 0;
  chosen.timer = 0;
  blockers.delete(chosen);
  return true;
};
