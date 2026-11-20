import type { NavalOrder } from "./settlement-naval-fleet";
import type { ShippingDemandSnapshot } from "./settlement-shipping-demand";

type Target = Pick<ShippingDemandSnapshot, "destinationUid" | "incoming" | "need" | "stock" | "ware">;

/** A pending batch is part of its own target, not another arrival covering that target. */
export const remainingShippingOrderNeed = (
  order: Pick<NavalOrder, "cargo" | "demand" | "destinationUid" | "passengers">,
  targets: readonly Target[],
  coverage: (destination: number, ware: string) => number
) => {
  const wares = Object.keys(order.demand ?? order.cargo);
  if (!order.demand && !targets.some(target => target.destinationUid === order.destinationUid &&
    wares.includes(target.ware))) return undefined;
  return wares.reduce((sum, ware) => {
    const target = targets.find(entry => entry.destinationUid === order.destinationUid && entry.ware === ware);
    if (!target) return sum + (order.demand ? 0 : order.cargo[ware] ?? 0);
    const otherArrivals = Math.max(0, coverage(order.destinationUid, ware) - (order.cargo[ware] ?? 0));
    return sum + Math.max(0, target.need - target.stock - target.incoming - otherArrivals);
  }, order.passengers?.length ?? 0);
};
