import { describe, expect, it } from "vitest";

import { shouldUseOfflineEconomy } from "../src/app/settlement/offline-replay-policy";
import { OFFLINE_FAST_AFTER_SECONDS } from "../src/shared/balance/offline";

describe("offline fast-only startup policy", () => {
  it.each([0, -1, NaN, Infinity])("does not start catch-up for %s seconds", seconds => {
    expect(shouldUseOfflineEconomy(seconds)).toBe(false);
  });
  it.each([.001, .05, 1, 60, 1799.999, 1800, 3600, 86400, 172800])("selects fast economy at %s seconds", seconds => {
    expect(shouldUseOfflineEconomy(seconds)).toBe(true);
  });
  it("has no short-gap native duration branch", () => {
    expect(OFFLINE_FAST_AFTER_SECONDS).toBe(0);
  });
  it("keeps explicit reference and experimental lanes instead of switching them by duration", () => {
    for (const options of [{ exact: true }, { economy: false }, { measured: true }, { analytic: true },
      { eventCore: true }, { eventCore: "auto" as const }, { eventMovement: true },
      { corridorReservations: true }, { quietSkip: true }, { movementSkip: true }, { chronological: true }])
      expect(shouldUseOfflineEconomy(86400, options)).toBe(false);
  });
  it("retains forced short economy probes and explicit exact precedence", () => {
    expect(shouldUseOfflineEconomy(60, { economy: true })).toBe(true);
    expect(shouldUseOfflineEconomy(86400, { economy: true, exact: true })).toBe(false);
    expect(shouldUseOfflineEconomy(86400, { economy: true, eventCore: true })).toBe(false);
    expect(shouldUseOfflineEconomy(86400, { economyCalibrationSeconds: 120 })).toBe(true);
  });
});
