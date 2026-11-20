import { describe, expect, it } from "vitest";

import { sourceClothWeightVertices } from "../tools/analysis/source-cloth-weight-polytope";

describe("literal four-joint source weight trust region", () => {
  it("finds the exact allowed transfer corners of a single-joint source", () => {
    const vertices = sourceClothWeightVertices([1, 0, 0, 0], .35);
    expect(vertices).toHaveLength(4);
    expect(Math.min(...vertices.map(weights => weights[0]!))).toBeCloseTo(.825, 12);
    expect(Math.max(...vertices.map(weights => weights[1]!))).toBeCloseTo(.175, 12);
  });

  it("keeps mixed-source vertices normalized, nonnegative and within their exact L1 budget", () => {
    const seed = [.81, .096, .094, 0], vertices = sourceClothWeightVertices(seed, .35);
    expect(vertices.length).toBeGreaterThan(4);
    for (const weights of vertices) {
      expect(Math.min(...weights)).toBeGreaterThanOrEqual(-1e-12);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
      expect(weights.reduce((sum, weight, slot) => sum + Math.abs(weight - seed[slot]!), 0)).toBeLessThanOrEqual(.35 + 1e-12);
    }
  });
});
