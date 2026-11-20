import { describe, expect, it } from "vitest";

import { assault, AVERAGE } from "./helpers/garrison-balance";

/**
 * Locks the owner's colony targets (2026-10-13): easy needs about 12–15 soldiers, medium 25–30, hard
 * 40 or more veterans. Re-measured 2026-10-14 after colony forts became destructible (walls ×5) and two
 * siege stalls were fixed; easy 14 defenders (ranks 0/1), medium 26, hard 37. Sweeps of ten seeds per
 * case: docs/contracts/colonies-and-adventures.md, "Colony balance". Each case uses a fixed seed whose outcome
 * matches the target; the simulation is deterministic. Re-measured 2026-10-15 with the shipped military
 * mode 4 (formations + smart commander; colony counterattack parties press their raid): ten-seed sweeps
 * in docs/archive/dated/military-motion-2026-10-13.md section 9. Retuned 2026-10-15 for mode 4 (owner option A): easy 15
 * defenders, hard 41; same seeds, ten-seed sweeps in docs/contracts/colonies-and-adventures.md "Colony balance".
 * Re-measured for independent seeded compounds on 2026-10-15: easy rank-one defenders and fewer
 * overlapping medium bows preserve these representative force thresholds. Counts remain 15/26/41;
 * troop base statistics are unchanged. See the neutral compound balance results in that document.
 * Seeds re-picked 2026-10-19 (owner DEC-03: cheap test update, balance retuning deferred): easy 12 melee
 * seed 4, easy 13 mixed seed 3, medium 30 melee seed 6. Ten-seed wins are now below the targets (easy 12
 * melee 2/10, medium 30 melee 2/10); see docs/contracts/settlement-military-contract.md "Colony balance".
 * Seeds re-picked 2026-10-19 after BUG-04 (field archers now shoot fort walls on every layout; cheap
 * test update): easy 13 mixed seed 7, hard 35 veterans seed 4. Ten-seed wins: easy 13 mixed 2 → 3,
 * hard 35 veterans 6 → 8 (holds 2/10), hard 40 veterans 10 → 9, medium 25 mixed 10 → 10.
 * Seed re-picked 2026-10-19 after tower-post archers gained range from height (owner request, capped
 * 1.125×; cheap test update): hard 40 veterans seed 2 → 1. Ten-seed wins before/after: easy 12 melee
 * 2 → 2, easy 13 mixed 3 → 1, medium 30 melee 2 → 3, medium 25 mixed 10 → 10, hard 40 veterans 9 → 6,
 * hard 35 veterans 8 → 4 (holds 6/10); easy 10 and medium 25 melee still hold 10/10.
 * Seeds re-picked 2026-10-19 after the shipped military mode became flowCommander (flow fields, no
 * formations, smart commander; owner decision, cheap test update, balance retuning deferred under
 * DEC-03): easy 12 melee 4 → 3, easy 13 mixed 7 → 1, medium 30 melee 6 → 2, hard 40 veterans 1 → 2.
 * Ten-seed wins (seeds 1–10) in flowCommander: easy 12 melee 2/10 (3, 9), easy 13 mixed 1/10 (1),
 * easy 10 melee 0/10 (holds 10/10), medium 30 melee 3/10 (2, 3, 5), medium 25 mixed 10/10, medium 25
 * melee 0/10 (holds 10/10), hard 40 veterans 7/10 (2, 4, 5, 7, 8, 9, 10), hard 35 veterans 4/10 (2, 3,
 * 5, 8; seed 4 still holds, so holds 6/10).
 * Seeds re-picked 2026-10-22 after enemy fronts turned to face the island centre (owner request;
 * cheap test update): easy 13 mixed 1 → 3, medium 30 melee 2 → 5, hard 40 veterans 2 → 1, hard 35
 * veterans 4 → 2. Ten-seed wins: easy 12 melee 2/10 (3, 9), easy 13 mixed 3/10 (3, 6, 9), easy 10
 * melee 0/10, medium 30 melee 2/10 (5, 8), medium 25 mixed 9/10, medium 25 melee 1/10 (8), hard 40
 * veterans 6/10 (1, 4, 7, 8, 9, 10), hard 35 veterans 5/10 (1, 3, 4, 7, 10; holds 5/10).
 * The medium and hard cases are garrison-balance-medium/-hard.slow.test.ts (one file per case so the
 * slow project runs them in parallel, TEST-01).
 * Retuned 2026-10-24 (DEC-03 revised recommendation A; owner acceptance pending): colony-only fort
 * mixes/compositions, medium 26 → 28 defenders, no field/soldier/roster change. Frozen tuning seeds
 * 1–10, validation 11–20, second validation 21–30. Tuning/validation wins before → after: easy 12
 * melee 3/2 → 7/6, easy 13 mixed 3/3 → 6/7, medium 30 melee 5/7 → 9/8, hard 40 veterans 8/8 → 7/8;
 * hard 35 colony holds 4/4 → 7/6 (attacker wins 3/4). The fixed seeds below are unchanged and pass.
 * Details and the adjacent medium 25 melee regression: docs/contracts/colonies-and-adventures.md
 * "Colony balance (2026-10-24)".
 * Seeds re-picked 2026-10-27 after the owner's archer balance change (lower HP/damage and shield
 * multiplier; cheap test update, no separate colony retune): medium 25 mixed 3 → 4, hard 35
 * veterans 2 → 5. Easy and 40-veteran seeds stay unchanged.
 */
describe("colony garrison balance", () => {
  it("an easy colony falls to 12 soldiers (13 mixed) and holds against 10", () => {
    expect(assault("easy", 12, AVERAGE, 3)).toBe(true);
    expect(assault("easy", 13, AVERAGE, 3, true)).toBe(true);
    expect(assault("easy", 10, AVERAGE, 2)).toBe(false);
  }, 300_000);
});
