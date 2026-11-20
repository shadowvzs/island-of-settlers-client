import { DMath } from "../math/deterministic-math";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementContext, SettlementStockContact } from "./settlement-types";
import { stockErrandPath } from "./settlement-worker-stock-paths";

const approaching = new Set(["inputApproach", "outputWalk", "pickupStockWalk", "deliveryStockWalk"]);
const handling = new Set(["inputPickup", "outputPutdown", "pickupTransfer", "deliveryTransfer"]);
const changed = (before: SettlementStockContact, after: SettlementStockContact) =>
  (["x", "y", "z"] as const).some(axis => Math.abs(before.stock[axis] - after.stock[axis]) > 1e-6) ||
  DMath.hypot(before.approach.x - after.approach.x, before.approach.z - after.approach.z) > 1e-6;
const kindOf = (actor: SettlementActor, building: number) => {
  if (actor.delivery) return actor.delivery.destination === building || actor.delivery.sourceInput ? "input" : "output";
  return actor.phase === "inputApproach" || actor.phase === "inputPickup" ? "input" : "output";
};

/**
 * One load-time reconciliation of contacts saved without a stock layout (`plainStockContacts`); no per-frame
 * validation or inventory mutation. Layout contacts are never re-derived: they depend on the stock present
 * when chosen, so re-deriving them at load would replan live errands.
 */
export const reconcileLoadedStockLayouts = (context: SettlementContext, fisherBoatsOnly = false) => {
  if (!context.options.stockContact) return;
  for (const actor of context.actors) {
    const before = actor.stockContact;
    if (!before || (!approaching.has(actor.phase) && !handling.has(actor.phase))) continue;
    const building = context.buildings.find(site => site.uid === actor.stockBuilding);
    if (!building || building.construction < 1 || [16, 35].includes(building.typeId)) continue;
    if (fisherBoatsOnly && !(building.typeId === 18 && before.ware === "boat" && kindOf(actor, building.uid) === "input")) continue;
    const after = context.options.stockContact(building, kindOf(actor, building.uid), before.ware, before.slot);
    if (!after || !changed(before, after)) continue;
    if (building.typeId === 18 && before.ware === "boat" && actor.phase === "deliveryTransfer" &&
      DMath.hypot(actor.x - after.approach.x, actor.z - after.approach.z) > .15) {
      const path = stockErrandPath(context, actor, building, after.approach);
      if (!path) continue;
      setActorPath(actor, path, "deliveryStockWalk");
      actor.wareTransfer = undefined;
    } else if (approaching.has(actor.phase)) {
      const path = stockErrandPath(context, actor, building, after.approach);
      if (!path) continue; // Preserve its owned errand if the ordinary navigation cannot safely replan it.
      setActorPath(actor, path, actor.phase);
    }
    if (after.presentation === "hanging" && actor.ware === before.ware && before.scale3 && actor.wareScale &&
      (["x", "y", "z"] as const).every(axis => Math.abs(actor.wareScale![axis] - before.scale3![axis]) < 1e-6))
      actor.wareScale = after.scale3 ? { ...after.scale3 } : undefined;
    actor.stockContact = after;
    if (actor.wareTransfer) {
      actor.wareTransfer.target = { ...after.stock };
      actor.wareTransfer.yaw = after.yaw;
      actor.wareTransfer.presentation = after.presentation;
      actor.wareTransfer.scale = after.scale;
      actor.wareTransfer.scale3 = after.scale3 ? { ...after.scale3 } : undefined;
    }
  }
};
