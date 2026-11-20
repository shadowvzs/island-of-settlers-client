import { isOwnBuilding } from "../settlement/settlement-home";
import type { Goods, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";
import { storageContribution } from "../settlement/storage-capacity";
import { hasTradeCustody } from "./trade-custody";
import { addGoods, goodsCount, subtractGoods } from "./trade-ledger";
import type { SettlementTradeSave, TradeEscrow, TradeHeldGoods, TradeIslandPort } from "./trade-types";

/**
 * Paid escrow (TRADE-01 phase 2, owner 2026-10-19): paid wares are reserved out of storage stock at once
 * (no double spend) into the harbour's trade stock (`staged`), where the trade ship loads them. Since the
 * shared storage pools the harbour reserves from its own pool, so the payment is staged at once: no carrier
 * walks it (pool-trade 2026-11-11). `held` rows (reserved at another door) only come from older saves or a
 * harbour that is gone; they are staged as soon as the escrow has a harbour of its pool.
 */

const heldGoods = (held: readonly TradeHeldGoods[]) => held.reduce<Goods>((sum, row) => addGoods(sum, row.goods), {});

/** Every owed ware lies in the harbour's trade stock: the ship can take it all. */
export const isEscrowCollected = (escrow: TradeEscrow) =>
  !escrow.held.length && !Object.keys(subtractGoods(escrow.goods, escrow.staged)).length;

/** Cancelled before loading: held wares stay where they are, staged wares enter the harbour. */
export const returnEscrow = (escrow: TradeEscrow, port: TradeIslandPort) => {
  if (port.refund) return port.refund(escrow);
  port.release(escrow.held, escrow.custody);
  if (goodsCount(escrow.staged)) port.store(escrow.staged, escrow.harbourUid, escrow.custody);
  return true;
};

const isStorage = (buildings: readonly SettlementBuilding[], uid: number) =>
  buildings.some(building => building.uid === uid && storageContribution(building) > 0);

/** Held wares of a storage that is gone were saved by its carriers: they reach the harbour's trade stock. */
const rescueHeld = (escrow: TradeEscrow, buildings: readonly SettlementBuilding[]) => {
  const lost = escrow.held.filter(row => !isStorage(buildings, row.uid));
  if (!lost.length) return;
  escrow.held = escrow.held.filter(row => isStorage(buildings, row.uid));
  escrow.staged = addGoods(escrow.staged, heldGoods(lost));
};

/** Held wares share the harbour's pool custody: they are staged without a walk. */
export const stageHeldEscrow = (escrow: TradeEscrow) => {
  if (escrow.harbourUid === undefined || !escrow.held.length) return;
  escrow.staged = addGoods(escrow.staged, heldGoods(escrow.held));
  escrow.held = [];
};

/**
 * A lost collecting door may be replaced only within the original donor pool. Paid custody stays on that
 * landmass even with no surviving harbour; interrupted carrier goods can only be reserved there again.
 */
export const reconcileEscrows = (state: SettlementTradeSave, context: SettlementContext) => {
  for (const escrow of state.escrow) {
    if (escrow.harbourUid === undefined || !isTradeHarbourUid(context, escrow.harbourUid) ||
      (escrow.custody && !context.buildings.some(building => building.uid === escrow.harbourUid &&
        hasTradeCustody(context, building, escrow.custody!)))) {
      const replacement = escrow.custody && context.buildings.find(building =>
        isTradeHarbourUid(context, building.uid) && hasTradeCustody(context, building, escrow.custody!));
      if (replacement) escrow.harbourUid = replacement.uid;
      else delete escrow.harbourUid;
    }
    rescueHeld(escrow, context.buildings);
    stageHeldEscrow(escrow);
  }
};

const isTradeHarbourUid = (context: SettlementContext, uid: number) => context.buildings.some(building =>
  building.uid === uid && building.typeId === 39 && building.construction === 1 && isOwnBuilding(building));
