import type { StockDirection, StockGoods, StockMoveResult } from "../../shared/trade/stock-move";
import type { StockMoveAdoptResult, StockMoveApply } from "../save-store/remote-save-store";
import type { EconomyClient } from "./economy-client";

/** One gameplay request: the goods leave (deposit) or enter (withdraw) the saved home island. */
export interface StockMoveRequest {
  direction: StockDirection;
  goods: StockGoods;
  idempotencyKey: string;
}

export type StockMoveFailureReason = "conflict" | "lease-lost" | "no-account" | "not-loaded" | "stale";

export type StockMoveOutcome =
  | { applied: boolean; droppedPending: boolean; ok: true; result: StockMoveResult; revision: number }
  | { message: string; ok: false; reason: StockMoveFailureReason };

export interface StockMoveClient {
  /**
   * Deposits or withdraws `request.goods` against the cloud slot's current revision. Call it after the home
   * island's current state is saved: the API reads the stored snapshot, not this request. `apply` receives the
   * committed delta and server storage totals; it must change live storage without journalling a replay command
   * and reopen the island's command log at the new base (the server snapshot already contains the move).
   */
  move(request: StockMoveRequest, apply?: StockMoveApply): Promise<StockMoveOutcome>;
}

interface StockMoveClientOptions {
  client: Pick<EconomyClient, "depositStock" | "withdrawStock">;
  /** Another device took the live session: the cloud UI asks whether to take it back. */
  onLeaseLost?: () => void;
  slotId: string;
  store: {
    adoptStockMove(move: Parameters<StockMoveApply>[0], apply?: StockMoveApply): Promise<StockMoveAdoptResult>;
    revision: () => number | null;
  };
}

const failure = (reason: StockMoveFailureReason, message: string): StockMoveOutcome =>
  ({ message, ok: false, reason });

/** Typed stock calls plus the cloud-save adoption of their returned revision (docs/server/trade-island-protocol.md). */
export const createStockMoveClient = ({ client, onLeaseLost, slotId, store }: StockMoveClientOptions): StockMoveClient => ({
  move: async (request, apply) => {
    const revision = store.revision();
    if (revision === null) return failure("not-loaded", "Load the cloud save before moving island goods.");
    const body = { goods: request.goods, idempotencyKey: request.idempotencyKey, revision, slotId };
    const answer = request.direction === "deposit"
      ? await client.depositStock(body)
      : await client.withdrawStock(body);
    if (!answer.ok) {
      if (answer.reason === "lease-lost") onLeaseLost?.();
      return failure(answer.reason, answer.message);
    }
    const adopted = await store.adoptStockMove({
      direction: request.direction, goods: answer.goods, revision: answer.revision, storage: answer.storage
    }, apply);
    if (!adopted.ok) return failure(adopted.reason, adopted.reason === "stale"
      ? "The save changed before the stock move finished; reload the newer save and retry."
      : "Load the cloud save before moving island goods.");
    return { applied: adopted.applied, droppedPending: adopted.droppedPending, ok: true, result: answer,
      revision: adopted.revision };
  }
});

/** Guests and tool runs have no server stock: the same interface that refuses without touching the network. */
const NO_STOCK_MOVE: StockMoveClient = {
  move: async () => failure("no-account", "Sign in with a cloud save to move island goods.")
};

/** The account's stock client, or the guest no-op when the session has no cloud save. */
export const stockMoveFor = (cloud: { stock: StockMoveClient } | null | undefined): StockMoveClient =>
  cloud?.stock ?? NO_STOCK_MOVE;
