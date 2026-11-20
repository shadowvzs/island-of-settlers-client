import { DMath } from "../math/deterministic-math";
import { actorSeparation, requestStationaryRoadYield } from "./settlement-traffic";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A failed delivery may wait on the access itself, making every complete FIFO rejoin route fail. */
export const clearBlockedStorageAccess = (
  context: SettlementContext, arrival: SettlementActor, building: SettlementBuilding
) => {
  for (const blocker of context.actors) {
    if (blocker === arrival || !blocker.visible || blocker.phase !== "carrierDeliveryBlocked") continue;
    if (DMath.hypot(blocker.x - building.access.x, blocker.z - building.access.z) >
      actorSeparation(arrival, blocker) + .12) continue;
    if (requestStationaryRoadYield(context, blocker, arrival, building.access)) return true;
  }
  return false;
};
