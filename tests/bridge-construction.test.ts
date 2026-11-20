import { describe, expect, it } from "vitest";

import {
  bridgeConstructionStage,
  bridgeSiteProblem
} from "../src/shared/settlement/bridge-construction";
import { fitStoneRoadWidths } from "../src/shared/settlement/road-fitted-widths";
import { roadRibbonWidth } from "../src/shared/settlement/road-types";
import { createBridgeSettlement } from "./helpers/bridge-settlement";

const delivered = (goods: Record<string, number>) =>
  Object.values(goods).reduce((sum, count) => sum + count, 0);

const advanceUntil = (
  advance: (seconds: number, step?: number) => void,
  simulation: ReturnType<typeof createBridgeSettlement>["simulation"],
  done: () => boolean,
  maxSeconds = 1200
) => {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 0.1) {
    if (done()) return true;
    simulation.update(0.1);
  }
  return done();
};

describe("bridge construction", () => {
  it("maps site progress to foundations, deck and railings stages", () => {
    expect(bridgeConstructionStage(0)).toBe("foundations");
    expect(bridgeConstructionStage(0.34)).toBe("foundations");
    expect(bridgeConstructionStage(0.35)).toBe("deck");
    expect(bridgeConstructionStage(0.79)).toBe("deck");
    expect(bridgeConstructionStage(0.8)).toBe("railings");
    expect(bridgeConstructionStage(1)).toBe("railings");
  });

  it("creates one builder site, keeps the span out of the road graph, and refuses a duplicate", () => {
    const { leftAnchor, pointer, rightAnchor, roads, simulation } = createBridgeSettlement();
    const preview = simulation.previewBridge(pointer, "wood", leftAnchor);
    expect(preview.ok).toBe(true);
    expect(preview.connections).toEqual({ start: true, end: true, stock: true });
    expect(preview.plan?.tiles).toBe(6);

    const result = simulation.buildBridge(pointer, "wood", leftAnchor);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.tiles).toBe(6);
    expect(result.cost).toEqual({ logs: 12, planks: 6, stone: 0 });

    const site = simulation.bridgeConstructions()[0]!;
    expect(site).toMatchObject({
      id: result.id,
      kind: "wood",
      tiles: 6,
      stage: "foundations",
      builders: 0,
      required: { logs: 12, planks: 6, stone: 0 }
    });
    expect(bridgeSiteProblem(site)).toBeNull();
    expect(simulation.roadSegments().filter(segment => segment.bridge)).toEqual([]);
    expect(roads.route(leftAnchor, rightAnchor)).toBeNull();
    expect(simulation.buildings().some(building => building.bridgeSite)).toBe(false);

    expect(simulation.buildBridge(pointer, "wood", leftAnchor))
      .toEqual({ ok: false, reason: "bridge-overlaps-construction" });

    const segment = preview.plan!.segments[0]!;
    const fitted = fitStoneRoadWidths([segment], { isBlocked: () => true });
    expect(fitted[0]).toEqual(segment);
    expect(roadRibbonWidth(fitted[0]!, 0.5)).toBe(2.6);
  });

  it("prices a stone site independently instead of upgrading a wooden bridge", () => {
    const { leftAnchor, pointer, simulation } = createBridgeSettlement();
    const result = simulation.buildBridge(pointer, "stone", leftAnchor);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.cost).toEqual({ logs: 0, planks: 6, stone: 12 });
    const site = simulation.bridgeConstructions()[0]!;
    expect(site.kind).toBe("stone");
    expect(site.segments.every(segment => segment.tier === "stone" &&
      segment.bridge!.kind === "stone")).toBe(true);
    expect(site.required).toEqual({ logs: 0, planks: 6, stone: 12 });
  });

  it("refuses dry pointers, invalid kinds and shores without a road", () => {
    const unconnected = createBridgeSettlement({ rightRoad: false });
    const preview = unconnected.simulation.previewBridge(
      unconnected.pointer, "stone", unconnected.leftAnchor);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toBe("shore-road-missing");
    expect(preview.connections).toEqual({ start: true, end: false, stock: true });
    expect(unconnected.simulation.buildBridge(unconnected.pointer, "stone", unconnected.leftAnchor))
      .toEqual({ ok: false, reason: "shore-road-missing" });

    const { leftAnchor, simulation } = createBridgeSettlement();
    expect(simulation.buildBridge({ x: 5, z: 16 }, "wood", leftAnchor))
      .toEqual({ ok: false, reason: "not-over-water" });
    expect(simulation.buildBridge({ x: 10.5, z: 16 }, "iron" as never, leftAnchor))
      .toEqual({ ok: false, reason: "invalid-kind" });
  });

  it("uses two builders and crossings stay closed until the site completes", () => {
    const { advance, leftAnchor, pointer, rightAnchor, roads, simulation } = createBridgeSettlement();
    expect(simulation.buildBridge(pointer, "wood", leftAnchor).ok).toBe(true);
    let sawCrew = false, sawTwoBuilders = false;
    let sawMidBuild = false;
    const complete = advanceUntil(advance, simulation, () => {
      const site = simulation.bridgeConstructions()[0];
      if (!site) return true;
      sawCrew ||= site.builders > 0;
      sawTwoBuilders ||= site.builders === 2;
      if (site.progress > 0 && site.progress < 1) {
        sawMidBuild = true;
        expect(site.builders).toBeLessThanOrEqual(2);
        expect(simulation.roadSegments().some(segment => segment.bridge)).toBe(false);
      }
      return false;
    });
    expect(complete).toBe(true);
    expect(sawCrew).toBe(true);
    expect(sawTwoBuilders).toBe(true);
    expect(sawMidBuild).toBe(true);
    expect(simulation.bridgeConstructions()).toEqual([]);

    const route = roads.route(leftAnchor, rightAnchor);
    expect(route).not.toBeNull();
    expect(route!.length).toBe(3);
    const bridge = simulation.roadSegments().filter(segment => segment.bridge);
    expect(bridge).toHaveLength(6);
    expect(bridge.every(segment => segment.bridge!.kind === "wood" &&
      segment.bridge!.width === 2.6)).toBe(true);
    expect(roads.stoneRoute(leftAnchor, rightAnchor)).not.toBeNull();
  });

  it("saves and restores progress and delivered materials, then completes after reload", () => {
    const first = createBridgeSettlement();
    expect(first.simulation.buildBridge(first.pointer, "wood", first.leftAnchor).ok).toBe(true);
    expect(advanceUntil(first.advance, first.simulation, () => {
      const site = first.simulation.bridgeConstructions()[0];
      return !!site && delivered(site.delivered) > 0 && site.progress > 0;
    })).toBe(true);
    const before = first.simulation.bridgeConstructions()[0]!;
    expect(before.progress).toBeGreaterThan(0);
    expect(before.delivered).not.toEqual({});
    const saved = first.simulation.saveState();

    const restored = createBridgeSettlement();
    const loaded = restored.simulation.loadState(saved);
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
    const after = restored.simulation.bridgeConstructions()[0]!;
    expect(after.id).toBe(before.id);
    expect(after.progress).toBeCloseTo(before.progress, 8);
    expect(after.delivered).toEqual(before.delivered);
    expect(after.consumed).toEqual(before.consumed);
    expect(restored.simulation.roadSegments().filter(segment => segment.bridge)).toEqual([]);

    expect(advanceUntil(restored.advance, restored.simulation,
      () => restored.simulation.bridgeConstructions().length === 0)).toBe(true);
    expect(restored.roads.route(restored.leftAnchor, restored.rightAnchor)).not.toBeNull();
  });

  it("cancels a site through the construction refund and leaves no bridge edges", () => {
    const { advance, leftAnchor, pointer, rightAnchor, roads, simulation } = createBridgeSettlement();
    expect(simulation.buildBridge(pointer, "wood", leftAnchor).ok).toBe(true);
    expect(advanceUntil(advance, simulation, () => {
      const site = simulation.bridgeConstructions()[0];
      return !!site && delivered(site.delivered) > 0;
    })).toBe(true);
    const site = simulation.bridgeConstructions()[0]!;
    const before = { ...simulation.headquarters.inventory };
    expect(simulation.cancelBridgeConstruction(site.id)).toBe(true);
    expect(simulation.bridgeConstructions()).toEqual([]);
    expect(simulation.roadSegments().filter(segment => segment.bridge)).toEqual([]);
    expect(roads.route(leftAnchor, rightAnchor)).toBeNull();
    for (const [ware, count] of Object.entries(site.delivered))
      expect(simulation.headquarters.inventory[ware] ?? 0).toBe((before[ware] ?? 0) + count);
  });
});
