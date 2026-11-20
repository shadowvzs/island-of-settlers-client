import { describe, expect, it } from "vitest";

import { SHIP_SCENARIOS } from "./helpers/ship-motion-scenarios";
import { describeStressLayouts, worstExcess } from "./helpers/ship-speed-limit";

// Owner 2026-10-15: no ship jumps from standing still to full speed (or stops dead) in one tick.
// Stress layouts 0–7 are in ship-speed-limit-stress-*.slow.test.ts.
describe("ship speed changes stay within the acceleration limit", () => {
  it.each(SHIP_SCENARIOS.filter(([name]) => !name.startsWith("raiders")))("%s", (_, scenario) => {
    expect(worstExcess(scenario())).toBeLessThanOrEqual(1e-9);
  }, 120000);
});

describeStressLayouts(8, 16);
