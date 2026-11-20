import { addGood } from "../settlement/production-rules";
import { isOwnBuilding } from "../settlement/settlement-home";
import type { Goods, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";
import { storagePoolById, storagePoolFor } from "../settlement/shared-storage";
import { stockLandAt } from "../settlement/stock-lands";
import type { TradeEscrow, TradePaidCustody } from "./trade-types";

export const tradePaidCustody = (
  building: SettlementBuilding, context?: SettlementContext
): TradePaidCustody | undefined => {
  if (building.storagePoolId === undefined) return undefined;
  const pool = context && storagePoolById(context, building.storagePoolId);
  const width = context?.options.world.cellsX ?? 1;
  const anchor = pool ? { x: pool.anchor % width, z: Math.floor(pool.anchor / width) } : { ...building.access };
  return { version: 1, poolId: building.storagePoolId, anchor };
};

/** An orphaned pool is still the donor; a different island's door never substitutes for it. */
export const creditTradeCustody = (
  context: SettlementContext, custody: TradePaidCustody, goods: Readonly<Goods>
) => {
  const pool = storagePoolById(context, custody.poolId);
  if (!pool || pool.owner !== 0 || !custodyMatchesPool(context, custody)) return false;
  if (Object.entries(goods).some(([ware, amount]) => !Number.isSafeInteger(amount) || amount < 0 ||
    !Number.isSafeInteger((pool.available[ware] ?? 0) + amount))) return false;
  for (const [ware, amount] of Object.entries(goods)) addGood(pool.available, ware, amount);
  return true;
};

export const hasTradeCustody = (
  context: SettlementContext, building: SettlementBuilding, custody: TradePaidCustody
) => storagePoolFor(context, building)?.id === custody.poolId;

const custodyMatchesPool = (context: SettlementContext, custody: TradePaidCustody) => {
  const pool = storagePoolById(context, custody.poolId), world = context.options.world;
  if (!pool) return false;
  // Pools follow stock lands: a standing bridge joins both banks' landmasses.
  const land = stockLandAt(context, custody.anchor);
  return land >= 0 && land === stockLandAt(context, { x: pool.anchor % world.cellsX,
    z: Math.floor(pool.anchor / world.cellsX) });
};

/** Pools that paid custody of these escrows still names. */
export const escrowCustodyPools = (escrows: readonly TradeEscrow[]) =>
  escrows.flatMap(escrow => escrow.custody ? [escrow.custody.poolId] : []);

/** Two pools merged (a bridge joined their banks): custody moves to the surviving pool. */
export const repointEscrowCustody = (escrows: readonly TradeEscrow[], from: number, to: number) => {
  for (const escrow of escrows) if (escrow.custody?.poolId === from) escrow.custody.poolId = to;
};

/** Full saves bind paid records to their real donor, including records with a demolished access. */
export const tradeCustodyReason = (context: SettlementContext, escrows: readonly TradeEscrow[]) => {
  for (const escrow of escrows) {
    const custody = escrow.custody;
    if (!custody) continue;
    if (!custodyMatchesPool(context, custody)) return "Trade paid custody does not match its original pool";
    for (const uid of [escrow.harbourUid, ...escrow.held.map(row => row.uid)]) {
      const building = context.buildings.find(entry => entry.uid === uid);
      if (building && building.construction === 1 && isOwnBuilding(building) &&
        building.storagePoolId !== custody.poolId)
        return "Trade paid custody crosses storage pools";
    }
  }
  return null;
};
