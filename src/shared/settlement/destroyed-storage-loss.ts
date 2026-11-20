import { DESTROYED_STORAGE_LOSS_SHARE } from "../balance/military";
import { talentsOf } from "./settlement-talents";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { storagePoolById, storagePoolFor } from "./shared-storage";
import { storageContribution } from "./storage-capacity";

/** A destroyed storage's part of its pool: its capacity out of the pool's whole capacity. */
interface DestroyedStorageShare { part: number; pool: number; total: number }

/**
 * BD2 (plan review B8f), taken before the removal: a destroyed storage's capacity share of its pool. Undefined
 * for anything that is no access point of a pool (other buildings keep the demolition stock rule).
 */
export const destroyedStorageShare = (
  context: SettlementContext, site: SettlementBuilding
): DestroyedStorageShare | undefined => {
  const pool = storagePoolFor(context, site);
  if (!pool) return undefined;
  const bonus = talentsOf(context, pool.owner).storageCapacity;
  let total = 0;
  for (const building of context.buildings)
    if (storagePoolFor(context, building)?.id === pool.id) total += storageContribution(building, bonus, pool.owner);
  const part = storageContribution(site, bonus, pool.owner);
  return part > 0 && total > 0 ? { part, pool: pool.id, total } : undefined;
};

/**
 * After the removal has released the storage's ship reserve and transport promises into the pool: the lost
 * share of the storage's part of every free ware leaves the pool, rounded down per ware (deterministic).
 */
export const loseDestroyedStorageStock = (context: SettlementContext, share: DestroyedStorageShare) => {
  const pool = storagePoolById(context, share.pool);
  if (!pool) return;
  for (const [ware, amount] of Object.entries(pool.available)) {
    const lost = Math.floor(amount * share.part * DESTROYED_STORAGE_LOSS_SHARE / share.total);
    if (lost > 0) pool.available[ware] = amount - lost;
  }
};
