import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NumberStepper } from "../src/app/components/number-stepper";
import { clampWholeNumber, parseNumberDraft } from "../src/app/components/number-stepper-helpers";
import { Popup } from "../src/app/components/popup";
import { createExternalStore } from "../src/app/components/ui-store";
import { Fleet } from "../src/app/settlement-ui/fleet/fleet";
import {
  getCargoRequest, getCargoWares, getFleetSections, getHarbourOptions, getShipRows, resolveChoice, selectFleet
} from "../src/app/settlement-ui/fleet/helpers";
import {
  EMPTY_SHIP_REGISTER, getShipRegisterView, isSameShipRegisterState, resolveRegisterShip, type ShipRegisterState
} from "../src/app/settlement-ui/ship-register/helpers";
import { ShipRegister } from "../src/app/settlement-ui/ship-register/ship-register";
import type { SettlementShipSummary, SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { renderWithI18n } from "./helpers/render-with-i18n";

const freighter: SettlementShipSummary = {
  destination: "Harbour 8", id: "s1", leg: "Sailing", legSeconds: 75, name: "Ship 1", origin: "Harbour 3",
  passengers: { Builder: 1, Soldier: 3 }, status: "sailing_out", troops: { archer: 3 }, wares: { planks: 12 }
};
const idle: SettlementShipSummary = { id: "s2", name: "Ship 2", status: "idle", wares: { coins: 2 } };
const register = (patch: Partial<ShipRegisterState>): ShipRegisterState =>
  ({ ...EMPTY_SHIP_REGISTER, canLocate: true, hasFollow: true, ship: freighter, shipCount: 2, ...patch });
const noActions = {
  locate: () => {}, step: () => {}, toggleFollow: () => {}, togglePreview: () => {}, troops: () => {}
};
const harbours = [
  { completed: true, id: "3", type: 39 }, { completed: true, id: "8", type: 39 }, { completed: false, id: "9", type: 39 }
];

describe("NumberStepper", () => {
  it("clamps whole numbers and parses only complete drafts", () => {
    expect(clampWholeNumber(7.8, 0, 5)).toBe(5);
    expect(clampWholeNumber(-2, 0, 5)).toBe(0);
    expect(clampWholeNumber(Number.NaN, 1, 5)).toBe(1);
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("-")).toBeNull();
    expect(parseNumberDraft("12")).toBe(12);
  });

  it("renders − / number field / + with labels and bounds", () => {
    const markup = renderToStaticMarkup(createElement(NumberStepper, {
      decreaseLabel: "Fewer", increaseLabel: "More", label: "Count", max: 9, value: 3, onChange: () => {}
    }));
    expect(markup).toBe('<button aria-label="Fewer" class="settlement-ui__button" type="button">−</button>' +
      '<input aria-label="Count" max="9" min="0" step="1" type="number" value="3"/>' +
      '<button aria-label="More" class="settlement-ui__button" type="button">+</button>');
  });

  it("Popup renders an alert dialog with its actions container", () => {
    const markup = renderToStaticMarkup(createElement(Popup, {
      actions: createElement("button", { type: "button" }, "OK"),
      // `children` is a required prop in Popup's type, so the typed createElement call passes it as a prop.
      // oxlint-disable-next-line react/no-children-prop
      children: createElement("h2", { id: "t" }, "Title"),
      focusKey: 1, labelledBy: "t", tone: "question"
    }));
    expect(markup).toBe('<section aria-labelledby="t" aria-modal="true" class="settlement-ui__panel settlement-popup__dialog" ' +
      'data-tone="question" role="alertdialog"><h2 id="t">Title</h2><div class="settlement-popup__actions">' +
      '<button type="button">OK</button></div></section>');
  });
});

