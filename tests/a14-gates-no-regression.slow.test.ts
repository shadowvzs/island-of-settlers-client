import { describe, expect, it } from "vitest";

import { stateHashOf } from "../tools/bench/military-a14-metrics";
import { A14_FIXTURES } from "../tools/bench/military-a14-scenarios";
import {
  A14_ALL_FIXTURES, A14_BASELINED_FIXTURES, a14Baseline, a14BaselineMedians, a14BehaviourChanged, a14Medians,
  a14Run, CHURN_MARGIN, STUCK_FLOOR_SECONDS, STUCK_MARGIN
} from "./helpers/a14-fixtures";

/**
 * A14 gates common to every lane (plan §10.2, §11): no illegal reads, no stuck or churn regression against the
 * master baseline (`A14_BASELINE_FILE`; stuck and churn as medians over the seed offsets), measuring never changes
 * the simulation. Churn counts commander orders only (morale fall-backs and routs are `moraleOrdersPerMinute`).
 */
/**
 * The flank fixture's swordsmen walk round the end of the enemy line on purpose (A14-2), which master's flank
 * never did: main session 2026-11-13 accepts an absolute 2 s median there instead of master + 5 %.
 */
const FLANK_STUCK_LIMIT_SECONDS = 2;

describe("A14 no-regression gates (every lane)", () => {
  it("measuring a fixture leaves its state hash unchanged", () => {
    const plain = A14_FIXTURES.field16();
    plain.start();
    for (let tick = 0; tick < plain.seconds * 20; tick++) plain.simulation.update(.05);
    expect(a14Run("field16").stateHash).toBe(stateHashOf(plain.simulation));
  }, 120_000);

  it.each(A14_ALL_FIXTURES)("%s: the AI reads no enemy its faction does not know (probe 0 unseen)", key => {
    expect(a14Run(key).probeUnseenSites).toEqual([]);
    expect(a14Run(key).probeUnseenReads).toBe(0);
  }, 120_000);

  it.each(A14_BASELINED_FIXTURES)("%s: median stuck seconds at most master + 5 %%", key => {
    const master = a14BaselineMedians(key).stuckSeconds;
    const allowed = key === "flank" ? FLANK_STUCK_LIMIT_SECONDS
      : Math.max(master * STUCK_MARGIN, master + STUCK_FLOOR_SECONDS);
    expect(a14Medians(key).stuckSeconds).toBeLessThanOrEqual(allowed);
  }, 300_000);

  it.each(A14_BASELINED_FIXTURES)("%s: median commander orders per minute per squad at most master × 1.5", key => {
    const master = a14BaselineMedians(key).ordersPerMinutePerSquad;
    // Fixtures without commander orders on master (setup only) are gated by their own lane.
    if (!master) return;
    expect(a14Medians(key).ordersPerMinutePerSquad ?? 0).toBeLessThanOrEqual(master * CHURN_MARGIN);
  }, 300_000);

  /**
   * A14-0 must stay hash-identical to master. Once a lane that changes behaviour on purpose (A14-1 on) is
   * switched on, this stops; the master baseline stays the reference for the metric gates above.
   */
  it.skipIf(a14BehaviourChanged()).each(A14_BASELINED_FIXTURES)("A14-0: %s ends on the master state hash", key => {
    expect(a14Run(key).stateHash).toBe(a14Baseline(key).stateHash);
  }, 120_000);
});
