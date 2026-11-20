import { nextTransportReservations } from "./settlement-land-transport-claims";
import { PLAYER_FACTION, servesEconomyOf } from "./settlement-ownership";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { payStorageGoods, storagePoolAt, storagePoolFor } from "./shared-storage";
import { uniquePoolSources } from "./shared-storage-ware-sources";

export const sharesLocalStockPool = (
  context: SettlementContext, point: SettlementPoint, building: SettlementBuilding
) => {
  if (!context.storagePools) return true; // Bare legacy fixtures have no pooled runtime view.
  const pool = storagePoolAt(context, point);
  return pool !== undefined && pool.id === storagePoolAt(context, building.access)?.id;
};

/** Ware availability is pooled once; people remain counted separately at each actual access. */
export const localStockSources = (
  context: SettlementContext, point: SettlementPoint, sources: readonly SettlementBuilding[]
) => uniquePoolSources(sources.filter(source => sharesLocalStockPool(context, point, source)));

/** A balance without a surviving physical access remains stranded, not a remote payment source. */
export const localStockAccess = (context: SettlementContext, point: SettlementPoint, owner = PLAYER_FACTION) => {
  const pool = storagePoolAt(context, point, owner);
  if (!pool) return undefined;
  return context.buildings.find(building => storagePoolFor(context, building)?.id === pool.id);
};

/**
 * Construction promises and unpaid next jobs of `owner`'s economy spend the same one balance, once (a
 * site of a `none` faction still counts against the player's, as before: `servesEconomyOf`).
 */
/** What a site still needs of `ware` beyond its delivered, incoming and consumed amounts (promised stock). */
export const outstandingConstructionNeed = (building: SettlementBuilding, ware: string) =>
  Math.max(0, (building.required[ware] ?? 0) - (building.input[ware] ?? 0) - (building.incoming[ware] ?? 0) -
    (building.constructionConsumed?.[ware] ?? 0));

export const localConstructionStock = (
  context: SettlementContext, ware: string, point: SettlementPoint, owner = PLAYER_FACTION
) => {
  const access = localStockAccess(context, point, owner);
  const pool = access && storagePoolFor(context, access);
  if (!access || !pool) return 0;
  let free = (pool.available[ware] ?? 0) - nextTransportReservations(context, access.uid, ware);
  for (const building of context.buildings) {
    if (!servesEconomyOf(context, building, owner) || storagePoolAt(context, building.access, owner)?.id !== pool.id)
      continue;
    free -= outstandingConstructionNeed(building, ware);
  }
  return free;
};

/** Pay only a complete feasible set from the selected physical landmass. */
export const payLocalConstructionGoods = (
  context: SettlementContext, point: SettlementPoint, goods: Readonly<Goods>
) => {
  const access = localStockAccess(context, point);
  if (!access || Object.entries(goods).some(([ware, amount]) => !Number.isSafeInteger(amount) || amount < 0 ||
    localConstructionStock(context, ware, point) < amount)) return false;
  return payStorageGoods(context, access, goods);
};
