import { isFiniteNumber, isSaveInteger, isSaveObject } from "./save-validation";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { ShippingDemandReason, ShippingDemandSave, ShippingDemandStatus } from "./settlement-shipping-demand";

const STATUSES: readonly ShippingDemandStatus[] = ["blocked", "in-transit", "outstanding"];
const REASONS: readonly ShippingDemandReason[] = ["batching", "no-harbour", "no-ship", "no-source",
  "not-accepted", "reduced", "route-lost", "storage-full"];
const nonNegativeInteger = (value: unknown) => isSaveInteger(value) && value >= 0;

/** A saved destination need and its exact physical coverage; stale order links are repaired by reconciliation. */
export const validShippingDemandSave = (value: unknown, ids: Set<number>,
  save: SettlementSaveV1): string | null => {
  if (value !== undefined && isSaveObject(value) &&
    ((value.timer !== undefined && (!isFiniteNumber(value.timer) || value.timer < 0 || value.timer > 60)) ||
      (value.dirty !== undefined && typeof value.dirty !== "boolean"))) return "Invalid shipping demand schedule";
  if (value === undefined) return null;
  if (!isSaveObject(value) || !Array.isArray(value.demands) || !isSaveInteger(value.nextDemand, 1) ||
    value.demands.length > 512) return "Invalid shipping demand state";
  const seen = new Set<string>(), recordIds = new Set<number>();
  for (const entry of value.demands) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.id, 1) || entry.id >= value.nextDemand ||
      recordIds.has(entry.id) || !isSaveInteger(entry.destinationUid) ||
      (!ids.has(entry.destinationUid) && entry.collectPoolId === undefined) ||
      typeof entry.ware !== "string" || !entry.ware.length ||
      !isSaveInteger(entry.need, 1) || !nonNegativeInteger(entry.stock) ||
      !nonNegativeInteger(entry.incoming) || !nonNegativeInteger(entry.fleet) ||
      !nonNegativeInteger(entry.covered) || !nonNegativeInteger(entry.createdTick) ||
      !nonNegativeInteger(entry.updatedTick) || !nonNegativeInteger(entry.revision) ||
      !STATUSES.includes(entry.status as ShippingDemandStatus) ||
      (entry.reason !== undefined && !REASONS.includes(entry.reason as ShippingDemandReason)) ||
      (entry.collectPoolId !== undefined && (!isSaveInteger(entry.collectPoolId) ||
        !save.storagePools.pools.some(pool => pool.id === entry.collectPoolId))) ||
      (entry.orderId !== undefined && !isSaveInteger(entry.orderId, 1)) ||
      (entry.sourceUid !== undefined && !isSaveInteger(entry.sourceUid)))
      return "Invalid shipping demand";
    const stock = entry.stock as number, incoming = entry.incoming as number;
    const fleet = entry.fleet as number, covered = entry.covered as number;
    if (covered !== stock + incoming + fleet || covered > (entry.need as number))
      return "Invalid shipping demand coverage";
    if (entry.harbourUid !== undefined && (!isSaveInteger(entry.harbourUid) || !ids.has(entry.harbourUid) && entry.collectPoolId === undefined))
      return "Invalid shipping demand harbour";
    const key = `${entry.destinationUid}|${entry.ware}`;
    if (seen.has(key)) return "Duplicate shipping demand";
    seen.add(key);
    recordIds.add(entry.id);
    const destination = save.buildings.find(building => building.uid === entry.destinationUid);
    const inTransit = (entry.fleet as number) > 0 || (entry.covered as number) > 0 ||
      entry.reason === "reduced";
    if (!destination && !inTransit) return "Shipping demand destination is missing";
    if (entry.harbourUid !== undefined) {
      const harbour = save.buildings.find(building => building.uid === entry.harbourUid);
      if (!harbour && !inTransit) return "Invalid shipping demand receiving harbour";
      if (harbour && (harbour.typeId !== 39 || harbour.construction !== 1))
        return "Invalid shipping demand receiving harbour";
    }
  }
  return null;
};
export type { ShippingDemandSave };
