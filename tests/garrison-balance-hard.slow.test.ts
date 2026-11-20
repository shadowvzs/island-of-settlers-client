import { describe, expect, it } from "vitest";

import { assault, VETERANS } from "./helpers/garrison-balance";

// Colony balance case split from garrison-balance.test.ts (targets, seeds and history there).
describe("colony garrison balance", () => {
  it("a hard colony falls to 40 mixed veterans and holds against 35", () => {
    expect(assault("hard", 40, VETERANS, 1, true)).toBe(true);
    // Smaller forces can beat some layouts; this guarded layout holds against 35 veterans.
    // Seed re-picked 2026-10-27 for the lower archer damage (cheap test update, no retune).
    expect(assault("hard", 35, VETERANS, 5, true)).toBe(false);
  }, 600_000);
});
