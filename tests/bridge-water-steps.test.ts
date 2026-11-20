import { describe, expect, it } from "vitest";

import { planBridge } from "../src/shared/settlement/bridge-planning";
import type { Waterfall } from "../src/shared/world/world-data";
import { bridgeRules, type BridgeTestWorld, bridgeTestWorld } from "./helpers/bridge-world";

const POINTER = { x: 9, z: 12 };

const ledgeAt = (z: number): Waterfall => ({
  bottom: 0.6, directionX: 0, directionZ: 1, poolRadius: 1.3, poolX: 9, poolZ: z + 1.1, top: 1, width: 2, x: 9, z
});

const plan = (world: BridgeTestWorld) =>
  planBridge({ id: 1, kind: "wood", pointer: POINTER, rules: bridgeRules(world), world });

const withSurface = (world: BridgeTestWorld, level: (x: number) => number) => {
  const stride = world.cellsX + 1;
  world.waterSurface = Float32Array.from(world.waterDepth, (_, index) => level(index % stride));
  return world;
};

describe("bridges and stepped cascades (TT-6)", () => {
  it("still plans a span over a level reach", () => {
    expect(plan(withSurface(bridgeTestWorld(), () => 1)).ok).toBe(true);
  });

  it("rejects a span over a cascade ledge, its pool or within two tiles of them", () => {
    for (const z of [12, 11, 14.5]) {
      const world = withSurface(bridgeTestWorld(), () => 1);
      world.waterfalls = [ledgeAt(z)];
      expect(plan(world)).toEqual({ ok: false, reason: "across-water-step" });
    }
  });

  it("keeps a span well away from a fall", () => {
    const world = withSurface(bridgeTestWorld(), () => 1);
    world.waterfalls = [ledgeAt(20)];
    expect(plan(world).ok).toBe(true);
  });

  it("rejects a span whose water level steps under the deck", () => {
    expect(plan(withSurface(bridgeTestWorld(), x => (x < 9 ? 1.4 : 1)))).toEqual({
      ok: false, reason: "across-water-step"
    });
  });
});
