import { describe, expect, it } from "vitest";

import { clamp01, lerp3, sinHash2, smoothstep, smoothstep01 } from "../src/shared/world/noise";

describe("shared noise helpers", () => {
  it("smoothstep clamps outside the edges and eases between them", () => {
    expect(smoothstep(0.2, 0.6, 0.1)).toBe(0);
    expect(smoothstep(0.2, 0.6, 0.9)).toBe(1);
    expect(smoothstep(0.2, 0.6, 0.4)).toBeCloseTo(0.5, 12);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(0.84375, 12);
  });

  it("smoothstep01 equals smoothstep over 0..1", () => {
    for (const value of [-1, 0, 0.1, 0.5, 0.73, 1, 2]) expect(smoothstep01(value)).toBe(smoothstep(0, 1, value));
  });

  it("clamp01 keeps values in 0..1", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(3)).toBe(1);
  });

  it("lerp3 blends each component", () => {
    expect(lerp3([0, 1, 2], [4, 1, -2], 0.25)).toEqual([1, 1, 1]);
    expect(lerp3([0.2, 0.4, 0.6], [1, 1, 1], 0)).toEqual([0.2, 0.4, 0.6]);
  });

  it("sinHash2 matches the inline fract(sin) grain the texture bakes used", () => {
    for (const [x, y] of [[0, 0], [3, 17], [255, 1], [1.17, 97], [-4, 9]] as const) {
      const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      expect(sinHash2(x, y)).toBe(value - Math.floor(value));
      expect(sinHash2(x, y)).toBeGreaterThanOrEqual(0);
      expect(sinHash2(x, y)).toBeLessThan(1);
    }
  });
});
