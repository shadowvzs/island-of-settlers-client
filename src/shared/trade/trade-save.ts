import { TRADE_HISTORY_LIMIT, TRADE_MAX_ACTIVE_OFFERS, TRADE_MERCHANT_OFFER_COUNT } from "@shared/catalog/balance";

import { maximumTalentModifier } from "../progression/talents";
import { isFiniteNumber, isSaveInteger, isSaveObject } from "../settlement/save-validation";
import type { Goods } from "../settlement/settlement-types";
import { addGoods, goodsCount, subtractGoods } from "./trade-ledger";
import type { SettlementTradeSave, TradeEscrow } from "./trade-types";
import { isTradableWare, isTradeLot } from "./trade-values";

const ESCROW_PURPOSES = new Set(["offer", "purchase", "sale"]);
const DELIVERY_KINDS = new Set(["purchase", "refund", "sale"]);
const HISTORY_KINDS = new Set(["bought", "cancelled", "expired", "sold"]);

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length < 64;
/** Whole amounts of tradable wares (positive each); `empty` allows none at all. */
const isTradeGoods = (value: unknown, empty = false) => isSaveObject(value) &&
  (empty || Object.keys(value).length > 0) &&
  Object.entries(value).every(([ware, amount]) => isTradableWare(ware) && isSaveInteger(amount, 1));
const optionalGoods = (value: unknown) => value === undefined || isTradeGoods(value, true);
const optionalLot = (value: unknown) => value === undefined || isTradeLot(value);
const everyRecord = (value: unknown, valid: (row: Record<string, unknown>) => boolean, max = Infinity) =>
  Array.isArray(value) && value.length <= max && value.every(row => isSaveObject(row) && valid(row));
