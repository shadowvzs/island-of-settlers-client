import { describe, expect, it } from "vitest";

import { canAddGarrisonTroop, garrisonPlan } from "../src/app/settlement-ui/building-details/garrison-helpers";
import type { SettlementGarrisonSummary } from "../src/app/settlement-ui/types";

const counts = (shield = 0, heavy = 0, archer = 0) => ({ archer, heavy, shield });
const summary = (patch: Partial<SettlementGarrisonSummary> = {}): SettlementGarrisonSummary => ({
  assigned: counts(1, 0, 2), capacity: 3,
  coinCapacity: 6, coinIncoming: 0, coinStock: 0, coinsAllowed: true,
  drinkCapacity: 3, drinkIncoming: 0, drinkStock: 0, drinkWare: "wine",
  manual: null, posts: 2, stationed: counts(1, 0, 2),
  stationedByRank: { archer: [0, 0, 0], heavy: [0, 0, 0], shield: [0, 0, 0] },
  stored: counts(2, 0, 1), ...patch
});

describe("garrison controls", () => {
  it("edit the manual plan, or start from what is inside while automatic", () => {
    expect(garrisonPlan(summary())).toEqual(counts(1, 0, 2));
    expect(garrisonPlan(summary({ manual: counts(0, 1, 1) }))).toEqual(counts(0, 1, 1));
  });

  it("allows colony requests from free home reserves", () => {
    const colony = summary({ assigned: counts(), capacity: 3, stored: counts(), homeStored: counts(2),
      manual: counts() });
    expect(canAddGarrisonTroop(colony, "shield")).toBe(true);
    expect(canAddGarrisonTroop(colony, "archer")).toBe(false);
    expect(canAddGarrisonTroop({ ...colony, manual: counts(2) }, "shield")).toBe(false);
  });

  it("only add a soldier that fits the building and waits free in storage", () => {
    expect(canAddGarrisonTroop(summary(), "shield")).toBe(false);
    expect(canAddGarrisonTroop(summary({ manual: counts(0, 0, 2) }), "shield")).toBe(true);
    expect(canAddGarrisonTroop(summary({ manual: counts(0, 0, 2) }), "heavy")).toBe(false);
    // Two more swordsmen are already planned beyond those assigned; only one more is stored.
    expect(canAddGarrisonTroop(summary({ assigned: counts(), capacity: 6, manual: counts(2) }), "shield")).toBe(false);
  });
});
