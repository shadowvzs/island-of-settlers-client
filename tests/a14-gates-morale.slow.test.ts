import { describe, expect, it } from "vitest";

import { MELEE_PLACES } from "../src/shared/settlement/military-engagement";
import { a14Baseline, a14Off, a14Run } from "./helpers/a14-fixtures";

/**
 * A14-2 focus + morale gates (plan §10.1, §11). Ordinary cavalry is retired (HORSE-RETIREMENT-01): the archers
 * face a charge on foot (axemen in front, swordsmen behind). Lane assertions run once `A14-2` is in `A14_LANES_ON`.
 */
const SHIELDS_BETWEEN_SHARE = .8;
/** The danger matrix makes most computer archers open on the unshielded axemen of the charge. */
const AXEMEN_FIRST_SHARE = .5;

describe("A14-2 focus and morale", () => {
  it("archers vs charge: the computer archers' first targets are the charging foot", () => {
    const { archerFirstTargets } = a14Run("archersVsCharge");
    const total = Object.values(archerFirstTargets).reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(0);
    expect((archerFirstTargets.heavy ?? 0) + (archerFirstTargets.shield ?? 0)).toBe(total);
  }, 120_000);

  it("archers vs charge: the shields stand between the charge and the archers", () => {
    expect(a14Run("archersVsCharge").archersBehindFrontShare).toBeGreaterThanOrEqual(SHIELDS_BETWEEN_SHARE);
  }, 120_000);

  it.skipIf(a14Off("A14-2"))("archers vs charge: the danger matrix sends most first arrows at the axemen", () => {
    const { archerFirstTargets } = a14Run("archersVsCharge");
    const total = Object.values(archerFirstTargets).reduce((sum, count) => sum + count, 0);
    expect((archerFirstTargets.heavy ?? 0) / total).toBeGreaterThan(AXEMEN_FIRST_SHARE);
  }, 120_000);

  it.skipIf(a14Off("A14-2"))("outnumbered: the computer side reaches wavering or broken (rout recorded)", () => {
    const metrics = a14Run("outnumberedRout");
    expect(metrics.pendingHooks).not.toContain("A14-2:morale");
    expect(metrics.routCount).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(a14Off("A14-2"))("aura rally: soldiers in the hero's aura rally, faster than master's baseline", () => {
    const metrics = a14Run("auraRally"), master = a14Baseline("auraRally");
    expect(metrics.pendingHooks).not.toContain("A14-2:moraleAura");
    expect(metrics.timeToRallySeconds).not.toBeNull();
    if (master.timeToRallySeconds !== null)
      expect(metrics.timeToRallySeconds!).toBeLessThan(master.timeToRallySeconds);
  }, 120_000);

  it.skipIf(a14Off("A14-2"))("aura rally: soldiers inside the aura break later than soldiers outside it", () => {
    // Morale log: median seconds to each soldier's first loss of steadiness (a steady one counts the whole run).
    const { breakSecondsInsideAura, breakSecondsOutsideAura } = a14Run("auraRally");
    expect(breakSecondsInsideAura).not.toBeNull();
    expect(breakSecondsOutsideAura).not.toBeNull();
    expect(breakSecondsInsideAura!).toBeGreaterThan(breakSecondsOutsideAura!);
  }, 120_000);

  // The score rule itself is unit tested (tests/military-morale-focus.test.ts); here the fights it produces.
  it.skipIf(a14Off("A14-2")).each(["archersVsCharge", "field64"] as const)(
    "%s: focus fire keeps the melee claim cap (no target swarmed)", key => {
      expect(a14Run(key).attackersMax).toBeLessThanOrEqual(MELEE_PLACES + 1);
    }, 120_000);
});