const uniqueIds = (rows: readonly { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
/** Counter ids (`o12`, `e13`, …) were issued before `nextId`, so new ones never collide after a load. */
const issuedBefore = (nextId: number) => (row: { id: string }) => {
  const counter = /^[a-z](\d+)$/.exec(row.id);
  return !!counter && Number(counter[1]) < nextId;
};

const validMarket = (market: unknown) => market === null || isSaveObject(market) &&
  isSaveInteger(market.day) && isSaveInteger(market.level, 1) &&
  everyRecord(market.offers, offer => isId(offer.id) && typeof offer.merchant === "string" &&
    (offer.status === "open" || offer.status === "taken") && isTradeLot(offer.give) && isTradeLot(offer.want),
  TRADE_MERCHANT_OFFER_COUNT);
const validOffer = (offer: Record<string, unknown>) => isId(offer.id) && isId(offer.escrowId) &&
  isTradeLot(offer.give) && isTradeLot(offer.want) && isFiniteNumber(offer.placedAt) &&
  isFiniteNumber(offer.placedTime) && (offer.fillAt === null || isFiniteNumber(offer.fillAt));
const validHeld = (held: unknown) => held === undefined || everyRecord(held, row =>
  isSaveInteger(row.uid) && isTradeGoods(row.goods));
/** Held and staged wares never exceed what the escrow still owes (the rest is on carriers). */
const escrowBalanced = (escrow: Record<string, unknown>) => {
  const owed = escrow.goods as Goods;
  const held = ((escrow.held ?? []) as { goods: Goods }[]).reduce<Goods>((sum, row) => addGoods(sum, row.goods), {});
  const parts = addGoods(held, (escrow.staged ?? {}) as Goods);
  return !goodsCount(subtractGoods(parts, owed));
};
export const validTradePaidCustody = (value: unknown) => value === undefined || isSaveObject(value) && value.version === 1 &&
  isSaveInteger(value.poolId) && isSaveObject(value.anchor) &&
  isFiniteNumber(value.anchor.x) && value.anchor.x >= 0 && isFiniteNumber(value.anchor.z) && value.anchor.z >= 0;
const validEscrow = (escrow: Record<string, unknown>) => isId(escrow.id) && isId(escrow.ref) &&
  ESCROW_PURPOSES.has(escrow.purpose as string) && isTradeGoods(escrow.goods, true) && validHeld(escrow.held) &&
  optionalGoods(escrow.staged) && (escrow.harbourUid === undefined || isSaveInteger(escrow.harbourUid)) &&
  validTradePaidCustody(escrow.custody) && escrowBalanced(escrow);
const validDelivery = (delivery: Record<string, unknown>) => isId(delivery.id) && isId(delivery.ref) &&
  DELIVERY_KINDS.has(delivery.kind as string) && isTradeGoods(delivery.goods, true) &&
  isFiniteNumber(delivery.createdAt) && (delivery.escrowId === undefined || isId(delivery.escrowId)) &&
  optionalGoods(delivery.aboard) && optionalGoods(delivery.outbound) &&
  (delivery.shipId === undefined || isSaveInteger(delivery.shipId, 1)) &&
  (delivery.queue === undefined || isSaveInteger(delivery.queue, 1));
const validHistory = (entry: Record<string, unknown>) => isId(entry.id) && isFiniteNumber(entry.at) &&
  HISTORY_KINDS.has(entry.kind as string) && optionalLot(entry.gave) && optionalLot(entry.received) &&
  (entry.merchant === undefined || typeof entry.merchant === "string");
/** Trade mail of version 1 saves (dropped by the owner 2026-10-19): its wares are credited to the harbour. */
const validLegacyMail = (mail: unknown) => mail === undefined || everyRecord(mail, row => isId(row.id) &&
  isTradeGoods(row.goods));
const validFloors = (floors: unknown) => isSaveObject(floors) &&
  Object.entries(floors).every(([ware, amount]) => isTradableWare(ware) && isSaveInteger(amount));

/** Every escrow is owned by exactly one active offer or one delivery; offers point at their own escrow. */
const escrowOwnershipReason = (save: SettlementTradeSave) => {
  const owners = new Map<string, number>();
  for (const id of [...save.offers.map(offer => offer.escrowId), ...save.deliveries.flatMap(row => row.escrowId ?? [])])
    owners.set(id, (owners.get(id) ?? 0) + 1);
  if (save.escrow.some(escrow => owners.get(escrow.id) !== 1)) return "Trade escrow without exactly one owner";
  if (owners.size !== save.escrow.length) return "Trade record names a missing escrow";
  return null;
};

const stateReason = (value: Record<string, unknown>) => {
  if ((value.version !== 1 && value.version !== 2) || !isFiniteNumber(value.elapsed) || value.elapsed < 0 ||
    !isSaveInteger(value.nextId, 1)) return "Invalid trade state";
  if (value.version === 2 && (typeof value.npcTraders !== "boolean" || !isFiniteNumber(value.buyerClock) ||
    value.buyerClock < 0)) return "Invalid trade state";
  return null;
};

/** Optional save section (islands saved before the trade office have none); version 1 (phase 1) still loads. */
export const validateTradeSave = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (!isSaveObject(value)) return "Invalid trade state";
  const state = stateReason(value);
  if (state) return state;
  if (!validMarket(value.market)) return "Invalid merchant offers";
  if (!everyRecord(value.offers, validOffer, TRADE_MAX_ACTIVE_OFFERS + maximumTalentModifier("tradeOfferSlots"))) return "Invalid trade offers";
  if (!everyRecord(value.escrow, validEscrow) || !everyRecord(value.deliveries, validDelivery))
    return "Invalid trade escrow or deliveries";
  if (!everyRecord(value.history, validHistory, TRADE_HISTORY_LIMIT)) return "Invalid trade history";
  if (!validLegacyMail(value.mail) || !validFloors(value.floors)) return "Invalid trade mail or floors";
  const save = value as unknown as SettlementTradeSave;
  const lists = [save.market?.offers ?? [], save.offers, save.escrow, save.deliveries, save.history];
  if (!lists.every(uniqueIds)) return "Duplicate trade record ids";
  if (!lists.slice(1).every(rows => rows.every(issuedBefore(save.nextId)))) return "Trade record id after the next id";
  return escrowOwnershipReason(save);
};

/** A version 1 save (or any save still holding trade mail), already validated. */
type LegacyTradeSave = Omit<SettlementTradeSave, "buyerClock" | "npcTraders" | "version"> &
  Partial<Pick<SettlementTradeSave, "buyerClock" | "npcTraders">> & {
    escrow: (Omit<TradeEscrow, "held" | "staged"> & Partial<Pick<TradeEscrow, "held" | "staged">>)[];
    mail?: { goods: Goods }[];
    version: 1 | 2;
  };

/**
 * Brings a validated save to version 2. Version 1 (phase 1): escrow had left storage at once, so it counts as
 * lying in the harbour's trade stock; NPC buyers ran on the trade clock, so the buyer clock starts there (offers
 * keep their fill times) and NPC traders start off (debug toggle); trade mail is dropped and its wares returned
 * as `credit` for the harbour (owner 2026-10-19: deliveries may overflow storage instead).
 */
export const migrateTradeSave = (saved: unknown): { credit: Goods; state: SettlementTradeSave } => {
  const legacy = structuredClone(saved) as LegacyTradeSave;
  const credit = (legacy.mail ?? []).reduce<Goods>((sum, mail) => addGoods(sum, mail.goods), {});
  const { mail: _mail, ...rest } = legacy;
  const escrow = rest.escrow.map(entry =>
    ({ ...entry, held: entry.held ?? [], staged: entry.staged ?? { ...entry.goods } }));
  const state: SettlementTradeSave = { ...rest, buyerClock: rest.buyerClock ?? rest.elapsed, escrow,
    npcTraders: rest.npcTraders ?? false, version: 2 };
  return { credit, state };
};
