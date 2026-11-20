import { addGood, STORAGE_IDS } from "./production-rules";
import { clearWareTransfer } from "./settlement-stock-transfers";
import type {
  SettlementActor,
  SettlementContext,
  SettlementDelivery,
  SettlementHandcartTrip
} from "./settlement-types";

/**
 * A destination claim is a reservation of the receiver's `incoming` capacity. It is held by the
 * carrier/delivery and must be released if the trip stops making progress; otherwise a blocked
 * carrier can hold a destination slot forever.
 *
 * The lease advances only on a real ownership/movement milestone (walked, gripped, loaded,
 * unloaded). Waiting in a door/traffic queue does not refresh it. Five minutes of complete
 * standstill is longer than every authored handling window and shorter than a stale trip.
 */
export const CARRIER_CLAIM_LEASE_TICKS = 6000;

export interface ClaimLease {
  leaseDeadlineTick: number;
  leaseStartedTick: number;
}

const nowTick = (context: SettlementContext) => context.clock?.tick() ?? 0;

export const startClaimLease = (context: SettlementContext): ClaimLease => {
  const leaseStartedTick = nowTick(context);
  return { leaseDeadlineTick: leaseStartedTick + CARRIER_CLAIM_LEASE_TICKS, leaseStartedTick };
};

export const refreshClaimLease = (
  context: SettlementContext, lease: { leaseDeadlineTick?: number; leaseStartedTick?: number }
) => {
  // No lease means the claim is not lease-managed (e.g. a saved legacy trip): never invent one.
  if (lease.leaseDeadlineTick === undefined || lease.leaseStartedTick === undefined) return;
  lease.leaseStartedTick = nowTick(context);
  lease.leaseDeadlineTick = lease.leaseStartedTick + CARRIER_CLAIM_LEASE_TICKS;
};

type LeaseTicks = { leaseDeadlineTick?: number; leaseStartedTick?: number };
const shiftLease = (lease: LeaseTicks | undefined, ticks: number) => {
  if (!lease) return;
  if (lease.leaseStartedTick !== undefined) lease.leaseStartedTick += ticks;
  if (lease.leaseDeadlineTick !== undefined) lease.leaseDeadlineTick += ticks;
};

/**
 * Clock ticks the simulation did not step (an offline skip or jump, a parked tab) are no standstill:
 * every live claim lease moves with the clock, so a carrier caught mid-trip keeps its claim instead of
 * expiring at once and stranding itself (and the worker it blocks) at a stock bay.
 */
export const shiftClaimLeases = (actors: readonly SettlementActor[], ticks: number) => {
  if (!(ticks > 0)) return;
  for (const actor of actors) {
    shiftLease(actor.delivery, ticks);
    shiftLease(actor.nextDelivery, ticks);
    shiftLease(actor.handcart?.trip, ticks);
    shiftLease(actor.handcart?.bays?.source, ticks);
    shiftLease(actor.handcart?.bays?.destination, ticks);
    shiftLease(actor.workerMovementPlan?.claims, ticks);
  }
};

export const claimLeaseExpired = (
  context: SettlementContext, lease: Partial<ClaimLease>
) => lease.leaseDeadlineTick !== undefined && nowTick(context) >= lease.leaseDeadlineTick;

/** A deterministic fingerprint of real carrier progress; walking or handling changes it. */
export interface CarrierClaimProgress {
  cartCargo: number;
  delivered: number;
  destination: number;
  loaded: number;
  pathIndex: number;
  prepaid: number;
  transferProgress: number;
  units: number;
  ware: string | null;
  x: number;
  z: number;
}

export const carrierClaimProgress = (
  actor: SettlementActor
): CarrierClaimProgress | undefined => {
  if (!actor.delivery && !actor.handcart?.trip) return undefined;
  const trip = actor.handcart?.trip;
  return {
    cartCargo: actor.handcart?.cargo ?? -1,
    delivered: trip?.delivered ?? -1,
    destination: trip?.destination ?? actor.delivery?.destination ?? -1,
    loaded: trip?.loaded ?? -1,
    pathIndex: actor.pathIndex,
    prepaid: trip?.prepaid ?? -1,
    transferProgress: actor.wareTransfer?.progress ?? -1,
    units: actor.wareUnits ?? 1,
    ware: actor.ware,
    x: actor.x,
    z: actor.z
  };
};

export const carrierClaimProgressed = (
  before: CarrierClaimProgress | undefined, actor: SettlementActor
) => {
  if (!before) return false;
  const after = carrierClaimProgress(actor);
  if (!after) return false;
  return before.cartCargo !== after.cartCargo || before.delivered !== after.delivered ||
    before.destination !== after.destination || before.loaded !== after.loaded ||
    before.pathIndex !== after.pathIndex || before.prepaid !== after.prepaid ||
    before.transferProgress !== after.transferProgress || before.units !== after.units ||
    before.ware !== after.ware || before.x !== after.x || before.z !== after.z;
};

/** Refresh an active claim only after the actor actually moved or handled a unit. */
export const refreshCarrierClaimOnProgress = (
  context: SettlementContext, actor: SettlementActor, before: CarrierClaimProgress | undefined
) => {
  if (!carrierClaimProgressed(before, actor)) return;
  if (actor.delivery) refreshClaimLease(context, actor.delivery);
  if (actor.handcart?.trip) refreshClaimLease(context, actor.handcart.trip);
};

/**
 * Releases a cartless delivery's destination claim. The source follows the existing dispatch rule:
 * a storage source was debited at dispatch and is refunded only while the ware has not been gripped;
 * a production source was merely reserved, so clearing `delivery` releases it without adding stock.
 * After grip the cargo stays with the carrier and only the destination claim is released.
 */
export const releaseDeliveryClaim = (
  context: SettlementContext,
  actor: SettlementActor
): { destination?: number; pickedUp: boolean; source?: number } | undefined => {
  const delivery = actor.delivery;
  if (!delivery) return undefined;
  const units = actor.wareUnits ?? 1;
  const pickedUp = actor.ware === delivery.ware;
  const source = context.buildings.find(building => building.uid === delivery.source);
  const destination = context.buildings.find(building => building.uid === delivery.destination);
  if (destination) {
    addGood(destination.incoming, delivery.ware, -units);
    if (delivery.upgrade && destination.workshopUpgrade?.incoming)
      addGood(destination.workshopUpgrade.incoming, delivery.ware, -1);
  }
  if (!pickedUp && source && STORAGE_IDS.has(source.typeId) && !delivery.reserved)
    addGood(source.inventory, delivery.ware, units);
  actor.delivery = undefined;
  actor.stockContact = undefined;
  clearWareTransfer(actor);
  if (!pickedUp) actor.wareUnits = undefined;
  actor.navigationReturnCargo = pickedUp;
  return { destination: delivery.destination, pickedUp, source: delivery.source };
};

export const deliveryLeaseExpired = (context: SettlementContext, delivery: SettlementDelivery) =>
  claimLeaseExpired(context, delivery);

export const handcartTripLeaseExpired = (
  context: SettlementContext, trip: SettlementHandcartTrip
) => claimLeaseExpired(context, trip);
