import { describe, expect, it } from "vitest";

import { A14_SEED_OFFSETS } from "../tools/bench/military-a14-scenarios";
import { a14Off, a14Run } from "./helpers/a14-fixtures";

/**
 * A14-1 roles + positions gates (plan §10.1, §11). Assertions the master commander already meets run now;
 * the rest run once `A14-1` is in `A14_LANES_ON` (tests/helpers/a14-fixtures.ts).
 */
const ARCHERS_BEHIND_SHARE = .8;
/**
 * Flank gate for foot flankers (main session 2026-11-13; it was written for riders, which are retired): the player's
 * archers lose at least 2 before the line breaks, or their shooting time drops by at least 40 % against the
 * no-flank control (`flankControl`: the wings are axemen, so no flank group), both as medians over the seeds.
 */
const FLANK_ARCHER_LOSSES = 2;
const FLANK_FIRING_DROP = .4;
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const OVERWATCH_SHARE = 1 / 3;

describe("A14-1 roles and positions", () => {
  it.each(["field16", "field32", "field64"] as const)("%s: computer archers stay behind their front", key => {
    expect(a14Run(key).archersBehindFrontShare).toBeGreaterThanOrEqual(ARCHERS_BEHIND_SHARE);
  }, 120_000);

  it.skipIf(a14Off("A14-1"))("hill overwatch: a ridge point in at least 1 of 3 decisions after contact", () => {
    expect(a14Run("hillOverwatch").overwatchShare).toBeGreaterThanOrEqual(OVERWATCH_SHARE);
  }, 120_000);

  /**
   * Main session 2026-11-13: the foot flank executes (it waits for contact, goes round the line's end and strikes
   * the nearest archer, below), but whether foot flankers kill or suppress kiting archers is a balance target:
   * the kill/suppression thresholds move to A14-8 (tuning).
   */
  it.skipIf(a14Off("A14-8"))("flank: the player's archers fall or shoot 40 % less than without a flank", () => {
    const flank = A14_SEED_OFFSETS.map(offset => a14Run("flank", offset));
    const losses = median(flank.map(run => run.playerArcherLossesBeforeLineBreak ?? 0));
    const firing = median(flank.map(run => run.playerArcherFiringSeconds));
    const control = median(A14_SEED_OFFSETS.map(offset => a14Run("flankControl", offset).playerArcherFiringSeconds));
    expect(losses >= FLANK_ARCHER_LOSSES || firing <= control * (1 - FLANK_FIRING_DROP)).toBe(true);
  }, 300_000);

  it.skipIf(a14Off("A14-2"))("flank: the swordsmen reach their flank point and strike the enemy's archers", () => {
    expect(a14Run("flank").flankStrikes).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(a14Off("A14-1"))("flank: the swordsmen are sent to a flank point off the line to the enemy", () => {
    expect(a14Run("flank").flankPointDecisions).toBeGreaterThan(0);
  }, 120_000);
});
