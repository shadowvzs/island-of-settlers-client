import { describe, expect, it } from "vitest";

import { DMath } from "../src/shared/math/deterministic-math";

const bits = new Float64Array(1), ints = new BigInt64Array(bits.buffer);
/** Distance in units of the last place between two finite doubles. */
const ulps = (a: number, b: number) => {
  if (Object.is(a, b)) return 0;
  bits[0] = a; const left = ints[0]!; bits[0] = b; const right = ints[0]!;
  const distance = left > right ? left - right : right - left;
  return Math.sign(a) === Math.sign(b) ? Number(distance) : Infinity;
};

const inputs = (count: number, scale: number, offset = 0.5) => {
  let state = 12345;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 4294967296 - offset) * scale;
  });
};

const maxUlps = (values: number[], ours: (x: number) => number, native: (x: number) => number) =>
  Math.max(...values.map(x => ulps(ours(x), native(x))));

describe("deterministic math (D4.6)", () => {
  it("stays within fdlibm's accuracy of the native functions", () => {
    const angles = [...inputs(20_000, 8 * Math.PI), ...inputs(2000, 2e5), ...inputs(2000, 1e-6)];
    expect(maxUlps(angles, DMath.sin, Math.sin)).toBeLessThanOrEqual(1);
    expect(maxUlps(angles, DMath.cos, Math.cos)).toBeLessThanOrEqual(1);
    expect(maxUlps(inputs(20_000, 3), DMath.tan, Math.tan)).toBeLessThanOrEqual(3);
    expect(maxUlps(inputs(20_000, 1e4), DMath.atan, Math.atan)).toBeLessThanOrEqual(1);
    const pairs = inputs(20_000, 1200);
    expect(Math.max(...pairs.map((y, index) => ulps(DMath.atan2(y, pairs[(index * 7) % pairs.length]!),
      Math.atan2(y, pairs[(index * 7) % pairs.length]!))))).toBeLessThanOrEqual(1);
    expect(maxUlps(inputs(20_000, 2), DMath.asin, Math.asin)).toBeLessThanOrEqual(3);
    expect(maxUlps(inputs(20_000, 2), DMath.acos, Math.acos)).toBeLessThanOrEqual(3);
    expect(maxUlps(inputs(20_000, 1400), DMath.exp, Math.exp)).toBeLessThanOrEqual(1);
    expect(maxUlps(inputs(20_000, 1e9, 0).map(x => x + 1e-300), DMath.log, Math.log)).toBeLessThanOrEqual(1);
    expect(maxUlps(inputs(20_000, 1200), x => DMath.hypot(x, x * 0.7), x => Math.hypot(x, x * 0.7)))
      .toBeLessThanOrEqual(1);
  });

  it("keeps the special values", () => {
    expect([DMath.sin(0), DMath.sin(-0), DMath.cos(0), DMath.sin(NaN), DMath.cos(Infinity)])
      .toEqual([0, -0, 1, NaN, NaN]);
    expect([DMath.atan2(0, -1), DMath.atan2(-0, 1), DMath.atan2(1, 0), DMath.atan2(-1, -Infinity),
      DMath.atan2(Infinity, Infinity), DMath.atan2(NaN, 1)])
      .toEqual([Math.PI, -0, Math.PI / 2, -Math.PI, Math.PI / 4, NaN]);
    expect([DMath.exp(0), DMath.exp(-Infinity), DMath.exp(Infinity), DMath.exp(800), DMath.exp(-800)])
      .toEqual([1, 0, Infinity, Infinity, 0]);
    expect([DMath.log(1), DMath.log(0), DMath.log(-1), DMath.log(Infinity), DMath.log(5e-324)])
      .toEqual([0, -Infinity, NaN, Infinity, Math.log(5e-324)]);
    expect([DMath.hypot(3, 4), DMath.hypot(1, 2, 2), DMath.asin(2), DMath.acos(1)]).toEqual([5, 3, NaN, 0]);
  });
});
