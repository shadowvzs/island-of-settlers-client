import type { SettlementActor } from "./settlement-types";

/** These people have a mandatory owner/task; a new ware job must never recruit them. */
const hasOtherDuty = (actor: SettlementActor) => actor.job !== "Carrier" || actor.tool !== undefined ||
  actor.navalOrder !== undefined || actor.demolitionReturning || actor.navigationReturnCargo ||
  Object.values(actor.consumed ?? {}).some(count => count > 0);

export const canReuseIndoorCarrier = (actor: SettlementActor) => !hasOtherDuty(actor) &&
  actor.phase === "inside" && !actor.visible && !actor.delivery && !actor.handcart && !actor.ware &&
  !actor.wareTransfer;

/** An empty walking return can be diverted, preserving the same physical person and home. */
export const canReuseWalkingCarrier = (actor: SettlementActor) => !hasOtherDuty(actor) &&
  actor.visible && (actor.phase === "home" || actor.phase === "returnBlockedCarrier") &&
  !actor.delivery && !actor.handcart && !actor.ware && !actor.wareTransfer;

/** A cart still carrying, loading, recovering or promised to another destination is not empty. */
export const canReuseReturningHandcart = (actor: SettlementActor) => !hasOtherDuty(actor) &&
  actor.visible && actor.phase === "cartReturn" && !actor.delivery && !actor.ware && !actor.wareTransfer &&
  actor.handcart?.state === "hitched" && actor.handcart.cargo === 0 && actor.handcart.trip === undefined;

/** A promise waits for the completed putdown; it never changes the currently held goods. */
export const canPromiseWalkingCarrier = (actor: SettlementActor, source: number) => !hasOtherDuty(actor) &&
  !actor.handcart && actor.delivery?.destination === source &&
  (["enterDelivery", "deliveryStockWalk", "deliveryTransfer"].includes(actor.phase) ||
    (actor.phase === "deliver" && actor.pathIndex >= actor.path.length));

/** A cart may claim a next job only at the flag where it is physically unloading. */
export const canPromiseUnloadingHandcart = (actor: SettlementActor, source: number) => !hasOtherDuty(actor) &&
  actor.phase === "cartUnloading" && actor.handcart?.trip?.destination === source &&
  actor.handcart.state === "hitched" && actor.handcart.cargo > 0 && !actor.delivery && !actor.ware;