describe("ship register", () => {
  it("hides fleet navigation for visiting trade ships while retaining location, manifest and optional services", () => {
    const visitor = { ...freighter, owned: false, name: "Trade ship" };
    const store = createExternalStore(register({ ship: visitor, followAvailable: true,
      hasPreview: true, canPreview: false }));
    const markup = renderWithI18n(createElement(ShipRegister, { actions: noActions, store }));
    expect(getShipRegisterView(store.getSnapshot())?.navigation).toBe(false);
    expect(markup).not.toContain('aria-label="Previous"');
    expect(markup).not.toContain('aria-label="Next"');
    expect(markup).toContain('aria-label="Go to place"');
    expect(markup).toContain('data-count="12" data-ware="planks"');
    expect(markup).toContain('aria-label="Archer: 3"');
    expect(markup).toContain('aria-label="Follow this ship"');
    expect(markup).toContain("Debug deck preview");
    expect(markup).toContain('aria-label="Demo wares"');
    const owned = createExternalStore(register({ ship: { ...freighter, owned: true } }));
    const ownMarkup = renderWithI18n(createElement(ShipRegister, { actions: noActions, store: owned }));
    expect(ownMarkup).toContain('aria-label="Previous"');
    expect(ownMarkup).toContain('aria-label="Next"');
  });

  it("keeps the chosen ship and falls back to the first one", () => {
    expect(resolveRegisterShip([freighter, idle], "s2")).toBe(idle);
    expect(resolveRegisterShip([freighter, idle], "gone")).toBe(freighter);
    expect(resolveRegisterShip([], "s1")).toBeUndefined();
  });

  it("treats a re-published ship with the same values as unchanged", () => {
    const left = register({});
    expect(isSameShipRegisterState(left, register({ ship: { ...freighter, wares: { planks: 12 } } }))).toBe(true);
    expect(isSameShipRegisterState(left, register({ ship: { ...freighter, wares: { planks: 11 } } }))).toBe(false);
    expect(isSameShipRegisterState(left, register({ following: true }))).toBe(false);
  });

  it("prepares position, journey, navigation and follow state", () => {
    const view = getShipRegisterView(register({ followAvailable: true, following: true }))!;
    expect(view).toMatchObject({ journey: "Harbour 3 → Harbour 8 · Sailing · Current leg ≈ 1:15", nextDisabled: false,
      previousDisabled: true, status: "1/2 · sailing out" });
    expect(view.follow).toEqual({ disabled: false, label: "Stop following this ship", pressed: true });
    expect(view.passengers.map(cell => [cell.job, cell.count])).toEqual([["archer", "3"], ["Builder", "1"]]);
    expect(getShipRegisterView(register({ ship: undefined, shipCount: 0 }))).toBeNull();
    expect(getShipRegisterView(register({ hasPreview: true, canPreview: true, previewKind: "wares" }))!.preview)
      .toMatchObject({ open: true, buttons: [{ pressed: true }, { pressed: false }] });
  });

  it("renders the register with the classes and attributes the drivers query", () => {
    const store = createExternalStore(register({ followAvailable: true }));
    const markup = renderWithI18n(createElement(ShipRegister, { actions: noActions, store }));
    expect(markup).toContain("<h3>Ship 1</h3><p>1/2 · sailing out</p><p data-ship-journey=\"\">");
    expect(markup).toMatch(/<img alt="" class="settlement-art-icon settlement-ui__ship-portrait" draggable="false" src="[^"]+"\/>/);
    expect(markup).toContain('data-count="12" data-ware="planks"');
    expect(markup).toContain('<div aria-label="Archer: 3" data-count="3" data-job="archer" title="Archer: 3"><img');
    expect(markup).toContain('aria-label="Go to place" class="settlement-ui__button" title="Go to place" type="button"><img alt=""');
    expect(markup).toContain('class="settlement-ui__button settlement-ui__ship-follow" title="Follow this ship"');
    expect(markup).toContain(">Follow</span>");
    expect(markup).not.toContain("settlement-ui__ship-follow-camera");
    expect(markup).not.toContain("Debug deck preview");
    const empty = createExternalStore(register({ ship: undefined, shipCount: 0 }));
    expect(renderWithI18n(createElement(ShipRegister, { actions: noActions, store: empty })))
      .toBe("<p>No ships available</p>");
  });
});

