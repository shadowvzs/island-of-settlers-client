import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { troopPortrait } from "../src/app/settlement/army-icons";
import { troopName, troopPluralName } from "../src/app/settlement/troop-names";
import {
  EMPTY_SHIP_REGISTER, getShipRegisterView, PASSENGER_ICON_CLASS, type ShipRegisterState
} from "../src/app/settlement-ui/ship-register/helpers";
import { ShipRegister } from "../src/app/settlement-ui/ship-register/ship-register";
import type { SettlementShipSummary } from "../src/app/settlement-ui/types";
import { renderWithI18n } from "./helpers/render-with-i18n";

const troopShip: SettlementShipSummary = {
  id: "s1", name: "Ship 1", status: "idle",
  passengers: { Settler: 2, Soldier: 6 }, troops: { archer: 1, heavy: 2, shield: 3 }
};
const register = (nation: string): ShipRegisterState =>
  ({ ...EMPTY_SHIP_REGISTER, nation, ship: troopShip, shipCount: 1 });
const noActions = {
  locate: () => {}, step: () => {}, toggleFollow: () => {}, togglePreview: () => {}, troops: () => {}
};

describe("ship register passenger icons", () => {
  it("gives the settler and every troop icon the same size class", () => {
    const view = getShipRegisterView(register("roman"))!;
    expect(view.passengers.map(cell => cell.job)).toEqual(["shield", "heavy", "archer", "Settler"]);
    expect(view.passengers.every(cell => cell.iconClassName === PASSENGER_ICON_CLASS)).toBe(true);
    const store = createExternalStore(register("roman"));
    const markup = renderWithI18n(createElement(ShipRegister, { actions: noActions, store }));
    expect(markup.split(`class="${PASSENGER_ICON_CLASS}"`)).toHaveLength(4);
    expect(markup).toContain(`class="settlement-art-icon ${PASSENGER_ICON_CLASS}"`);
  });

  it("names and pictures the troops from the nation's own roster", () => {
    const labels = (nation: string) => getShipRegisterView(register(nation))!.passengers.map(cell => cell.label);
    expect(labels("roman")).toEqual(["Swordsman", "Longswordsman", "Archer", "Settler"]);
    expect(labels("viking")).toEqual(["Shield warrior", "Dane axeman", "Archer", "Settler"]);
    expect(labels("nubian")).toEqual(["Khopesh warrior", "Spearman", "Archer", "Settler"]);
    expect(labels("japanese")).toEqual(["Swordsman", "Longswordsman", "Archer", "Settler"]);
    expect(getShipRegisterView(register("viking"))!.passengers[1]!.icon).toBe(troopPortrait("viking", "heavy"));
  });

  it("never calls a Roman an axeman and falls back to the Roman roster", () => {
    for (const nation of ["roman", "japanese", "nubian"]) expect(troopName(nation, "heavy")).not.toMatch(/axe/i);
    expect(troopPluralName("roman", "heavy")).toBe("Longswordsmen");
    expect(troopPluralName("viking", "heavy")).toBe("Dane axemen");
    expect(troopName("unknown", "shield")).toBe("Swordsman");
  });
});
