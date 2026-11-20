import { SETTLEMENT_WARES } from "./settlement-building-policies";
import type { SettlementContext } from "./settlement-types";
import { isSharedStorageWare, type StoragePool, storagePoolFor } from "./shared-storage";

export const collectingHarbour = (context: SettlementContext, pool: StoragePool) => {
  const candidates = context.buildings.filter(building => building.typeId === 39 &&
    storagePoolFor(context, building)?.id === pool.id).sort((a, b) => a.uid - b.uid);
  return candidates.find(building => building.uid === pool.collectHarbourUid) ?? candidates[0];
};

export const storageCollect = (context: SettlementContext, uid: number) => {
  const building = context.buildings.find(entry => entry.uid === uid);
  const pool = building && storagePoolFor(context, building);
  const harbourPools = new Set(context.buildings.filter(entry => entry.typeId === 39)
    .map(entry => storagePoolFor(context, entry)?.id).filter(id => id !== undefined));
  const visible = harbourPools.size > 1;
  const available = visible && pool !== undefined && harbourPools.has(pool.id);
  const unavailableWares = [...new Set((context.storagePools?.pools ?? [])
    .filter(entry => entry.id !== pool?.id).flatMap(entry => entry.collect ?? []))].sort();
  let reason: string | undefined;
  if (visible && !available) reason = "Build a harbour on this island to collect wares";
  return { visible, available, wares: [...pool?.collect ?? []], unavailableWares, reason };
};

export const setStorageCollect = (context: SettlementContext, uid: number, ware: string, enabled: boolean) => {
  const building = context.buildings.find(entry => entry.uid === uid);
  const pool = building && storagePoolFor(context, building);
  if (!pool || typeof enabled !== "boolean" || !isSharedStorageWare(ware) || !SETTLEMENT_WARES.includes(ware) ||
    enabled && !storageCollect(context, uid).available) return false;
  if (enabled && context.storagePools?.pools.some(entry => entry.id !== pool.id && entry.collect?.includes(ware)))
    return false;
  const wares = new Set(pool.collect ?? []);
  if (enabled) wares.add(ware);
  else wares.delete(ware);
  pool.collect = [...wares].sort();
  if (enabled) pool.collectHarbourUid = collectingHarbour(context, pool)?.uid;
  context.naval?.shippingDemandChanged?.(uid);
  return true;
};
