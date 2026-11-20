import { setupI18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getShipTroopView } from "../src/app/settlement-ui/ship-register/troop-panel";
import type { ShipTroopPanelState } from "../src/app/settlement-ui/ship-register/troop-types";
import {
  armyHoverCursor, boardingRefusal, shipDestinationAt, shipRightTapMode, shipTroopPanelState, translateShipRefusal
} from "../src/app/settlement/ship-orders/helpers";
import { createShipTroopOrders } from "../src/app/settlement/ship-orders/ship-troop-orders";
import { HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { TroopShipActions } from "../src/shared/settlement/ship-troop-commands";

const actions = (patch: Partial<TroopShipActions> = {}): TroopShipActions => ({
  board: true, carrying: true, multiIsland: false, returnHome: null, role: "home", sailTo: false, unload: true,
  ...patch
});
const status = { aboard: 6, anchored: false, boarding: 2, capacityLeft: 8, harbourUid: 4, landing: 0,
  mission: true, ready: false, target: undefined };
const panel = (patch: Partial<ShipTroopPanelState> = {}): ShipTroopPanelState => ({
  aboard: 6, armed: null, board: true, boarding: 0, capacityLeft: 10, landing: 0, returnHome: null,
  sailTo: false, unload: true, ...patch
});

describe("troop ship helpers (military controls §9)", () => {
  it("turns the read-only boarding check into the board / invalid verdict", () => {
    expect(boardingRefusal({ ok: false, reason: "The ship is under way" })).toBe("The ship is under way");
    expect(boardingRefusal({ boarding: [1], ok: true, pickup: false, waiting: [2] })).toBeUndefined();
    expect(boardingRefusal({ boarding: [], ok: true, pickup: false, waiting: [2] })).toBe("The ship is full");
    expect(boardingRefusal({ boarding: [], ok: true, pickup: false, waiting: [] })).toBe("No chosen soldier can board");
  });

  it("gives the selected ship's right tap: Sail to on multi-island maps, else land; none when empty", () => {
    expect(shipRightTapMode(actions({ multiIsland: true, sailTo: true }))).toBe("sail");
    expect(shipRightTapMode(actions())).toBe("unload");
    expect(shipRightTapMode(actions({ carrying: false, unload: false }))).toBeNull();
    expect(shipRightTapMode(null)).toBeNull();
  });

  it("lets a soldier selection own the cursor; without one the ship's generic mode shows", () => {
    expect(armyHoverCursor(2, "attack", "sail")).toBe("attack");
    expect(armyHoverCursor(2, null, "sail")).toBeNull();
    expect(armyHoverCursor(0, null, "unload")).toBe("unload");
    expect(armyHoverCursor(0, null, null)).toBeNull();
  });

  it("aims at a clicked own harbour's pier, else at the ground point", () => {
    expect(shipDestinationAt({ typeId: HARBOUR_TYPE_ID, uid: 9 }, { x: 1, z: 2 })).toEqual({ harbourUid: 9 });
    expect(shipDestinationAt({ typeId: 0, uid: 3 }, { x: 1, z: 2 })).toEqual({ x: 1, z: 2 });
    expect(shipDestinationAt(undefined, null)).toBeNull();
  });

  it("translates the simulation's English refusal at the UI boundary; unknown text passes through", () => {
    const i18n = setupI18n({ locale: "xx", messages: { xx: { "domain.refusal.troopShip.noBeach": "Kein Strand" } } });
    expect(translateShipRefusal("No landing beach here", i18n)).toBe("Kein Strand");
    expect(translateShipRefusal("No landing beach here")).toBe("No landing beach here");
    expect(translateShipRefusal("Something new", i18n)).toBe("Something new");
  });

  it("offers the campaign's Return home only once the run's map is decided", () => {
    const campaign = actions({ returnHome: "campaignRun", role: "campaign" });
    expect(shipTroopPanelState(campaign, status, { armed: null, campaignReturn: false }).returnHome).toBeNull();
    expect(shipTroopPanelState(campaign, status, { armed: "sail", campaignReturn: true }))
      .toMatchObject({ aboard: 6, armed: "sail", boarding: 2, capacityLeft: 8, returnHome: "campaignRun" });
    const colony = actions({ returnHome: "colonyRecall", role: "colony" });
    expect(shipTroopPanelState(colony, status, { armed: null, campaignReturn: false }).returnHome)
      .toBe("colonyRecall");
  });
});

describe("ship troop panel per map context (§9.3 table)", () => {
  const buttons = (state: ShipTroopPanelState) => getShipTroopView(state)?.buttons.map(button => button.action);

  it.each<[string, Partial<ShipTroopPanelState>, string[]]>([
    ["colony island", { returnHome: "colonyRecall" }, ["unload", "returnHome"]],
    ["home, single-island map", {}, ["unload"]],
    ["multi-island map", { sailTo: true }, ["unload", "sail"]],
    ["campaign map, run decided, several islands", { returnHome: "campaignRun", sailTo: true },
      ["unload", "sail", "returnHome"]]
  ])("%s", (_name, patch, expected) => {
    expect(buttons(panel(patch))).toEqual(expected);
  });

  it("shows aboard, free deck slots, boarding and landing; an empty ship only hints at boarding", () => {
    const view = getShipTroopView(panel({ boarding: 3, landing: 2 }))!;
    expect(view.lines).toEqual(["6 soldiers aboard · 10 free deck slots", "3 soldiers boarding", "2 soldiers landing"]);
    expect(view.hint).toBeUndefined();
    const empty = getShipTroopView(panel({ aboard: 0, capacityLeft: 16, unload: false }))!;
    expect(empty.buttons).toEqual([]);
    expect(empty.hint).toBe("Select soldiers and right-click this ship to board.");
    expect(getShipTroopView(panel({ aboard: 0, board: false, unload: false }))).toBeNull();
    expect(getShipTroopView(panel({ armed: "unload" }))!.buttons[0]!.pressed).toBe(true);
  });
});

type OrderResult = { kind: "coast" | "harbour"; ok: true } | { ok: false; reason: string };

const fakeShipSimulation = (shipActions: TroopShipActions | null, check: OrderResult) => ({
  landShipTroops: vi.fn((): OrderResult => check),
  sailShip: vi.fn((): OrderResult => check),
  troopShipActions: vi.fn(() => shipActions),
  troopShipDestinationCheck: vi.fn((): OrderResult => check)
});

const createOrders = (simulation: ReturnType<typeof fakeShipSimulation>, harbour?: { typeId: number; uid: number }) => {
  const message = vi.fn(), marker = { show: vi.fn() }, onChange = vi.fn();
  const orders = createShipTroopOrders({
    marker, message, onChange, pick: () => ({ x: 70, z: 20 }),
    pickTargetBuilding: () => harbour as never, simulation: simulation as unknown as SettlementSimulation
  });
  return { marker, message, onChange, orders };
};

describe("selected ship orders and target modes (P4b)", () => {
  beforeEach(() => { vi.stubGlobal("window", new EventTarget()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("takes no right tap without a selected ship that carries soldiers", () => {
    const simulation = fakeShipSimulation(actions({ carrying: false, unload: false }), { kind: "coast", ok: true });
    const { orders } = createOrders(simulation);
    expect(orders.order(5, 5)).toBe(false);
    orders.select("12");
    expect(orders.cursorMode()).toBeNull();
    expect(orders.order(5, 5)).toBe(false);
    expect(simulation.troopShipDestinationCheck).not.toHaveBeenCalled();
  });

  it("sails on a right tap after the destination check (multi-island), docking at a clicked harbour", () => {
    const simulation = fakeShipSimulation(actions({ multiIsland: true, sailTo: true }), { kind: "harbour", ok: true });
    const { message, orders } = createOrders(simulation, { typeId: HARBOUR_TYPE_ID, uid: 31 });
    orders.select("12");
    expect(orders.cursorMode()).toBe("sail");
    expect(orders.order(5, 5)).toBe(true);
    expect(simulation.troopShipDestinationCheck).toHaveBeenCalledWith(12, { harbourUid: 31 });
    expect(simulation.sailShip).toHaveBeenCalledWith(12, { harbourUid: 31 });
    expect(message).toHaveBeenLastCalledWith("The ship sails to the harbour and docks with the troops aboard.");
  });

  it("lands on a right tap where the map has no other island", () => {
    const simulation = fakeShipSimulation(actions(), { kind: "coast", ok: true });
    const { orders } = createOrders(simulation);
    orders.select("12");
    expect(orders.cursorMode()).toBe("unload");
    orders.order(5, 5);
    expect(simulation.landShipTroops).toHaveBeenCalledWith(12, { x: 70, z: 20 });
  });

  it("shows the check's reason (never recording the order) and keeps the armed mode for another try", () => {
    const simulation = fakeShipSimulation(actions(), { ok: false, reason: "No landing beach here" });
    const { marker, message, orders } = createOrders(simulation);
    orders.select("12");
    orders.arm("12", "unload");
    expect(message).toHaveBeenLastCalledWith("Unload troops: choose a coast to land on. Right click or Escape cancels.");
    expect(orders.click(5, 5)).toBe(true);
    expect(message).toHaveBeenLastCalledWith("No landing beach here", true);
    expect(marker.show).toHaveBeenLastCalledWith({ x: 5, y: 5 }, "refused");
    expect(simulation.landShipTroops).not.toHaveBeenCalled();
    expect(orders.armed()).toBe("unload");
  });

  it("ends the armed mode on an accepted click, on Escape, and when the window shows another ship", () => {
    const simulation = fakeShipSimulation(actions({ sailTo: true }), { kind: "coast", ok: true });
    const { orders } = createOrders(simulation);
    orders.arm("12", "unload");
    expect(orders.click(5, 5)).toBe(true);
    expect(simulation.landShipTroops).toHaveBeenCalledWith(12, { x: 70, z: 20 });
    expect(orders.armed()).toBeNull();
    expect(orders.click(5, 5)).toBe(false);
    orders.arm("12", "sail");
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    window.dispatchEvent(escape);
    expect(orders.armed()).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    orders.arm("12", "sail");
    orders.select("13");
    expect(orders.armed()).toBeNull();
    orders.arm("13", "unload");
    orders.select(null);
    expect(orders.armed()).toBeNull();
    expect(orders.cursorMode()).toBeNull();
  });

  it("drops an armed mode the ship no longer offers on the 0.5 s refresh", () => {
    const simulation = fakeShipSimulation(actions(), { kind: "coast", ok: true });
    const { onChange, orders } = createOrders(simulation);
    orders.arm("12", "unload");
    onChange.mockClear();
    simulation.troopShipActions.mockReturnValue(actions({ carrying: false, unload: false }));
    orders.refresh();
    expect(orders.armed()).toBeNull();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
