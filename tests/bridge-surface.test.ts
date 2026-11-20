import { describe, expect, it } from "vitest";

import { planBridge } from "../src/shared/settlement/bridge-planning";
import {
  BRIDGE_APPROACH_FLARE,
  BRIDGE_CAMBER_PER_TILE,
  BRIDGE_MAX_RAMP_SLOPE,
  BRIDGE_MIN_FREEBOARD,
  bridgeDeckHeight,
  createBridgeSurfaceHeight,
  createBridgeSurfaceProfiles
} from "../src/shared/settlement/bridge-surface";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { bridgeRules, bridgeTestWorld } from "./helpers/bridge-world";

const bridgeSegments = (): RoadSegment[] => {
  const world = bridgeTestWorld();
  const planned = planBridge({
    id: 3,
    kind: "wood",
    pointer: { x: 9, z: 12 },
    rules: bridgeRules(world),
    world
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.reason);
  return planned.plan.segments;
};

describe("shared bridge surface", () => {
  it("keeps the deck above the water and reaches the authored mid-span camber", () => {
    const segments = bridgeSegments();
    const terrain = () => 0.6;
    const water = () => 0.2;
    const profiles = createBridgeSurfaceProfiles(segments, terrain, water);
    expect(profiles).toHaveLength(1);
    const profile = profiles[0]!;
    expect(profile.camber).toBeCloseTo(BRIDGE_CAMBER_PER_TILE * profile.tiles, 8);
    expect(profile.baseHeight).toBeGreaterThanOrEqual(water() + BRIDGE_MIN_FREEBOARD - 1e-9);
    expect(bridgeDeckHeight(profile, 0.5)).toBeCloseTo(profile.baseHeight + profile.camber, 8);
    expect(bridgeDeckHeight(profile, 0.5)).toBeGreaterThanOrEqual(water() + BRIDGE_MIN_FREEBOARD);

    const height = createBridgeSurfaceHeight(segments, terrain, water);
    const mid = { x: (profile.start.x + profile.end.x) / 2, z: (profile.start.z + profile.end.z) / 2 };
    expect(height(mid.x, mid.z)).toBeCloseTo(bridgeDeckHeight(profile, 0.5), 8);
    expect(height(profile.start.x, profile.start.z)).toBeCloseTo(profile.baseHeight, 8);
  });

  it("returns a deck only over the clear width and undefined outside the span and ramps", () => {
    const segments = bridgeSegments();
    const profile = createBridgeSurfaceProfiles(segments, () => 0.6, () => 0.2)[0]!;
    const height = createBridgeSurfaceHeight(segments, () => 0.6, () => 0.2);
    const mid = { x: (profile.start.x + profile.end.x) / 2, z: (profile.start.z + profile.end.z) / 2 };
    const across = { x: -profile.unit.z, z: profile.unit.x };
    expect(typeof height(mid.x + across.x * 1.28, mid.z + across.z * 1.28)).toBe("number");
    expect(height(mid.x + across.x * 1.32, mid.z + across.z * 1.32)).toBeUndefined();
    expect(height(profile.start.x - profile.unit.x * 4, profile.start.z - profile.unit.z * 4))
      .toBeUndefined();
    expect(height(mid.x, mid.z + 4)).toBeUndefined();
  });

  it("grades both shore approaches at no more than 1:6", () => {
    const segments = bridgeSegments();
    const profile = createBridgeSurfaceProfiles(segments, () => 0, () => 0.2)[0]!;
    const height = createBridgeSurfaceHeight(segments, () => 0, () => 0.2);
    const step = 0.05;
    for (const shore of [profile.start, profile.end]) {
      const direction = shore === profile.start ? -1 : 1;
      let previous = height(shore.x + profile.unit.x * direction * BRIDGE_APPROACH_FLARE,
        shore.z + profile.unit.z * direction * BRIDGE_APPROACH_FLARE);
      expect(typeof previous).toBe("number");
      for (let distance = BRIDGE_APPROACH_FLARE - step; distance >= 0; distance -= step) {
        const point = height(shore.x + profile.unit.x * direction * distance,
          shore.z + profile.unit.z * direction * distance);
        expect(typeof point).toBe("number");
        const slope = Math.abs((point! - previous!) / step);
        expect(slope).toBeLessThanOrEqual(BRIDGE_MAX_RAMP_SLOPE + 1e-6);
        previous = point;
      }
    }
  });
});
