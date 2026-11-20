import { describe, expect, it } from "vitest";

import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import {
  effectiveProductionSeconds, productionMaterialTier
} from "../src/shared/settlement/production-timing";
import { productionCycleRate } from "../src/shared/settlement/workshop-upgrades";

describe("production timing (BAL-01)", () => {
  it("halves every production time", () => {
    expect(effectiveProductionSeconds(PRODUCTION_RULES[32]!.seconds, 32)).toBe(7.5);
    expect(productionCycleRate({ typeId: 32 })).toBe(2);
    expect(productionCycleRate({ typeId: 0 })).toBe(1);
  });
  it("makes each building-material tier 20% slower than its base building", () => {
    expect(productionMaterialTier(33, "planks")).toBe(0);
    expect(productionMaterialTier(33, "cedarPlanks")).toBe(2);
    expect(productionMaterialTier(10, "granite")).toBe(4);
    expect(productionMaterialTier(41)).toBe(1);
    expect(productionMaterialTier(32, "bread")).toBe(0);
    const sawmill = PRODUCTION_RULES[33]!.seconds;
    expect(effectiveProductionSeconds(sawmill, 33, "hardwoodPlanks")).toBeCloseTo(sawmill * 1.2 / 2);
    expect(effectiveProductionSeconds(sawmill, 33, "mahoganyPlanks")).toBeCloseTo(sawmill * 1.8 / 2);
    expect(PRODUCTION_RULES[50]!.seconds).toBe(PRODUCTION_RULES[17]!.seconds);
    expect(productionCycleRate({ typeId: 50 })).toBeCloseTo(2 / 1.6);
  });
});
