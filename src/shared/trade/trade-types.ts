import type { Goods, SettlementPoint } from "../settlement/settlement-types";

/** One side of a trade: a single ware and a whole amount. */
export interface TradeLot { amount: number; ware: string }

/** A named NPC merchant's finite offer: the player pays `want` and receives `give`; terms never change. */
export interface MerchantOffer {
  give: TradeLot;
  /** `m<day>-<index>`: unique per island and market day. */
  id: string;
  merchant: string;
  status: "open" | "taken";
  want: TradeLot;
}

/** The island's merchant offers of one market day, generated once and saved (stable quoted terms). */
export interface TradeMarket {
  day: number;
  /** Player level the offers were generated for (material level gates). */
  level: number;
  offers: MerchantOffer[];
}

/** The player's own active offer: `give` sits in escrow until an NPC buyer fills it or it is cancelled. */
export interface PlayerOffer {
  /** Escrow holding `give` (reserved out of free stock; carriers bring it to the harbour). */
  escrowId: string;
  /**
   * NPC buyer clock reading (`SettlementTradeSave.buyerClock`, runs only while "NPC traders" is on) at which
   * a buyer fills it; null when no buyer will (greedy beyond reach).
   */
  fillAt: number | null;
  give: TradeLot;
  id: string;
  /** Game second (trade clock) and game time (UTC ms) it was placed; it expires 12 h after `placedTime`. */
  placedAt: number;
  placedTime: number;
  want: TradeLot;
}

/** Wares of one storage reserved for an escrow (older saves / no harbour), staged once it has a harbour. */
export interface TradeHeldGoods { goods: Goods; uid: number }

/** Original paid donor; removing a door never changes the physical owner of its escrow. */
export interface TradePaidCustody { version: 1; poolId: number; anchor: SettlementPoint }

/**
 * Paid wares on their way out (physical escrow, phase 2). `purchase`: payment for a merchant offer; `offer`: an
 * own offer's wares; `sale`: a filled own offer's wares. `goods` is what is still owed to the buyer: `staged`
 * lies in the harbour's trade stock (pool custody), `held` is reserved at another door until the escrow has
 * a harbour. The trade ship loads from `staged`.
 */
export interface TradeEscrow {
  custody?: TradePaidCustody;
  goods: Goods;
  /** Harbour collecting the wares (absent while the island has no finished harbour). */
  harbourUid?: number;
  held: TradeHeldGoods[];
  id: string;
  purpose: "offer" | "purchase" | "sale";
  /** Offer id it belongs to. */
  ref: string;
  staged: Goods;
}

/**
 * Wares the neutral trade ship brings to this island's harbour (`goods`: still to unload, also while aboard).
 * `escrowId` names the escrow the ships carry away. A delivery is served by one ship at a time; a delivery or
 * escrow larger than a ship's hold takes several ships. Pending deliveries count as incoming storage.
 */
export interface TradeDeliveryRequest {
  /** Inbound wares aboard the serving ship (part of `goods` until it unloads). */
  aboard?: Goods;
  createdAt: number;
  escrowId?: string;
  goods: Goods;
  id: string;
  kind: "purchase" | "refund" | "sale";
  /** Escrow wares the serving ship is loading (after it unloaded). */
  outbound?: Goods;
  /** Pier queue number of the serving ship (lower docks first). */
  queue?: number;
  ref: string;
  /** Fleet id of the trade ship serving it now. */
  shipId?: number;
}

/** History row with a real (game clock, UTC ms) timestamp. */
export interface TradeHistoryEntry {
  at: number;
  gave?: TradeLot;
  id: string;
  /** `expired`: an own offer nobody filled within its lifetime; its wares returned. */
  kind: "bought" | "cancelled" | "expired" | "sold";
  merchant?: string;
  received?: TradeLot;
}

