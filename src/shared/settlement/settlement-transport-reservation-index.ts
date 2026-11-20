import { STORAGE_IDS } from "./production-rules";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { isSharedStorageWare, storagePoolFor } from "./shared-storage";

type UnitsBySource = Map<string, Map<number, number>>;

const addUnits = (index: UnitsBySource, ware: string, source: number, units: number) => {
  let bySource = index.get(ware);
  if (!bySource) index.set(ware, bySource = new Map());
  bySource.set(source, (bySource.get(source) ?? 0) + units);
};

const unitsOf = (index: UnitsBySource, ware: string, source: number) => index.get(ware)?.get(source) ?? 0;

/**
 * A04: one actor pass that answers `availableTransportGood(context, source, ware)` (ordinary output,
 * no excepted actor) for an unchanged settlement state, instead of scanning every actor per query.
 * The sums are the same integer terms as the scan (reserved walking deliveries, hand-cart plans and
 * soft next-job holds, the latter pooled across shared storages), so every answer is identical.
 * Only use it while nothing writes: a read-only collect pass, or a filter evaluated before dispatch.
 */
export const createTransportReservationIndex = (context: SettlementContext) => {
  const deliveries: UnitsBySource = new Map(), handcarts: UnitsBySource = new Map();
  const nextJobs: UnitsBySource = new Map(), firstByUid = new Map<number, SettlementBuilding>();
  for (const actor of context.actors) {
    const { delivery, handcart, nextDelivery } = actor;
    if (delivery && !delivery.sourceInput && delivery.reserved) addUnits(deliveries, delivery.ware, delivery.source, 1);
    const trip = handcart?.trip;
    if (trip) addUnits(handcarts, trip.ware, trip.source, trip.planned - trip.loaded - trip.prepaid);
    if (nextDelivery && !nextDelivery.sourceInput)
      addUnits(nextJobs, nextDelivery.ware, nextDelivery.source, nextDelivery.units);
  }
  for (const building of context.buildings) if (!firstByUid.has(building.uid)) firstByUid.set(building.uid, building);

  /** Soft next-job holds on this source, plus those on other members of its shared storage pool. */
  const nextReservations = (source: number, ware: string) => {
    const own = unitsOf(nextJobs, ware, source);
    if (!isSharedStorageWare(ware) || !context.storagePools) return own;
    const sourceAccess = firstByUid.get(source);
    const pool = sourceAccess && storagePoolFor(context, sourceAccess);
    if (!pool) return own;
    let pooled = own;
    for (const [other, units] of nextJobs.get(ware) ?? []) {
      const otherAccess = other === source ? undefined : firstByUid.get(other);
      if (otherAccess && pool.id === storagePoolFor(context, otherAccess)?.id) pooled += units;
    }
    return pooled;
  };

  const available = (source: SettlementBuilding, ware: string) => {
    const storage = STORAGE_IDS.has(source.typeId);
    const reserved = storage ? 0 : unitsOf(deliveries, ware, source.uid) + unitsOf(handcarts, ware, source.uid);
    return ((storage ? source.inventory : source.output)[ware] ?? 0) - reserved -
      nextReservations(source.uid, ware);
  };
  return { available };
};

export type TransportReservationIndex = ReturnType<typeof createTransportReservationIndex>;
