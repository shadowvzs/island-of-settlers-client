import { expect, it } from "vitest";

import { deterministicPow } from "../src/shared/math/deterministic-math";

it("computes deterministic powers without the engine's transcendental path", () => {
  expect(deterministicPow(2, 3)).toBeCloseTo(8, 12);
  expect(deterministicPow(0, 2)).toBe(0);
  expect(deterministicPow(5, 0)).toBe(1);
  expect(deterministicPow(.25, .5)).toBeCloseTo(.5, 12);
});
