import { nearestStorageWithCartRoom } from "./settlement-handcart-ledger";
import { findHomeBuilding } from "./settlement-home";
import type { SettlementContext } from "./settlement-types";

/** Carts handed out and the storages (uids) that now keep them; none granted means all are full. */
export interface DebugHandcartGrant {
  granted: number;
  storages: number[];
}

/**
 * Development menu: finished hand carts shelved at the storage nearest the headquarters that
 * still has room (the storage limit counts carts out on the road), exactly where a cart a
 * Sawmill made ends up once its carrier pulls it home.
 */
export const grantDebugHandcarts = (context: SettlementContext, count: number): DebugHandcartGrant => {
  const home = findHomeBuilding(context);
  const storages: number[] = [];
  if (!home || !Number.isSafeInteger(count) || count <= 0) return { granted: 0, storages };
  let granted = 0;
  while (granted < count) {
    const storage = nearestStorageWithCartRoom(context, home.access);
    if (!storage) break;
    storage.handcarts = (storage.handcarts ?? 0) + 1;
    if (!storages.includes(storage.uid)) storages.push(storage.uid);
    granted++;
  }
  return { granted, storages };
};
