import { describe, expect, it } from "vitest";

import { bridgeLatticeSpan, bridgeSpanTiles } from "../src/shared/settlement/bridge-lattice";
import {
  type BridgePlan,
  type BridgePlanningRequest,
  planBridge
} from "../src/shared/settlement/bridge-planning";
import { bridgeRoadProblem } from "../src/shared/settlement/bridge-road";
import { bridgeCost, type RoadPoint } from "../src/shared/settlement/road-types";
import {
  angledBridgeTestWorld,
  type AngledRiver,
  bridgeRules,
  type BridgeTestWorld,
  riverCentreDistance,
  riverDirection
} from "./helpers/bridge-world";

const river = (angleDegrees: number, halfWidth = 1.6): AngledRiver =>
  ({ angleDegrees, centre: { x: 16, z: 16 }, halfWidth });

const request = (
  world: BridgeTestWorld, overrides: Partial<BridgePlanningRequest> = {}
): BridgePlanningRequest => ({
  id: 5,
  kind: "wood",
  pointer: { x: 16, z: 16 },
  rules: bridgeRules(world),
  world,
  ...overrides
});

const planned = (result: ReturnType<typeof planBridge>): BridgePlan => {
  expect(result.ok, result.ok ? "" : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
};

const unitOf = (plan: BridgePlan): RoadPoint => {
  const dx = plan.end.x - plan.start.x, dz = plan.end.z - plan.start.z, length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
};

describe("angled bridge planning", () => {
  it.each([15, 30, 45, 60, 75, 120, 150])("crosses a %i degree river close to its normal", angle => {
    const water = river(angle);
    const world = angledBridgeTestWorld(water);
    const plan = planned(planBridge(request(world)));
    const unit = unitOf(plan), flow = riverDirection(water);
    // Within about 13 degrees of the river normal; never along the river.
    expect(Math.abs(unit.x * flow.x + unit.z * flow.z)).toBeLessThan(0.23);
    expect(riverCentreDistance(water, plan.start)).toBeGreaterThanOrEqual(water.halfWidth);
    expect(riverCentreDistance(water, plan.end)).toBeGreaterThanOrEqual(water.halfWidth);
    const span = bridgeLatticeSpan(plan.start, plan.end)!;
    expect(plan.tiles).toBe(span.tiles);
    expect(plan.tiles).toBe(Math.ceil(Math.hypot(plan.end.x - plan.start.x, plan.end.z - plan.start.z) / 0.5 - 1e-9));
    expect(plan.tiles).toBeGreaterThanOrEqual(3);
    expect(plan.tiles).toBeLessThanOrEqual(12);
    expect(plan.cost).toEqual(bridgeCost("wood", plan.tiles));
    expect(plan.segments).toHaveLength(span.edges);
    expect(bridgeRoadProblem(plan.segments)).toBeNull();
    for (const [tile, segment] of plan.segments.entries())
      expect(segment.bridge).toEqual({ id: 5, kind: "wood", width: 2.6, tile, tiles: plan.tiles });
    expect(plan.segments[0]!.start).toEqual(plan.start);
    expect(plan.segments.at(-1)!.end).toEqual(plan.end);
  });

  it("builds a genuinely diagonal span with long lattice edges for a 45 degree river", () => {
    const plan = planned(planBridge(request(angledBridgeTestWorld(river(45)))));
    const unit = unitOf(plan);
    expect(Math.abs(unit.x)).toBeGreaterThan(0.3);
    expect(Math.abs(unit.z)).toBeGreaterThan(0.3);
    expect(plan.segments.some(segment =>
      Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z) > 0.5)).toBe(true);
    // The approach flares continue the deck axis onto the land behind each anchor.
    const [first, second] = plan.approaches;
    expect(first.anchor).toEqual(plan.start);
    expect(second.anchor).toEqual(plan.end);
    const alongDeck = (from: RoadPoint, to: RoadPoint) => (to.x - from.x) * unit.x + (to.z - from.z) * unit.z;
    expect(alongDeck(first.outer, first.anchor)).toBeGreaterThan(1);
    expect(alongDeck(second.anchor, second.outer)).toBeGreaterThan(1);
  });

  it("measures paid tiles along the span, rounded up", () => {
    expect(bridgeSpanTiles(8, 0)).toBe(8);
    expect(bridgeSpanTiles(6, -3)).toBe(7);
    expect(bridgeSpanTiles(4, 4)).toBe(6);
    expect(bridgeSpanTiles(3, 4)).toBe(5);
    expect(bridgeLatticeSpan({ x: 15.5, z: 17 }, { x: 18.5, z: 15.5 }))
      .toEqual({ edges: 3, stepX: 2, stepZ: -1, tiles: 7 });
  });

  it("is deterministic and orients the span from the selected bank", () => {
    const world = angledBridgeTestWorld(river(30));
    const first = planned(planBridge(request(world)));
    expect(planned(planBridge(request(world)))).toEqual(first);
    const reversed = planned(planBridge(request(world, { bank: first.end })));
    expect(reversed.start).toEqual(first.end);
    expect(reversed.end).toEqual(first.start);
    expect(reversed.tiles).toBe(first.tiles);
    expect(bridgeRoadProblem(reversed.segments)).toBeNull();
  });

  it("refuses an open-sea crossing at an angle", () => {
    expect(planBridge(request(angledBridgeTestWorld(river(40), { sea: true }))))
      .toEqual({ ok: false, reason: "ineligible-water" });
  });

  it("refuses angled crossings that are too long or too short along the span", () => {
    expect(planBridge(request(angledBridgeTestWorld(river(35, 3.4)))))
      .toEqual({ ok: false, reason: "too-long" });
    // A narrow stream is refused, not skewed into a longer span to reach the three-tile minimum.
    expect(planBridge(request(angledBridgeTestWorld(river(10, 0.2)))))
      .toEqual({ ok: false, reason: "too-short" });
  });

  it("refuses a blocked shore on one bank", () => {
    const water = river(50);
    const world = angledBridgeTestWorld(water);
    const flowNormal = { x: -riverDirection(water).z, z: riverDirection(water).x };
    const side = (point: RoadPoint) =>
      (point.x - water.centre.x) * flowNormal.x + (point.z - water.centre.z) * flowNormal.z;
    const rules = { ...bridgeRules(world), isSafeShore: (point: RoadPoint) =>
      bridgeRules(world).isSafeShore(point) && side(point) < 0 };
    expect(planBridge(request(world, { rules }))).toEqual({ ok: false, reason: "unsafe-shore" });
  });

  it("refuses a cliff, building or prop on the bank under the angled deck", () => {
    const water = river(25);
    const world = angledBridgeTestWorld(water);
    // Anchors stay safe; only the dry bank strip the deck passes over is obstructed.
    const bankStrip = (point: RoadPoint) => {
      const distance = riverCentreDistance(water, point);
      return distance > water.halfWidth && distance < water.halfWidth + 0.7;
    };
    const rules = { ...bridgeRules(world), isClearUnderDeck: (point: RoadPoint) => !bankStrip(point) };
    expect(planBridge(request(world, { rules }))).toEqual({ ok: false, reason: "unsafe-shore" });
    expect(planBridge(request(world)).ok).toBe(true);
  });
});
