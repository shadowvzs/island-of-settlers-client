import { describe, expect, it } from "vitest";

import { getGrassFade } from "../src/renderers/three/grass-fade";

describe("grass fade", () => {
  it("keeps grass off when the quality preset disables it", () => {
    expect(getGrassFade(false, 1, 1)).toBe(0);
  });

  it("keeps the isometric zoom fade unchanged", () => {
    expect(getGrassFade(true, 0.2, 0)).toBe(0);
    expect(getGrassFade(true, 0.45, 0)).toBeCloseTo(0.5, 12);
    expect(getGrassFade(true, 1, 0)).toBe(1);
  });

  it("blends the possessed view to full height regardless of the strategy zoom", () => {
    expect(getGrassFade(true, 0.2, 1)).toBe(1);
    expect(getGrassFade(true, 0.2, 0.5)).toBe(0.5);
    expect(getGrassFade(true, 0.45, 2)).toBe(1);
  });
});
