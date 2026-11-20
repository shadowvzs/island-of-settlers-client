import { NO_ISLAND_STORAGE_REASON } from "./constants";
import { localConstructionStock, localStockAccess } from "./settlement-local-stock";
import { PLAYER_FACTION } from "./settlement-ownership";
import type { Goods, SettlementContext, SettlementPoint } from "./settlement-types";
import { storagePoolAt } from "./shared-storage";
import { wareDisplayName } from "./ware-names";

/**
 * NEW-ISLAND-FEEDBACK (owner, 2026-11-12): why a construction site cannot be paid from the plot's own landmass.
 * English source sentences (`NO_ISLAND_STORAGE_REASON` in constants.ts); `translateDomainText` maps them to
 * `domain.refusal.*` descriptors for the player.
 */
export const notEnoughOnIslandReason = (ware: string, missing: number) =>
  `Not enough ${wareDisplayName(ware)} on this island (missing ${missing})`;

/** Free construction stock of a ware for a plot access point, in the pool of the site's owner. */
export type ConstructionStockLookup = (ware: string, point: SettlementPoint, owner?: number) => number;

/**
 * The first required ware the plot's landmass cannot pay, in `required` order (the order placement always
 * checked). A landmass without any storage access gets the storage reason instead of a ware shortfall.
 */
export const constructionStockReason = (
  context: SettlementContext, required: Readonly<Goods>, point: SettlementPoint, freeStock: ConstructionStockLookup,
  owner = PLAYER_FACTION
) => {
  for (const [ware, count] of Object.entries(required)) {
    const free = freeStock(ware, point, owner);
    if (free >= count) continue;
    if (!localStockAccess(context, point, owner)) return NO_ISLAND_STORAGE_REASON;
    return notEnoughOnIslandReason(ware, count - Math.max(0, free));
  }
  return null;
};

interface CachedFreeStock { available: number; free: number }

/**
 * Preview-only lookup: `localConstructionStock` walks every building (and every actor's next delivery) per
 * ware, so the placement preview reuses one answer per landmass pool and ware until the game tick, the
 * building or actor list, or that pool's balance changes. Commands keep the uncached lookup.
 */
export const createCachedConstructionStock = (context: SettlementContext): ConstructionStockLookup => {
  const cache = new Map<string, CachedFreeStock>();
  let revision = "";
  return (ware, point) => {
    const pool = storagePoolAt(context, point);
    if (!pool) return localConstructionStock(context, ware, point);
    const current = `${context.clock?.tick() ?? 0}/${context.buildings.length}/${context.actors.length}`;
    if (current !== revision) { cache.clear(); revision = current; }
    const key = `${pool.id}/${ware}`, available = pool.available[ware] ?? 0;
    const cached = cache.get(key);
    if (cached?.available === available) return cached.free;
    const free = localConstructionStock(context, ware, point);
    cache.set(key, { available, free });
    return free;
  };
};
