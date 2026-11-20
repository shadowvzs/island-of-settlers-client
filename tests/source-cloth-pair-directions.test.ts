import { describe, expect, it } from "vitest";

import { bestPairedClothAdvance } from "../tools/analysis/source-cloth-pair-directions";

describe("bounded coupled cloth support directions", () => {
  it("balances opposing pose gradients at their exact boundary intersection", () => {
    const result = bestPairedClothAdvance([.1, -.03], [-.04, .1]);
    expect(result.first).toBe(1);
    expect(result.second).toBeCloseTo(13 / 14, 12);
    expect(result.advance).toBeCloseTo(11 / 175, 12);
  });

  it("keeps a harmful direction unused and identifies a non-improving pair", () => {
    expect(bestPairedClothAdvance([.2, .1], [-.3, -.4]))
      .toEqual({ first: 1, second: 0, advance: .1 });
    expect(bestPairedClothAdvance([-1, -2], [-2, -1]))
      .toEqual({ first: 0, second: 0, advance: 0 });
  });
});
