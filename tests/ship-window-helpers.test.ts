import { describe, expect, it } from "vitest";

import { shipPassengerRows } from "../src/app/settlement-ui/ship-window-helpers";

describe("ship register passengers", () => {
  it("lists soldiers per troop type and keeps civilians under their job", () => {
    const rows = shipPassengerRows({
      id: "3", name: "Ship 3", status: "loading",
      passengers: { Builder: 2, Settler: 1, Soldier: 5 },
      troops: { archer: 2, cavalry: 1, shield: 2 }
    }, "roman");
    expect(rows).toEqual([
      { count: 2, label: "Swordsman", troop: "shield" },
      { count: 2, label: "Archer", troop: "archer" },
      { count: 1, label: "Cavalryman", troop: "cavalry" },
      { count: 2, label: "Builder" },
      { count: 1, label: "Settler" }
    ]);
  });

  it("keeps soldiers without a known troop type under their job", () => {
    const rows = shipPassengerRows({
      id: "1", name: "Ship 1", status: "sailing",
      passengers: { Soldier: 3 }, troops: { heavy: 2 }
    }, "roman");
    expect(rows).toEqual([
      { count: 2, label: "Longswordsman", troop: "heavy" }, { count: 1, label: "Soldier" }
    ]);
  });

  it("returns no rows for an empty ship", () => {
    expect(shipPassengerRows({ id: "2", name: "Ship 2", status: "idle" }, "roman")).toEqual([]);
  });
});