describe("fleet view", () => {
  it("offers completed harbours, carriable wares and validates cargo orders", () => {
    expect(getHarbourOptions(harbours, "Harbor")).toEqual([{ label: "Harbor 3", value: "3" }, { label: "Harbor 8", value: "8" }]);
    expect(resolveChoice([{ value: "3" }], null, 1)).toBe("3");
    expect(resolveChoice([{ value: "3" }, { value: "8" }], "8", 0)).toBe("8");
    expect(getCargoWares({ fish: 0, planks: 4 })).toEqual([{ label: "planks", value: "planks" }]);
    expect(getCargoRequest("3", "8", "planks", "12")).toEqual({ destination: 8, goods: { planks: 12 }, source: 3 });
    expect(getCargoRequest("3", "3", "planks", "12")).toBeNull();
    expect(getCargoRequest("3", "8", "planks", "41")).toBeNull();
    expect(getShipRows([freighter])[0]!.detail).toBe("sailing_out · Harbour 3 → Harbour 8 · Sailing · Current leg ≈ 1:15");
  });

  it("shows cargo with two harbours, passengers with one, and the empty text otherwise", () => {
    const slice = (snapshot: SettlementUiSnapshot) => selectFleet(snapshot);
    const options = { onQueuePassengers: () => true, onQueueTransport: () => true } as never;
    expect(getFleetSections(slice({ buildings: harbours }), options))
      .toEqual({ cargo: true, empty: false, passengers: true, shores: false });
    expect(getFleetSections(slice({ buildings: harbours.slice(1) }), options))
      .toMatchObject({ cargo: false, passengers: true });
    expect(getFleetSections(slice({}), options)).toMatchObject({ empty: true });
  });

  it("renders the forms and ship rows that open the register", () => {
    const store = createSettlementUiStore();
    store.update({ buildings: harbours, resources: { planks: 4 }, seaOrders: [
      { destinationUid: 8, expedition: false, id: 4, passengers: 1, sourceUid: 3 }], ships: [freighter] });
    const markup = renderWithI18n(createElement(Fleet, {
      options: { onQueuePassengers: () => true, onQueueTransport: () => true } as never, store, visible: true,
      onFocusShip: () => {}
    }));
    expect(markup).toContain('<p class="settlement-ui__section-description">Your fleet, voyages and cargo.</p>' +
      '<form class="settlement-ui__cargo-controls"><select aria-label="Cargo source harbor">');
    expect(markup).toContain('<select aria-label="Cargo destination harbor"><option value="3">Harbor 3</option>' +
      '<option value="8" selected="">Harbor 8</option>');
    expect(markup).toContain('<input aria-label="Settler passengers" max="40" min="0" type="number" value="1"/>');
    expect(markup).toContain('aria-label="Cancel voyage 4"');
    expect(markup).toContain('<button class="settlement-ui__overview-row" data-ship-id="s1" type="button">');
    expect(markup).not.toContain("settlement-ui__empty");
  });
});

describe("ship sinking control", () => {
  it("enables only an eligible owned hull and explains that no materials return", () => {
    const ship = { id: "1", name: "Ship 1", status: "idle", owned: true, canSink: true, wares: {} };
    const state = register({ ship });
    expect(getShipRegisterView(state)!.canSink).toBe(true);
    expect(getShipRegisterView(register({ ship: { ...ship, owned: false } }))!.canSink).toBe(false);
    expect(getShipRegisterView(register({ ship: { ...ship, canSink: false } }))!.canSink).toBe(false);
    const store = createExternalStore(state);
    const markup = renderWithI18n(createElement(ShipRegister, { actions: { ...noActions, sink: () => {} }, store }));
    expect(markup).toContain('aria-label="Sink ship"');
    expect(markup).toContain(">Sink</span>");
    expect(markup).toContain("No materials are returned.");
  });
});
