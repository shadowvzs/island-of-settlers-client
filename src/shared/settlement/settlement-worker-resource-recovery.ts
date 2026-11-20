import { isNavigationClear } from "./settlement-navigation";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import { groundPath, setActorPath } from "./settlement-paths";
import { resourceApproaches } from "./settlement-resource-approaches";
import type { SettlementActor, SettlementContext } from "./settlement-types";

const retries = new WeakMap<SettlementActor, number>();

/** A growing trunk can invalidate the final work stance after a journey was saved or started. */
export const recoverResourceApproach = (
  context: SettlementContext,
  actor: SettlementActor,
  dt: number
) => {
  const target = actor.target;
  if (actor.phase !== "outbound" || !target || !["tree", "stone"].includes(target.kind)) return false;
  const endpoint = actor.path.at(-1);
  if (!endpoint || isNavigationClear(context, endpoint)) {
    retries.delete(actor);
    return false;
  }
  actor.action = "idle";
  // Waiting for a clear stance is a real stall: the shared recovery clock must see it.
  recordMovementOutcome(actor, "static-blocked");
  const remaining = (retries.get(actor) ?? 0) - dt;
  if (remaining > 0) {
    retries.set(actor, remaining);
    return true;
  }
  retries.set(actor, 1);
  for (const approach of resourceApproaches(target)) {
    const path = groundPath(context, actor, approach);
    if (!path) continue;
    setActorPath(actor, path, "outbound");
    retries.delete(actor);
    return false;
  }
  return true;
};
