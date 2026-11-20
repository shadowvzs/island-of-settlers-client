import { describe, expect, it } from "vitest";

import { TROOPS } from "../src/app/map-editor/scenario-form-controls";
import { getTroopRows } from "../src/app/settlement-ui/expedition-planner/helpers";
import { adventureEnemyPlan } from "../src/shared/settlement/adventure-rules";
import {
  COLONY_TROOP_TYPES, colonyTroopReason
} from "../src/shared/settlement/colony-expedition-rules";
import { randomDebugEnemy } from "../src/shared/settlement/settlement-debug-enemy";
import { DEBUG_EXPEDITION_TROOPS } from "../src/shared/settlement/settlement-debug-expeditions";
import { isTavernTroop,TAVERN_TROOPS } from "../src/shared/settlement/tavern-rules";

describe("horse-retirement gameplay catalogues and UI", () => {
  it("offers only ordinary troops in the Tavern and expedition planner", () => {
    expect(TAVERN_TROOPS).toEqual(["shield", "heavy", "archer"]);
    expect(isTavernTroop("cavalry")).toBe(false);
    expect(COLONY_TROOP_TYPES).toEqual(["shield", "heavy", "archer"]);
    expect(TROOPS.map(option => option.value)).toEqual(["shield", "heavy", "archer"]);
    const rows = getTroopRows(
      { archer: 0, cavalry: 0, heavy: 0, shield: 0 },
      { archer: 1, cavalry: 5, heavy: 1, shield: 2 }, "roman"
    );
    expect(rows.map(row => row.type)).toEqual(["shield", "heavy", "archer"]);
    expect(rows.find(row => row.type === "shield")?.max).toBe(2);
  });

  it("rejects a legacy cavalry draft instead of loading it into an expedition deck", () => {
    expect(colonyTroopReason({ cavalry: 1, shield: 7 }, "easy", { cavalry: 1, shield: 20 }))
      .toBe("Ordinary cavalry is retired");
    expect(DEBUG_EXPEDITION_TROOPS.cavalry).toBe(0);
  });

  it("keeps ordinary enemy mixes free of ordinary cavalry", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const)
      expect(new Set(adventureEnemyPlan(difficulty).camps.flatMap(camp => camp.troops)))
        .not.toContain("cavalry");
    for (let seed = 1; seed <= 60; seed++) {
      let state = seed;
      const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
      expect(randomDebugEnemy(random).type).not.toBe("cavalry");
    }
  });
});
