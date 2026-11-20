import { isCatapultAmmoStock } from "./catapult-ammo-kinds";
import { catapultOutgoingStone } from "./military-catapult-ammo";
import { addGood, STORAGE_IDS } from "./production-rules";
import { committedWorkerInputs, reservedInputReturns } from "./sawmill-input-returns";
import { claimLeaseExpired, startClaimLease } from "./settlement-carrier-claims";
import { handcartReservedOutput } from "./settlement-handcart-ledger";
import { canPromiseUnloadingHandcart, canPromiseWalkingCarrier } from "./settlement-land-transport-reuse";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementNextDelivery
} from "./settlement-types";
import { isSharedStorageWare, storagePoolFor } from "./shared-storage";
import { reserveStorageDispatch, storageDispatchLimit } from "./storage-capacity";

export const nextTransportReservations = (
  context: SettlementContext, source: number, ware: string, sourceInput = false, except?: SettlementActor
) => context.actors.reduce((count, actor) => {
  const next = actor === except ? undefined : actor.nextDelivery;
  if (!next || next.ware !== ware || Boolean(next.sourceInput) !== sourceInput) return count;
  if (next.source === source) return count + next.units;
  if (sourceInput || !isSharedStorageWare(ware) || !context.storagePools) return count;
  const sourceAccess = context.buildings.find(building => building.uid === source);
  const nextAccess = context.buildings.find(building => building.uid === next.source);
  const pool = sourceAccess && storagePoolFor(context, sourceAccess);
  return count + (pool && nextAccess && pool.id === storagePoolFor(context, nextAccess)?.id ? next.units : 0);
}, 0);

/** Soft next-job holds share no custody with the current delivery or actual source stock. */
export const availableTransportGood = (
  context: SettlementContext, source: SettlementBuilding, ware: string, sourceInput = false,
  except?: SettlementActor
) => {
  if (sourceInput) {
    const own = except?.nextDelivery;
    const ownUnits = own?.source === source.uid && own.ware === ware && own.sourceInput ? own.units : 0;
    const available = isCatapultAmmoStock(source, ware)
      ? catapultOutgoingStone(source, ware) : source.input[ware] ?? 0;
    return available - committedWorkerInputs(context, source, ware) -
      reservedInputReturns(context, source, ware) + ownUnits;
  }
  const storage = STORAGE_IDS.has(source.typeId);
  let reserved = 0;
  if (!storage) {
    for (const actor of context.actors) if (actor.delivery?.source === source.uid &&
      actor.delivery.ware === ware && !actor.delivery.sourceInput && actor.delivery.reserved) reserved++;
    reserved += handcartReservedOutput(context, source.uid, ware);
  }
  return ((storage ? source.inventory : source.output)[ware] ?? 0) - reserved -
    nextTransportReservations(context, source.uid, ware, false, except);
};

export const releaseNextDelivery = (context: SettlementContext, actor: SettlementActor) => {
  const next = actor.nextDelivery;
  if (!next) return;
  actor.nextDelivery = undefined;
  const destination = context.buildings.find(building => building.uid === next.destination);
  if (!destination) return;
  addGood(destination.incoming, next.ware, -next.units);
  if (next.upgrade && destination.workshopUpgrade?.incoming)
    addGood(destination.workshopUpgrade.incoming, next.ware, -next.units);
};

export const nextTransferReservations = (actors: readonly SettlementActor[], id: number) =>
  actors.reduce((total, actor) => total +
    (actor.nextDelivery?.transferId === id ? actor.nextDelivery.units : 0), 0);

const pendingTransfer = (context: SettlementContext, next: SettlementNextDelivery, except?: SettlementActor) => {
  const id = next.transferId;
  if (id === undefined) return true;
  const own = except?.nextDelivery, ownUnits = own && own.transferId === id ? own.units : 0;
  const reserved = nextTransferReservations(context.actors, id) - ownUnits;
  return context.transfers.some(order => order.id === id &&
    order.source === next.source && order.destination === next.destination && order.ware === next.ware &&
    order.count - reserved >= next.units);
};

export const claimNextDelivery = (
  context: SettlementContext, actor: SettlementActor,
  request: Omit<SettlementNextDelivery, "leaseDeadlineTick" | "leaseStartedTick">
) => {
  if (!Number.isSafeInteger(request.units) || request.units < 1 ||
    (request.mode === "carrier" && request.units !== 1) ||
    (request.mode === "handcart" && (!Number.isSafeInteger(request.capacity) || request.units > (request.capacity ?? 0))) ||
    (request.upgrade && request.sourceInput)) return false;
  if (actor.nextDelivery || (request.mode === "handcart"
    ? !canPromiseUnloadingHandcart(actor, request.source) : !canPromiseWalkingCarrier(actor, request.source)))
    return false;
  const source = context.buildings.find(building => building.uid === request.source);
  const destination = context.buildings.find(building => building.uid === request.destination);
  if (!source || !destination || request.units < 1 || source.uid === destination.uid ||
    (request.upgrade && !destination.workshopUpgrade?.reserved) ||
    destination.accepts[request.ware] === false ||
    availableTransportGood(context, source, request.ware, Boolean(request.sourceInput)) < request.units)
    return false;
  if (!request.upgrade && !request.sourceInput &&
    storageDispatchLimit(context, source, destination, request.ware, request.units) < request.units) return false;
  const next = { ...request, ...startClaimLease(context) };
  if (!pendingTransfer(context, next)) return false;
  actor.nextDelivery = next;
  addGood(destination.incoming, request.ware, request.units);
  if (request.upgrade && destination.workshopUpgrade?.reserved)
    addGood(destination.workshopUpgrade.incoming ??= {}, request.ware, request.units);
  if (!request.upgrade && !request.sourceInput)
    reserveStorageDispatch(context, source, destination, request.ware, request.units);
  return true;
};

/** Cancelling or losing the current leg also drops its unpaid next-job preference exactly once. */
export const reconcileNextDelivery = (context: SettlementContext, actor: SettlementActor) => {
  const next = actor.nextDelivery;
  if (!next) return;
  const currentDestination = actor.handcart?.trip?.destination ?? actor.delivery?.destination;
  if (currentDestination !== next.source || claimLeaseExpired(context, next) || !pendingTransfer(context, next, actor) ||
    !context.buildings.some(building => building.uid === next.source) ||
    !context.buildings.some(building => building.uid === next.destination && building.accepts[next.ware] !== false &&
      (!next.upgrade || building.workshopUpgrade?.reserved)))
    releaseNextDelivery(context, actor);
};

/** Revalidate at real unload completion; the caller commits ordinary pickup using this same unit. */
export const takeNextDelivery = (context: SettlementContext, actor: SettlementActor, sourceUid: number) => {
  const next = actor.nextDelivery;
  if (!next) return undefined;
  const source = context.buildings.find(building => building.uid === next.source);
  const usable = sourceUid === next.source && source && !claimLeaseExpired(context, next) &&
    pendingTransfer(context, next, actor) &&
    availableTransportGood(context, source, next.ware, Boolean(next.sourceInput), actor) >= next.units;
  releaseNextDelivery(context, actor);
  return usable ? next : undefined;
};

/** Finite manual orders remain in their original queue until the promised unit really commits. */
export const completeNextTransferDispatch = (
  context: SettlementContext, next: Pick<SettlementNextDelivery, "transferId" | "units">
) => {
  if (next.transferId === undefined) return;
  const order = context.transfers.find(entry => entry.id === next.transferId);
  if (!order) return;
  order.count -= next.units;
  if (order.count <= 0) context.transfers = context.transfers.filter(entry => entry !== order);
};
