import { DMath } from "../math/deterministic-math";
import { groundPath, setActorPath } from "./settlement-paths";
import { targetKey } from "./settlement-resources";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A committed sowing trip continues outdoors until all eight reserved plots are planted. */
export const continueFarmerSowing = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, success: boolean
) => {
  if (actor.fieldWork !== "sow" || !actor.sowingBatch?.length) return false;
  if (!success) {
    for (const target of actor.sowingBatch) context.reservations.delete(targetKey(target));
    actor.sowingBatch = undefined;
    return false;
  }
  const target = actor.sowingBatch[0]!;
  const dx = target.x - actor.x, dz = target.z - actor.z, length = DMath.hypot(dx, dz) || 1;
  const approach = { x: target.x - dx / length * .42, z: target.z - dz / length * .42 };
  const path = groundPath(context, actor, approach);
  actor.ware = null;
  if (!path) {
    actor.phase = "sowingBlocked"; actor.action = "idle"; actor.timer = 1;
    building.status = "Waiting for a clear sowing route";
    return true;
  }
  actor.sowingBatch.shift(); actor.target = target;
  setActorPath(actor, path, "outbound");
  building.status = "Sowing wheat";
  return true;
};
