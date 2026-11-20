import { describe, expect, it } from "vitest";

import { shouldShowMilitaryRail } from "../src/app/settlement/military-controls";

describe("military rail visibility", () => {
  it("shows the right-side soldier rail only with a soldier on the island", () => {
    expect(shouldShowMilitaryRail(0, false)).toBe(false);
    expect(shouldShowMilitaryRail(1, false)).toBe(true);
    expect(shouldShowMilitaryRail(20, false)).toBe(true);
  });

  it("keeps the rail hidden on a conquered colony even if soldiers remain", () => {
    expect(shouldShowMilitaryRail(4, true)).toBe(false);
  });
});
