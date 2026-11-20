import { describe, expect, it } from "vitest";

import { calibrateHunting } from "./helpers/wildlife-hunt-calibration";

describe("online and offline hunting agree (Wildlife 2.0 calibration)", () => {
  it("kills within one animal or 25 % over the same horizon", () => {
    const { offline, online } = calibrateHunting();
    expect(online).toBeGreaterThan(0);
    expect(Math.abs(online - offline)).toBeLessThanOrEqual(Math.max(1, Math.ceil(online * 0.25)));
  }, 120_000);
});
