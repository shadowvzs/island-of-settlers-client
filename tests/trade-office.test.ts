import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import {
  formatTradeTime, getFooterButtons, getTradeError, isSameRows
} from "../src/app/settlement-ui/trade-office/helpers";
import {
  filterMarketRows, getBuyState, getMarketEmptyText, getMarketRows, getOfferTakenText,   getTradeCategoryChoices,
storageFullReason} from "../src/app/settlement-ui/trade-office/market-helpers";
import {
  getDeliveryStatusText, getHistoryRows, getNpcTradersOffText, getOfferCountText, getOwnOfferRows,
  isWaitingForCarriers
} from "../src/app/settlement-ui/trade-office/offers-helpers";
import { HistoryPanel, MyOffersPanel } from "../src/app/settlement-ui/trade-office/offers-panels";
import {
  clampLot, EMPTY_PLACE_DRAFT, getEstimate, getGiveChoices, getIslandTradeWares, getPickerView, getSideChoices,
  getSideView, getWantChoices, pickDraftWare
} from "../src/app/settlement-ui/trade-office/place-offer-helpers";
import { isSameTradeOffice, selectTradeOffice } from "../src/app/settlement-ui/trade-office/select-trade-office";
import { CancelOfferDialog, TradeErrorDialog } from "../src/app/settlement-ui/trade-office/trade-dialogs";
import { TradeOffice } from "../src/app/settlement-ui/trade-office/trade-office";
import type { SettlementTradeOffice } from "../src/app/settlement-ui/trade-office/types";
import { WarePicker } from "../src/app/settlement-ui/trade-office/ware-picker";
import type { SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import type { SettlementTradeSave } from "../src/shared/trade/trade-types";
import { renderWithI18n } from "./helpers/render-with-i18n";

const STATE = {
  deliveries: [{ createdAt: 0, goods: { stone: 12 }, id: "d9", kind: "sale", ref: "o3" }],
  escrow: [{ goods: { planks: 20 }, held: [{ goods: { planks: 20 }, uid: 4 }], id: "e2", purpose: "offer",
    ref: "o1", staged: {} }],
  history: [
    { at: Date.UTC(2026, 9, 18, 9, 30), gave: { amount: 10, ware: "fish" }, id: "h1", kind: "bought",
      merchant: "Livia Portus", received: { amount: 6, ware: "planks" } },
    { at: Date.UTC(2026, 9, 19, 14, 5), gave: { amount: 4, ware: "stone" }, id: "h2", kind: "cancelled" }
  ],
  market: { day: 0, level: 1, offers: [
    { give: { amount: 6, ware: "planks" }, id: "m0-0", merchant: "Livia Portus", status: "open",
      want: { amount: 10, ware: "fish" } },
    { give: { amount: 30, ware: "stone" }, id: "m0-1", merchant: "Bjorn Saltbeard", status: "open",
      want: { amount: 2, ware: "hammer" } },
    { give: { amount: 3, ware: "bread" }, id: "m0-2", merchant: "Chiyo Hamada", status: "taken",
      want: { amount: 5, ware: "logs" } }
  ] },
  npcTraders: false,
  offers: [{ escrowId: "e2", fillAt: null, give: { amount: 20, ware: "planks" }, id: "o1", placedAt: 0,
    placedTime: 0, want: { amount: 9, ware: "fish" } }]
} as unknown as SettlementTradeSave;

const STOCK: Record<string, number> = { fish: 40, logs: 0, planks: 25, stone: 3 };
const ROOM: Record<string, number> = { bread: 50, fish: 0, planks: 100, stone: 0 };

const fakeTrade = (overrides: Partial<SettlementTradeOffice> = {}): SettlementTradeOffice => ({
  buy: () => true,
  cancelOffer: () => true,
  checkBuy: id => (id === "m0-1" ? "Not enough free Hammers: needs 2, 0 free" : true),
  checkPlace: () => true,
  estimate: (give, want) => (want.amount > give.amount ? "unlikely" : "likely"),
  freeCapacity: ware => ROOM[ware] ?? 10,
  freeStock: ware => STOCK[ware] ?? 0,
  offerLimit: 5,
  placeOffer: () => true,
  snapshot: () => STATE,
  ...overrides
});

const SNAPSHOT: SettlementUiSnapshot = { player: { level: 1 } as never, playerNation: "roman" };

describe("trade office market", () => {
  it("enables Buy only when the simulation agrees, shows full storage and taken offers", () => {
    const trade = fakeTrade();
    const [planks, stone, bread] = getMarketRows(trade, STATE.market);
    expect(planks).toMatchObject({ buyDisabled: false, buyLabel: "Buy 6 Softwood planks for 10 Fish", reason: "" });
    expect(stone).toMatchObject({ buyDisabled: true, buyTitle: storageFullReason("stone") });
    expect(storageFullReason("stone")).toBe("Storage for Stone is full");
    expect(bread).toMatchObject({ buyDisabled: true, reason: getOfferTakenText(), taken: true });
    const room = fakeTrade({ freeCapacity: () => 10 });
    expect(getBuyState(room, STATE.market!.offers[1]!)).toBe("Not enough free Hammers: needs 2, 0 free");
    expect(getBuyState(fakeTrade({ storageFull: ware => ware === "planks" }), STATE.market!.offers[0]!))
      .toBe("Storage for Softwood planks is full");
  });

  it("shows how much of an accepted offer's payment is at the harbour while carriers collect it", () => {
    const paid = { goods: { logs: 5 }, held: [{ goods: { logs: 3 }, uid: 4 }], id: "e7", purpose: "purchase",
      ref: "m0-2", staged: { logs: 2 } } as SettlementTradeSave["escrow"][number];
    const bread = getMarketRows(fakeTrade(), STATE.market, [paid])[2]!;
    expect(bread.reason).toBe(`${getOfferTakenText()} · 2/5 wares at the harbour`);
    const bought = { createdAt: 0, escrowId: "e7", goods: { bread: 3 }, id: "d4", kind: "purchase", ref: "m0-2" } as
      SettlementTradeSave["deliveries"][number];
    const rows = getOwnOfferRows({ ...STATE, deliveries: [bought], escrow: [paid], offers: [] },
      [{ id: "d4", stage: "collecting" }]);
    expect(rows[0]!.status).toBe("Bought · delivering (2/5 wares at the harbour)");
    const collected = { ...paid, held: [], staged: { logs: 5 } };
    expect(getMarketRows(fakeTrade(), STATE.market, [collected])[2]!.reason).toBe(getOfferTakenText());
  });

  it("filters by category and search without reordering", () => {
    const rows = getMarketRows(fakeTrade(), STATE.market);
    expect(getTradeCategoryChoices()[0]).toEqual({ label: "All", value: "all" });
    expect(filterMarketRows(rows, "all", "").map(row => row.id)).toEqual(["m0-0", "m0-1", "m0-2"]);
    expect(filterMarketRows(rows, "food", "").map(row => row.id)).toEqual(["m0-0", "m0-2"]);
    expect(filterMarketRows(rows, "all", "  PLAN ").map(row => row.id)).toEqual(["m0-0"]);
    expect(filterMarketRows(rows, "tools", "fish")).toEqual([]);
    expect(getMarketEmptyText(3)).toBe("No offer matches the filters.");
    expect(getMarketEmptyText(0)).toBe("No merchant offers today.");
  });
});

describe("trade office place offer", () => {
  it("offers only wares with free stock to give and with room to want", () => {
    const trade = fakeTrade({ storageFull: ware => ware === "bread" });
    const wares = ["fish", "logs", "planks", "stone", "bread"];
    expect(getGiveChoices(trade, wares).map(choice => choice.ware)).toEqual(["fish", "planks", "stone"]);
    expect(getWantChoices(trade, wares).map(choice => [choice.ware, choice.max]))
      .toEqual([["logs", 10], ["planks", 100]]);
    expect(getIslandTradeWares(SNAPSHOT)).toContain("planks");
    expect(getIslandTradeWares(SNAPSHOT)).not.toContain("mahoganyPlanks");
  });

  it("keeps the offered and requested wares different", () => {
    const choices = getGiveChoices(fakeTrade(), ["fish", "planks"]);
    const draft = { ...EMPTY_PLACE_DRAFT, want: { amount: 3, ware: "fish" } };
    expect(getSideChoices(draft, "give", choices).map(choice => choice.ware)).toEqual(["planks"]);
    expect(getSideChoices(EMPTY_PLACE_DRAFT, "give", choices)).toBe(choices);
    expect(pickDraftWare(draft, "give", "fish", 40)).toEqual({ give: { amount: 1, ware: "fish" }, picker: null,
      want: null });
    expect(pickDraftWare(draft, "give", "planks", 2)).toEqual({ give: { amount: 1, ware: "planks" }, picker: null,
      want: { amount: 3, ware: "fish" } });
    expect(pickDraftWare({ ...draft, give: { amount: 9, ware: "stone" } }, "give", "planks", 5).give)
      .toEqual({ amount: 5, ware: "planks" });
  });

  it("clamps the draft to the current stock and prepares sides, picker and estimate", () => {
    const choices = getGiveChoices(fakeTrade(), ["planks"]);
    expect(clampLot({ amount: 99, ware: "planks" }, choices)).toEqual({ amount: 25, ware: "planks" });
    expect(clampLot(null, choices)).toBeNull();
    expect(getSideView("give", null, false)).toMatchObject({ empty: "Choose what you give", lot: null });
    expect(getSideView("want", { amount: 3, ware: "fish" }, true))
      .toMatchObject({ label: "I want: 3 Fish", open: true });
    const picker = getPickerView("give", choices, { amount: 5, ware: "planks" });
    expect(picker).toMatchObject({ amount: 5, emptyText: "", max: 25 });
    expect(picker.choices[0]).toMatchObject({ selected: true, ware: "planks" });
    expect(getPickerView("want", [], null).emptyText).toBe("Every storage is full.");
    const trade = fakeTrade();
    expect(getEstimate(trade, null, null).tone).toBe("none");
    expect(getEstimate(trade, { amount: 5, ware: "fish" }, { amount: 2, ware: "stone" }))
      .toEqual({ text: "Merchants will likely accept", tone: "likely" });
  });
});

describe("trade office offers and history", () => {
  it("lists own offers with status and deliveries with their stage", () => {
    expect(isWaitingForCarriers(STATE, STATE.offers[0]!)).toBe(true);
    const rows = getOwnOfferRows(STATE, [{ id: "d9", stage: "queued" }]);
    expect(rows.map(row => [row.status, row.canCancel])).toEqual([
      ["Waiting for carriers", true], ["Filled · delivering (ship queued for the pier)", false]
    ]);
    expect(rows[0]!.returnText).toBe("20 Softwood planks return to your storage at once (wares already at or on their way to the harbour stay there).");
    expect(rows[1]!.goodsText).toBe("12 Stone");
    expect(getDeliveryStatusText(STATE.deliveries[0]!, { blocker: "No harbour", id: "d9", stage: "blocked" }))
      .toBe("Filled · delivering (No harbour)");
    const staged = { ...STATE, escrow: [{ ...STATE.escrow[0]!, held: [], staged: { planks: 20 } }] };
    expect(getOwnOfferRows(staged)[0]!.status).toBe("Listed");
    expect(getOfferCountText(3, 5)).toBe("Active offers: 3/5");
  });

  it("shows history newest first with locale date and time", () => {
    const rows = getHistoryRows(STATE.history, "en-GB");
    expect(rows.map(row => row.title)).toEqual(["Cancelled", "Bought from Livia Portus"]);
    expect(rows[0]).toMatchObject({ gave: { text: "4 Stone" }, received: null });
    expect(rows[1]!.time).toBe(formatTradeTime(STATE.history[0]!.at, "en-GB"));
    expect(formatTradeTime(Date.UTC(2026, 9, 18, 9, 30), "en-GB")).toMatch(/18 Oct 2026/);
  });
});

describe("trade office selection and wiring", () => {
  it("computes only the shown panel and compares structurally", () => {
    const trade = fakeTrade();
    const market = selectTradeOffice(SNAPSHOT, trade, "market");
    expect(market.market).toHaveLength(3);
    expect(market.offers).toEqual([]);
    expect(market.npcTradersOff).toBe(true);
    expect(isSameTradeOffice(market, selectTradeOffice(SNAPSHOT, trade, "market"))).toBe(true);
    expect(isSameTradeOffice(market, selectTradeOffice(SNAPSHOT, trade, "offers"))).toBe(false);
    expect(isSameRows([{ a: { b: 1 } }], [{ a: { b: 2 } }])).toBe(false);
  });

  it("prepares the footer, the error and the home-only harbour market button", () => {
    expect(getFooterButtons("offers").map(button => [button.label, button.pressed])).toEqual([
      ["Market offers", false], ["Place offer", false], ["My offers", true], ["History", false]
    ]);
    expect(getTradeError(true, "x")).toBeNull();
    expect(getTradeError("This offer was already taken", "Purchase failed"))
      .toEqual({ message: "This offer was already taken", title: "Purchase failed" });
  });

  it("renders the market with ware tooltips, Buy buttons, filters and the footer", () => {
    const store = createSettlementUiStore();
    store.update(SNAPSHOT);
    const visibility = createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
    const markup = renderWithI18n(createElement(TradeOffice, { store, trade: fakeTrade(), visibility }));
    expect(markup).toContain('aria-label="Buy 6 Softwood planks for 10 Fish"');
    expect(markup).toContain('title="Softwood planks"');
    expect(markup).toContain('data-offer-id="m0-2" data-taken="true"');
    expect(markup).toContain("Storage for Stone is full");
    expect(markup).toContain('aria-label="Category"');
    expect(markup).toContain('aria-label="Search wares"');
    for (const label of ["Place offer", "My offers", "History"]) expect(markup).toContain(`aria-label="${label}"`);
  });

  it("renders my offers with the NPC note, history times, the picker and the dialogs", () => {
    const offers = getOwnOfferRows(STATE);
    const offersMarkup = renderWithI18n(createElement(MyOffersPanel, {
      countText: "Active offers: 1/5", emptyText: "", npcNote: getNpcTradersOffText(), rows: offers, onCancel: () => {}
    }));
    expect(offersMarkup).toContain('data-npc-traders="off"');
    expect(offersMarkup).toContain("Waiting for carriers");
    expect(offersMarkup).toContain('aria-label="Cancel offer 20 Softwood planks for 9 Fish"');
    const history = renderWithI18n(createElement(HistoryPanel, {
      emptyText: "", rows: getHistoryRows(STATE.history, "en-GB")
    }));
    expect(history).toContain('data-history-kind="bought"');
    expect(history).toContain("<time");
    const picker = getPickerView("give", getGiveChoices(fakeTrade(), ["fish", "planks"]), { amount: 5, ware: "fish" });
    const pickerMarkup = renderWithI18n(createElement(WarePicker, {
      picker, onAmount: () => {}, onDone: () => {}, onPick: () => {}
    }));
    expect(pickerMarkup).toContain('aria-label="Fish: 40 free" aria-pressed="true"');
    expect(pickerMarkup).toContain('aria-label="Amount to give slider"');
    expect(pickerMarkup).toContain('max="40"');
    const error = renderWithI18n(createElement(TradeErrorDialog, {
      error: { message: "This offer was already taken", title: "Purchase failed" }, onClose: () => {}
    }));
    expect(error).toContain('role="alertdialog"');
    expect(error).toContain("This offer was already taken");
    const cancel = renderWithI18n(createElement(CancelOfferDialog, {
      row: offers[0]!, onClose: () => {}, onConfirm: () => {}
    }));
    expect(cancel).toContain("return to your storage at once");
  });
});
