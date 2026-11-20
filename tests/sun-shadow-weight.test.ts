import { describe, expect, it } from "vitest";

import { computeEnvironment, getSunShadowWeight, SUN_SHADOW_WEIGHT_FLOOR } from "../src/render-common/environment";

const BASE_SUN = { azimuthX: 0.6, azimuthZ: 0.8, elevation: 0.9 };

describe("real-time sun shadow strength (owner 2026-11-07)", () => {
  it("keeps the shadow map at full strength near the baked sun and at least the floor at low sun", () => {
    expect(getSunShadowWeight(computeEnvironment(BASE_SUN, 12, 0))).toBeCloseTo(1);
    for (const hour of [7, 8, 16, 17]) {
      const environment = computeEnvironment(BASE_SUN, hour, 0);
      expect(environment.bakedShadowWeight).toBeLessThan(SUN_SHADOW_WEIGHT_FLOOR);
      expect(getSunShadowWeight(environment)).toBeCloseTo(SUN_SHADOW_WEIGHT_FLOOR);
    }
  });

  it("still fades with overcast exactly like the baked weight", () => {
    const clear = computeEnvironment(BASE_SUN, 12, 0), rainy = computeEnvironment(BASE_SUN, 12, 1);
    expect(getSunShadowWeight(rainy)).toBeCloseTo(getSunShadowWeight(clear) * 0.5);
    const lowRain = computeEnvironment(BASE_SUN, 7, 1);
    expect(getSunShadowWeight(lowRain)).toBeCloseTo(SUN_SHADOW_WEIGHT_FLOOR * 0.5);
  });
});
