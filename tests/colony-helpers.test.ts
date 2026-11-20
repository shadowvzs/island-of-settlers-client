import { describe, expect, it } from "vitest";

import {
  clampColonyTroop, colonyRecordLabel, colonyStatusLabel, fitColonyTroops, formatColonyDuration, readColoniesCollapsed,
  storeColoniesCollapsed
} from "../src/app/settlement-ui/colony-helpers";
import type { ColonyExpeditionSnapshot } from "../src/shared/settlement/settlement-colony-expeditions";

const none = { archer: 0, cavalry: 0, heavy: 0, shield: 0 };
const expedition = (patch: Partial<ColonyExpeditionSnapshot>): ColonyExpeditionSnapshot => ({
  arrived: 0, cargo: {}, crewReady: true, departed: 0, id: 1, landed: {}, loads: 2,
  island: { difficulty: "easy", id: 0, name: "Gull Rock", ore: "coal", seed: 1, voyageSeconds: 120 },
  remainingSeconds: null, sourceUid: 1, status: "preparing", suppliesReady: true, troops: none, ...patch
});

describe("colony UI helpers", () => {
  it("formats countdowns as minutes and seconds", () => {
    expect(formatColonyDuration(905.2)).toBe("15:06");
    expect(formatColonyDuration(0)).toBe("0:00");
    expect(formatColonyDuration(null)).toBe("--:--");
    expect(formatColonyDuration(Infinity)).toBe("--:--");
    expect(formatColonyDuration(NaN)).toBe("--:--");
    expect(formatColonyDuration(-1)).toBe("0:00");
  });

  it.each([
    [3599, "59:59"], [3599.1, "1 h 0 min"], [3600, "1 h 0 min"],
    [18720, "5 h 12 min"], [86399, "23 h 59 min"], [86400, "1 d 0 h"],
    [1209599, "13 d 23 h"], [1209600, "14 d 0 h"]
  ])("scales %s seconds to %s", (seconds, expected) => {
    expect(formatColonyDuration(seconds)).toBe(expected);
  });

  it.each([false, true])("uses days and hours in conquered colony rows (debug: %s)", debug => {
    const colony = { conqueredAt: 0, id: 1, island: { ...(debug ? { debug: true as const } : {}), difficulty: "easy" as const,
      id: 0, name: "Gull Rock", ore: "coal" as const, seed: 1, voyageSeconds: 120 },
      status: "conquered" as const };
    expect(colonyRecordLabel(colony, 1000)).toBe(
      `Conquered · free again in 13 d 23 h${debug ? " (test)" : ""}`
    );
  });

  it("clamps one troop type to stock and the remaining difficulty capacity", () => {
    const troops = { ...none, shield: 15 };
    expect(clampColonyTroop(troops, "archer", 10, "easy", { archer: 40 })).toBe(5);
    expect(clampColonyTroop(troops, "archer", 10, "easy", { archer: 3 })).toBe(3);
    expect(clampColonyTroop(troops, "archer", -2, "easy", { archer: 3 })).toBe(0);
    expect(clampColonyTroop(troops, "shield", 30, "medium", { shield: 40 })).toBe(30);
  });

  it("trims ordinary archers first when a lower difficulty lowers the cap", () => {
    expect(fitColonyTroops({ archer: 10, cavalry: 0, heavy: 5, shield: 10 }, "easy"))
      .toEqual({ archer: 5, cavalry: 0, heavy: 5, shield: 10 });
  });

  it("describes each expedition stage", () => {
    expect(colonyStatusLabel(expedition({ suppliesReady: false }))).toMatch(/supplies/);
    expect(colonyStatusLabel(expedition({ crewReady: false }))).toMatch(/walking/);
    expect(colonyStatusLabel(expedition({ departed: 1, status: "sailing" }))).toMatch(/1\/2/);
    expect(colonyStatusLabel(expedition({ departed: 2, status: "sailing" }))).toMatch(/Ship sailing to the target colony/);
    expect(colonyStatusLabel(expedition({ status: "arrived" }))).toMatch(/Colony is ready to visit/);
    expect(colonyStatusLabel(expedition({ status: "arrived", returningShips: 1 })))
      .toContain("Ship returning from the colony");
  });

  it("remembers the minimised Colonies panel per session and survives refused storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    expect(readColoniesCollapsed(storage)).toBe(false);
    storeColoniesCollapsed(true, storage);
    expect(readColoniesCollapsed(storage)).toBe(true);
    storeColoniesCollapsed(false, storage);
    expect(readColoniesCollapsed(storage)).toBe(false);
    const refused = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    };
    expect(() => storeColoniesCollapsed(true, refused)).not.toThrow();
    expect(readColoniesCollapsed(refused)).toBe(false);
  });
});
