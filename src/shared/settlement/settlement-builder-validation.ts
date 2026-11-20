import { DMath } from "../math/deterministic-math";
import type { SettlementActor, SettlementContext } from "./settlement-types";

interface BuilderCheck { elapsed: number; still: number; x: number; z: number; progress: number }
const checks = new WeakMap<SettlementActor, BuilderCheck>();

/** Revalidate real assignments once a second; waiting never manufactures ware or returns a tool remotely. */
export const validateBuilderAssignment = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (actor.job !== "Builder" && actor.job !== "Leveler") { checks.delete(actor); return false; }
  const previous = checks.get(actor);
  const building = context.buildings.find(entry => entry.uid === actor.building);
  const check = previous ?? { elapsed: 1, still: 0, x: actor.x, z: actor.z, progress: building?.construction ?? 1 };
  check.elapsed += dt;
  checks.set(actor, check);
  if (check.elapsed < 1) return false;
  const interval = check.elapsed;
  check.elapsed = 0;
  // A bridge site is worked by a one- or two-person crew: the primary worker field still names one
  // of them, but the second builder must not be displaced as an ordinary duplicate assignment.
  const bridgeCrew = building?.bridgeSite !== undefined && actor.job === "Builder" &&
    actor.building === building.uid;
  if (!building || building.construction >= 1 ||
    (!bridgeCrew && building.worker !== undefined && building.worker !== actor.uid)) {
    if (building?.worker === actor.uid) { building.worker = undefined; building.working = false; }
    actor.stockBuilding = building?.uid;
    actor.job = "Settler";
    actor.demolitionReturning = true;
    actor.phase = "demolitionBlocked";
    actor.action = "idle";
    actor.path = [];
    actor.pathIndex = 0;
    actor.queueTarget = undefined;
    actor.queueWait = 0;
    checks.delete(actor);
    return true;
  }
  if (!bridgeCrew || building.worker === undefined) building.worker = actor.uid;
  const stationary = DMath.hypot(actor.x - check.x, actor.z - check.z) < .08;
  check.still = stationary && building.construction === check.progress ? check.still + interval : 0;
  check.x = actor.x; check.z = actor.z; check.progress = building.construction;
  // Recompute exterior work access after an obstacle/route changes. A valid plan remains assigned,
  // including when supplies are delayed; the normal work-position search will wait safely if no path exists.
  if (check.still >= 4 && actor.visible && actor.phase === "builderWork") {
    actor.path = []; actor.pathIndex = 0; actor.queueTarget = undefined; actor.queueWait = 0;
    actor.phase = "inside"; actor.action = "idle";
    check.still = 0;
  }
  return false;
};
