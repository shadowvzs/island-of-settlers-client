import { describe, expect, it } from "vitest";

import { solveConnectedClothHalfspaces } from "../tools/analysis/source-cloth-connected-halfspace";

describe("coupled source trust-polytope solve", () => {
  it("solves simultaneous coupled rows while retaining each weight simplex", () => {
    const corners = [[[1, 0], [0, 1]], [[1, 0], [0, 1]]];
    const result = solveConnectedClothHalfspaces(corners, [1, 0, 1, 0], [
      { coefficients: [0, 1, 0, 1], target: 1.2 },
      { coefficients: [0, 1, 0, 0], target: .4 },
      { coefficients: [0, 0, 1, 0], target: .2 },
    ]);
    expect(result.feasible).toBe(true); expect(result.maximumViolation).toBeLessThanOrEqual(1e-7);
    expect(result.weights[0]! + result.weights[1]!).toBeCloseTo(1, 12);
    expect(result.weights[2]! + result.weights[3]!).toBeCloseTo(1, 12);
    expect(result.weights.every(value => value >= 0 && value <= 1)).toBe(true);
  });
  it("retains a positive residual for incompatible rows instead of claiming success", () => {
    const result = solveConnectedClothHalfspaces([[[1, 0], [0, 1]]], [.5, .5], [
      { coefficients: [1, 0], target: .8 }, { coefficients: [0, 1], target: .8 },
    ], 30);
    expect(result.feasible).toBe(false); expect(result.maximumViolation).toBeGreaterThan(.29);
    // A nonnegative combination of both required rows exceeds the entire simplex support.
    const required = .8 * result.dualWeights.reduce((sum, value) => sum + value, 0);
    expect(required - Math.max(...result.dualWeights)).toBeGreaterThan(0);
  });
});
