import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import type { TradeCheck, TradeEscrow, TradeLot } from "../../../shared/trade/trade-types";
import { formatWareCount } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";

export type TradeOfficePanel = "history" | "market" | "offers" | "place";

export const countWares = (goods: Readonly<Record<string, number>>) =>
  Object.values(goods).reduce((sum, amount) => sum + amount, 0);

/** "12/61 wares at the harbour" while carriers still bring the escrow there, else "". */
export const getEscrowProgressText = (escrow?: Readonly<TradeEscrow>, i18n?: I18n) => {
  if (!escrow) return "";
  const total = countWares(escrow.goods), staged = countWares(escrow.staged);
  return staged < total ? translateMessage(i18n, M.trade.escrowProgress, { staged, total }) : "";
};

/** One side of a trade, ready to render: icon ware, count, ware name (search) and the full text. */
export interface TradeLotView {
  amount: string;
  name: string;
  text: string;
  ware: string;
}

export const getLotView = ({ amount, ware }: TradeLot): TradeLotView => ({
  amount: Math.round(amount).toLocaleString("en-US"),
  name: wareDisplayName(ware),
  text: formatWareCount(amount, ware),
  ware
});

/** Rows whose own values are all equal (rows hold primitives and lot views only). */
const isSameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || !left || !right) return false;
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, value]) => isSameValue(value, (right as Record<string, unknown>)[key]));
};

/** Structural equality of prepared rows (no `JSON.stringify` signatures). */
export const isSameRows = <T extends object>(left: readonly T[], right: readonly T[]) =>
  left.length === right.length && left.every((row, index) => isSameValue(row, right[index]));

/** Failed command → the error dialog text; null when it succeeded. */
export const getTradeError = (result: TradeCheck, title: string) =>
  result === true ? null : { message: result, title };

export type TradeError = NonNullable<ReturnType<typeof getTradeError>>;

/** Footer navigation: each button shows its panel (the shown one is pressed). */
export const getFooterButtons = (panel: TradeOfficePanel, i18n?: I18n) => [
  { icon: "market", id: "market" as const, label: translateMessage(i18n, M.trade.offers) },
  { icon: "export", id: "place" as const, label: translateMessage(i18n, M.trade.placeOffer) },
  { icon: "register", id: "offers" as const, label: translateMessage(i18n, M.trade.myOffers) },
  { icon: "statistics", id: "history" as const, label: translateMessage(i18n, M.trade.history) }
].map(button => ({ ...button, pressed: button.id === panel }));

/** Which panel section renders (one at a time). */
export const getShownPanel = (panel: TradeOfficePanel) => ({
  history: panel === "history",
  market: panel === "market",
  offers: panel === "offers",
  place: panel === "place"
});

/** Locale date and time of a history entry (one cached formatter per locale). */
const formatters = new Map<string, Intl.DateTimeFormat>();
export const formatTradeTime = (at: number, locale?: string) => {
  const key = locale ?? "";
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    formatters.set(key, formatter);
  }
  return formatter.format(at);
};
