import { describe, expect, it } from "vitest";

import {
  type BridgePlan,
  type BridgePlanningRequest,
  type BridgePlanningWorld,
  planBridge} from "../src/shared/settlement/bridge-planning";
import { bridgeRoadProblem } from "../src/shared/settlement/bridge-road";
import { BRIDGE_DECK_WIDTH, roadRibbonWidth } from "../src/shared/settlement/road-types";
import { bridgeRules, type BridgeTestWorld,bridgeTestWorld } from "./helpers/bridge-world";

const request = (
  world: BridgePlanningWorld, overrides: Partial<BridgePlanningRequest> = {}
): BridgePlanningRequest => ({
  id: 7,
  kind: "wood",
  pointer: { x: 9, z: 12 },
  rules: bridgeRules(world as BridgeTestWorld),
  world,
  ...overrides
});

const planned = (result: ReturnType<typeof planBridge>): BridgePlan => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
};

describe("bridge planning", () => {
  it("plans a straight two-lane wood span with flared approaches and per-tile cost", () => {
    const world = bridgeTestWorld();
    const plan = planned(planBridge(request(world)));

    expect(plan.start).toEqual({ x: 7, z: 12 });
    expect(plan.end).toEqual({ x: 11, z: 12 });
    expect(plan.tiles).toBe(8);
    expect(plan.deckWidth).toBe(BRIDGE_DECK_WIDTH);
    expect(plan.lanes).toBe(2);
    expect(plan.cost).toEqual({ logs: 16, planks: 8, stone: 0 });
    expect(plan.approaches.map(({ anchor, innerWidth, outer, outerWidth }) =>
      ({ anchor, innerWidth, outer, outerWidth }))).toEqual([
      {
        anchor: { x: 7, z: 12 },
        innerWidth: BRIDGE_DECK_WIDTH,
        outer: { x: 5.5, z: 12 },
        outerWidth: 1.3
      },
      {
        anchor: { x: 11, z: 12 },
        innerWidth: BRIDGE_DECK_WIDTH,
        outer: { x: 12.5, z: 12 },
        outerWidth: 1.3
      }
    ]);
    expect(plan.segments).toHaveLength(8);
    expect(bridgeRoadProblem(plan.segments)).toBeNull();
    for (const [tile, segment] of plan.segments.entries()) {
      expect(segment.tier).toBe("dirt");
      expect(segment.bridge).toEqual({
        id: 7, kind: "wood", width: BRIDGE_DECK_WIDTH, tile, tiles: 8
      });
      expect(segment.end.x - segment.start.x).toBe(0.5);
      expect(roadRibbonWidth(segment, 0.5)).toBe(BRIDGE_DECK_WIDTH);
    }
  });

  it("uses stone cost, selected-bank orientation and an explicit approach width", () => {
    const world = bridgeTestWorld();
    const plan = planned(planBridge(request(world, {
      approachWidth: 0.9,
      bank: { x: 11, z: 12 },
      kind: "stone"
    })));

    expect(plan.start).toEqual({ x: 11, z: 12 });
    expect(plan.end).toEqual({ x: 7, z: 12 });
    expect(plan.cost).toEqual({ logs: 0, planks: 8, stone: 16 });
    expect(plan.approaches[0]!.outer).toEqual({ x: 12.5, z: 12 });
    expect(plan.approaches[0]!.outerWidth).toBe(0.9);
    expect(plan.segments[0]!.tier).toBe("stone");
    expect(plan.segments[0]!.start).toEqual({ x: 11, z: 12 });
  });

  it("accepts the 12-tile maximum and refuses longer spans", () => {
    const maximum = planned(planBridge(request(bridgeTestWorld({ waterFrom: 8, waterTo: 12 }), {
      kind: "stone"
    })));
    expect(maximum.tiles).toBe(12);
    expect(maximum.cost).toEqual({ logs: 0, planks: 12, stone: 24 });
    expect(planBridge(request(bridgeTestWorld({ waterFrom: 1, waterTo: 20 }))))
      .toEqual({ ok: false, reason: "too-long" });
  });

  it("refuses spans below the minimum tile count", () => {
    const world = bridgeTestWorld({ waterFrom: 9, waterTo: 9 });
    for (let z = 0; z <= world.cellsZ; z += 1) {
      const row = z * (world.cellsX + 1);
      world.waterDepth[row + 9] = 1;
      world.waterDepth[row + 8] = -1;
      world.waterDepth[row + 10] = -1;
    }
    expect(planBridge(request(world))).toEqual({ ok: false, reason: "too-short" });
  });

  it("rejects open sea, dry pointers and unsafe approaches", () => {
    expect(planBridge(request(bridgeTestWorld({ sea: true }))))
      .toEqual({ ok: false, reason: "ineligible-water" });
    expect(planBridge(request(bridgeTestWorld(), { pointer: { x: 5, z: 12 } })))
      .toEqual({ ok: false, reason: "not-over-water" });
    const world = bridgeTestWorld();
    const rules = { ...bridgeRules(world), isSafeShore: (point: { x: number }) => point.x < 11 };
    expect(planBridge(request(world, { rules }))).toEqual({ ok: false, reason: "unsafe-shore" });
  });

  it("rejects a selected bank outside the span and invalid inputs", () => {
    const world = bridgeTestWorld();
    expect(planBridge(request(world, { bank: { x: 2, z: 12 } })))
      .toEqual({ ok: false, reason: "selected-bank-too-far" });
    expect(planBridge(request(world, { id: -1 }))).toEqual({ ok: false, reason: "invalid-id" });
    expect(planBridge(request(world, { kind: "iron" as never })))
      .toEqual({ ok: false, reason: "invalid-kind" });
    expect(planBridge(request(world, { approachWidth: 3 })))
      .toEqual({ ok: false, reason: "invalid-approach-width" });
    expect(planBridge(request(world, { pointer: { x: Number.NaN, z: 12 } })))
      .toEqual({ ok: false, reason: "invalid-pointer" });
  });
});
