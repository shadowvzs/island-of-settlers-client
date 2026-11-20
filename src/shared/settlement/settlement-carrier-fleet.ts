import { cartCapacityFor } from "../../render-common/logistics/handcart-rules";
import { HANDCART_LOGISTICS } from "../balance/economy";
import { cartLayByBooking } from "./settlement-carrier-laybys";
import { canCrewCart } from "./settlement-handcart-crew";
import { canAdoptCart, isCompletedStorage } from "./settlement-handcart-ledger";
import { stoneRouteFrom } from "./settlement-handcart-roads";
import { canPromiseUnloadingHandcart, canReuseReturningHandcart } from "./settlement-land-transport-reuse";
import { actorEconomyOwnerOf, economyOwnerOf, servesBuildingEconomy } from "./settlement-ownership";
import { talentsOf } from "./settlement-talents";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { storageDispatchLimit } from "./storage-capacity";
import { chooseTransportForJob, type TransportReuseCandidate } from "./transport-reuse-policy";

type CarrierFleet = "cartless" | "handcart";

/** The one departure decision used by both the manifest and the real carrier dispatch. */
export interface CarrierFleetAssignment {
  carrier?: SettlementActor;
  capacity: number;
  depot?: SettlementBuilding;
  fleet: CarrierFleet;
  /** Items this departure may carry; never more than the selected capacity. */
  units: number;
  selection?: Omit<TransportReuseCandidate<never>, "value">;
}

const cartless = (): CarrierFleetAssignment => ({ capacity: 1, fleet: "cartless", units: 1 });

/**
 * The stone approach length from `depot` (a finished storage) to `source`, when a cart it owns may
 * serve the trip: a storage with room keeps the cart it receives; elsewhere the cart must be able to
 * come home over stone. Neither the stored cart count nor the crew is checked here.
 */
export const cartDepotApproach = (
  context: SettlementContext,
  depot: SettlementBuilding,
  source: SettlementBuilding,
  destination: SettlementBuilding
) => {
  if (!isCompletedStorage(depot)) return undefined;
  const stoneRoute = context.options.roads.stoneRoute!;
  const approach = depot === source ? { length: 0 } : stoneRoute(depot.access, source.access);
  if (!approach) return undefined;
  if (!canAdoptCart(context, destination) && !stoneRoute(destination.access, depot.access)) return undefined;
  return approach.length;
};

/**
 * The nearest storage with a free cart, a free carrier and stone roads for every leg. This is a
 * plan-time fleet check; `canCrewCart`/`canAdoptCart` are guards, not reservations. The caller
 * commits the assignment in the same synchronous decision, so two dispatches cannot take one cart.
 */
const chooseCartDepot = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding
) => {
  let best: { depot: SettlementBuilding; length: number } | undefined;
  for (const depot of context.buildings) {
    if (!(depot.handcarts ?? 0) || !isCompletedStorage(depot) || !servesBuildingEconomy(context, depot, source) ||
      !canCrewCart(context, depot)) continue;
    const length = cartDepotApproach(context, depot, source, destination);
    if (length === undefined || (best && length >= best.length)) continue;
    best = { depot, length };
  }
  return best?.depot;
};

/**
 * Plan-time cart versus cartless selection. A handcart needs a stone route, at least the minimum
 * item count, a depot/crew, and a valid off-road lay-by at both ends. Everything else falls back to
 * the visible capacity-1 cartless carrier. This returns a decision only; dispatch commits it once.
 */
export const selectCarrierFleet = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  ware: string,
  available: number,
  allowClaim = true,
  forcedActor?: SettlementActor,
  allowReturning = true
): CarrierFleetAssignment => {
  const stoneRoute = context.options.roads.stoneRoute;
  if (!HANDCART_LOGISTICS.enabled || !stoneRoute) return cartless();
  const capacity = cartCapacityFor(ware, talentsOf(context, economyOwnerOf(context, source)).handcartCapacity);
  const units = storageDispatchLimit(context, source, destination, ware,
    Math.min(capacity, available));
  if (units < HANDCART_LOGISTICS.minItems || !stoneRoute(source.access, destination.access))
    return cartless();
  const candidates: TransportReuseCandidate<CarrierFleetAssignment>[] = [];
  const economy = economyOwnerOf(context, source);
  for (const actor of context.actors ?? []) {
    if (actor.nextDelivery || (forcedActor && actor !== forcedActor)) continue;
    if (actorEconomyOwnerOf(context, actor) !== economy) continue;
    const unloading = allowClaim && canPromiseUnloadingHandcart(actor, source.uid);
    if (!unloading && !(allowReturning && canReuseReturningHandcart(actor)) && actor !== forcedActor) continue;
    const owner = context.buildings.find(building => building.uid === actor.handcart?.owner);
    if (!owner || !isCompletedStorage(owner) || !actor.handcart || actor.handcart.cargo !== 0 && !unloading)
      continue;
    if (!canAdoptCart(context, destination, actor) && !stoneRoute(destination.access, owner.access)) continue;
    if (!cartLayByBooking(context, source, destination, actor.uid)) continue;
    const approach = unloading ? { cost: 0 } : stoneRouteFrom(context, actor, source.access);
    if (!approach) continue;
    const selection = { atSource: unloading || approach.cost < .85,
      availability: unloading ? "unloading" as const : "returning" as const,
      id: actor.uid, routeCost: approach.cost };
    candidates.push({ ...selection, value: { capacity, carrier: actor, depot: owner, fleet: "handcart",
      selection, units } });
  }
  const depot = forcedActor ? undefined : chooseCartDepot(context, source, destination);
  // Occupied/expired ownership is resolved here: only a free capacity-1 bay at both ends may take a
  // cart. A busy bay falls back to the proven visible cartless carrier; it never queues in the lane.
  if (depot && cartLayByBooking(context, source, destination)) {
    const approach = depot.uid === source.uid ? { cost: 0 } : stoneRoute(depot.access, source.access)!;
    const selection = { atSource: depot.uid === source.uid, availability: "idle" as const,
      id: depot.uid, routeCost: approach.cost };
    candidates.push({ ...selection, value: { capacity, depot, fleet: "handcart", selection, units } });
  }
  return chooseTransportForJob(candidates) ?? cartless();
};
