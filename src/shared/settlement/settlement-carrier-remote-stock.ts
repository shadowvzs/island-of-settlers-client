import { footRouteFrom } from "./settlement-handcart-roads";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A saved blocked yard errand far from its receiver must travel the road before its local stock leg. */
export const resumeRemoteStockDelivery = (
  context: SettlementContext, actor: SettlementActor, destination: SettlementBuilding
) => {
  if (actor.phase !== "carrierDeliveryBlocked" || !actor.ware || !actor.delivery) return false;
  const inReceiverYard = Math.abs(actor.x - destination.x) <= destination.width / 2 + 1 &&
    Math.abs(actor.z - destination.z) <= destination.depth / 2 + 1;
  if (inReceiverYard) return false;
  const path = footRouteFrom(context, actor, destination.access, false);
  if (!path?.length) return false;
  setActorPath(actor, path, "deliver");
  return true;
};
