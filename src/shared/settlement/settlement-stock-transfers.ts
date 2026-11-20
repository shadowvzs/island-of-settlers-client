import { FISHER_BOAT_LIFT_SECONDS } from "./constants";
import { WARE_TRANSFER_SECONDS } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementStockContact
} from "./settlement-types";
export const stockContact = (
  context: SettlementContext,
  building: SettlementBuilding,
  kind: "input" | "output",
  ware: string,
  slot: number
): SettlementStockContact =>
  context.options.stockContact?.(building, kind, ware, slot) ?? {
    stock: { ...building.access, y: building.y + 0.15 },
    approach: { ...building.access, y: building.y },
    slot,
    ware
  };
export const startWareTransfer = (
  actor: SettlementActor,
  direction: "pickup" | "putdown",
  ware: string,
  contact: SettlementStockContact
) => {
  if (direction === "pickup" || !actor.wareScale) actor.wareScale = contact.scale3 ? {...contact.scale3} : undefined;
  actor.wareTransfer = {
    direction,
    presentation: contact.presentation,
    ware,
    progress: 0,
    target: { ...contact.stock },
    yaw: contact.yaw,
    scale: contact.scale,
    scale3: contact.scale3 ? { ...contact.scale3 } : undefined
  };
  actor.action = "carry";
  actor.animationTime = 0;
  actor.yaw = DMath.atan2(contact.stock.x - actor.x, contact.stock.z - actor.z);
};
export const advanceWareTransfer = (actor: SettlementActor, dt: number) => {
  if (!actor.wareTransfer) return false;
  actor.action = "carry";
  actor.wareTransfer.progress = Math.min(
    1,
    actor.wareTransfer.progress + dt / (actor.wareTransfer.ware === "boat" ? FISHER_BOAT_LIFT_SECONDS : WARE_TRANSFER_SECONDS)
  );
  return actor.wareTransfer.progress >= 1;
};
export const clearWareTransfer = (actor: SettlementActor) => {
  actor.wareTransfer = undefined;
  actor.stockContact = undefined;
};
