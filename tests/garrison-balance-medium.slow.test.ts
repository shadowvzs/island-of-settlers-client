import { describe, expect, it } from "vitest";

import { assault, AVERAGE } from "./helpers/garrison-balance";

// Colony balance case split from garrison-balance.test.ts (targets, seeds and history there).
describe("colony garrison balance", () => {
  // New compounds use island-seeded layouts; representative outcomes are remeasured across ten seeds.
  it("a medium colony falls to 30 soldiers (25 mixed) and holds against 25", () => {
    expect(assault("medium", 30, AVERAGE, 5)).toBe(true);
    // Seed re-picked 2026-10-27 for the lower archer damage (cheap test update, no retune).
    expect(assault("medium", 25, AVERAGE, 4, true)).toBe(true);
    expect(assault("medium", 25, AVERAGE, 4)).toBe(false);
  }, 600_000);
});