/** One island's trade state (saved in the island's settlement save; lists become table rows on disk). */
export interface SettlementTradeSave {
  /** NPC buyer clock: game seconds traded while "NPC traders" was on (own offers fill on it). */
  buyerClock: number;
  deliveries: TradeDeliveryRequest[];
  /** Game seconds the island has traded (trade clock: market days and NPC buyers). */
  elapsed: number;
  escrow: TradeEscrow[];
  /** Per-ware protected floors set by the player (defaults: shared balance `TRADE_PROTECTED_FLOORS`). */
  floors: Record<string, number>;
  history: TradeHistoryEntry[];
  market: TradeMarket | null;
  nextId: number;
  /** Debug-menu "NPC traders": NPC buyers fill own offers only while on (journalled command). */
  npcTraders: boolean;
  offers: PlayerOffer[];
  version: 2;
}

/** `true` when a command succeeded or may run, otherwise the player-facing reason. */
export type TradeCheck = true | string;

/** The island facts a trade command checks (island-local storage, capacity and harbour). */
export interface TradeIslandView {
  /** Island capacity − stored − incoming manifests − pending trade deliveries, per ware. */
  freeCapacity(ware: string): number;
  /** Stored in completed storages − wares reserved for construction, voyages and recruits. */
  freeStock(ware: string): number;
  /** The game rules switch trading off (GS4a): the refusal shown, absent or null while trading is on. */
  featureOff?: string | null;
  harbour: "missing" | "ready" | "unfinished";
  /** The island's nation: other nations' drinks and their raw wares are not traded here. */
  nation: string;
  /** Trading exists only on the home island (owner 2026-10-19); colonies and adventure islands refuse. */
  homeIsland: boolean;
  /** Active offers allowed: the base limit plus the trade offer slot talent. */
  offerLimit: number;
  playerLevel: number;
  /** The island's highest material tier (MAP BUILDING AVAILABILITY); absent = every tier. */
  tierCap?: number;
  /** The island already stores at least its storage limit of the ware (stock alone, owner rule). */
  storageFull(ware: string): boolean;
}

/** Where a reservation took the wares from: the harbour's own stock is staged at once, the rest is held. */
export interface TradeReservation {
  custody?: TradePaidCustody;
  harbourUid?: number;
  held: TradeHeldGoods[];
  staged: Goods;
}

/** A view that can also move wares: atomic reservation (all or nothing) and storing at the harbour. */
export interface TradeIslandPort extends TradeIslandView {
  /** Game time (UTC ms) for history and own offer expiry. */
  now(): number;
  /** Puts held wares back into their original pool, or their surviving named storage for historical jobs. */
  release(held: readonly TradeHeldGoods[], custody?: TradePaidCustody): void;
  /** Atomic refund into the original donor pool, including a pool without an access. */
  refund?(reservation: TradeReservation): boolean;
  /** Takes all of `goods` out of storage stock for an escrow, or nothing (null) when any ware falls short. */
  reserve(goods: Readonly<Goods>): TradeReservation | null;
  /** Island seed: merchant offers and NPC buyer rolls derive from it. */
  seed: number;
  /** Stores at the bound donor pool or explicit harbour; a missing explicit door never chooses a foreign one. */
  store(goods: Readonly<Goods>, uid?: number, custody?: TradePaidCustody): boolean | void;
}

/** What the island's trade office wants shipped: the neutral trade ship (fleet side) behind it. */
export interface TradeShipPort {
  /** The payment of the ship sent ahead is at the harbour: it may berth now. */
  ready(shipId: number): void;
  /**
   * Sends a trade ship for `deliveryId` with `cargo` to the harbour; its fleet id, or null (no sea way).
   * `collecting`: the payment is still on its way, so the ship waits offshore until `ready`.
   */
  send(harbourUid: number, cargo: Readonly<Goods>, deliveryId: string, queue: number, collecting?: boolean):
    number | null;
  /** Fleet ids of trade ships still on the map or on their way (to reconcile after a load). */
  shipIds(): ReadonlySet<number>;
}

/** Why a delivery has not been shipped yet (shown by the trade office), or its ship's progress. */
type TradeDeliveryStage = "collecting" | "blocked" | "queued" | "shipping";
export interface TradeDeliveryStatus { blocker?: string; id: string; stage: TradeDeliveryStage }
