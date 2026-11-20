import { describe, expect, it } from "vitest";

import {
  footworkDistance, holdsPlace, MELEE_PLACES, placeHeading, staggerShare
} from "../src/shared/settlement/military-engagement";

/** Close-combat choreography rules (docs/archive/dated/military-motion-2026-10-13.md, step 3). */
describe("military engagement rules", () => {
  const claims = [
    { distance: 1, holding: false, uid: 1 }, { distance: 2, holding: false, uid: 2 },
    { distance: 3, holding: false, uid: 3 }, { distance: 4, holding: false, uid: 4 }
  ];

  it("gives a foe's places to its nearest claimants; the rest wait", () => {
    expect([1, 2, 3, 4].map(uid => holdsPlace(claims, uid, MELEE_PLACES))).toEqual([true, true, true, false]);
    expect(holdsPlace(claims, 9, MELEE_PLACES)).toBe(false);
  });

  it("lets a soldier keep its place against a slightly nearer newcomer", () => {
    const held = claims.map(claim => claim.uid === 4 ? { ...claim, distance: 3.2, holding: true } : claim);
    expect(holdsPlace(held, 4, MELEE_PLACES)).toBe(true);
    expect(holdsPlace(held, 3, MELEE_PLACES)).toBe(false);
  });

  it("spreads places from the attackers' own side, never two on one spot", () => {
    expect(placeHeading(.3, [], () => true)).toBeCloseTo(.3);
    const second = placeHeading(.3, [.3], () => true)!;
    expect(Math.abs(second - .3)).toBeGreaterThanOrEqual(.96 - 1e-9);
    expect(Math.abs(second - .3)).toBeLessThan(1.5);
    expect(placeHeading(0, [], heading => heading < -.1)).toBeLessThan(-.1);
    expect(placeHeading(0, [0], () => false)).toBeNull();
  });

  it("steps back after a blow and in again before the next, always within reach", () => {
    const standoff = .77, reach = .9, interval = 1;
    const back = footworkDistance(standoff, reach, .9, interval);
    expect(back).toBeGreaterThan(standoff);
    expect(back).toBeLessThan(reach);
    expect(footworkDistance(standoff, reach, .2, interval)).toBe(standoff);
  });

  it("staggers first blows by pair, deterministically", () => {
    const shares = Array.from({ length: 20 }, (_, index) => staggerShare(index, 100));
    expect(shares.every(share => share >= .15 && share <= .65)).toBe(true);
    expect(new Set(shares.map(share => share.toFixed(2))).size).toBeGreaterThan(10);
    expect(staggerShare(7, 100)).toBe(staggerShare(7, 100));
  });
});
