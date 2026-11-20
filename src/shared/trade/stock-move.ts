import type { Goods } from "../../../../island-of-settlers-shared/src/goods";

/**
 * Server-backed island stock moves (`docs/server/trade-island-protocol.md`): the body names the save slot and
 * its revision, the moved goods and an idempotency key; the answer carries the committed revision, the same
 * moved goods, the home island's storage totals and the server wallet.
 *
 * Amounts stay integer: the API accepts positive safe integers and the client only forwards them.
 */
export type StockDirection = "deposit" | "withdraw";
/** Stock move goods: the shared ware → amount map. */
export type StockGoods = Goods;

export interface StockMoveBody {
  goods: StockGoods;
  idempotencyKey: string;
  revision: number;
  slotId: string;
}

/** The server wallet fields a stock move returns (gems and goods while they wait for withdrawal). */
export interface StockWallet {
  blessingScrolls: number;
  delivery: string;
  gems: number;
  inventory: StockGoods;
  /** The subset of `inventory` acquired from accepted Market trades. */
  received?: StockGoods;
  revision: number;
}

export interface StockMoveResult {
  goods: StockGoods;
  revision: number;
  slotId: string;
  /** The saved home island's positive storage totals after the move; an absent ware is zero. */
  storage: StockGoods;
  wallet: StockWallet;
}

/**
 * What a cloud save adopts after a committed stock move: the new slot revision, the same local delta and the
 * server's storage totals. `direction` says whether the delta leaves (deposit) or enters (withdraw) the island.
 */
export interface StockMoveAdoption {
  direction: StockDirection;
  goods: StockGoods;
  revision: number;
  storage: StockGoods;
}
