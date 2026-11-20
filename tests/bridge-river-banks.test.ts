import { describe, expect, it } from "vitest";

import { planBridge } from "../src/shared/settlement/bridge-planning";
import { bridgeBankProblem, SAVED_BRIDGE_BANK_PROBLEM } from "../src/shared/settlement/bridge-river-banks";
import type { RoadPoint } from "../src/shared/settlement/road-types";
import { createBridgeSettlement } from "./helpers/bridge-settlement";
import {
  angledBridgeTestWorld,
  bridgeRules,
  type BridgeTestWorld,
  bridgeTestWorld} from "./helpers/bridge-world";

const plan = (world: BridgeTestWorld, pointer: RoadPoint) =>
  planBridge({ id: 1, kind: "stone", pointer, rules: bridgeRules(world), world });

/** Opens a cove of water into the west bank of the default river (vertices x 8..10). */
const withCove = (world: BridgeTestWorld, fromZ: number, toZ: number, depthX: number) => {
  const stride = world.cellsX + 1;
  for (let z = fromZ; z <= toZ; z += 1) for (let x = depthX; x < 8; x += 1) {
    world.waterDepth[z * stride + x] = 1;
    world.riverDistance[z * stride + x] = 0;
  }
  return world;
};

/** A round pond on dry land: a walker steps around it, so it is never a river crossing. */
const pondWorld = () => {
  const world = bridgeTestWorld({ waterFrom: 30, waterTo: 30 });
  const stride = world.cellsX + 1;
  world.waterDepth.fill(0);
  for (let z = 0; z <= world.cellsZ; z += 1) for (let x = 0; x <= world.cellsX; x += 1) {
    const distance = Math.hypot(x - 12, z - 12);
    world.waterDepth[z * stride + x] = Math.max(-1, Math.min(1, 2.2 - distance));
    world.riverDistance[z * stride + x] = Math.max(0, distance - 2.2);
  }
  return world;
};

describe("bridges must span the river from bank to bank", () => {
  it("accepts a straight crossing with dry anchors on opposite banks", () => {
    const world = bridgeTestWorld();
    const result = plan(world, { x: 9, z: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.sign(result.plan.start.x - 9)).toBe(-Math.sign(result.plan.end.x - 9));
    expect(bridgeBankProblem(world, result.plan.start, result.plan.end)).toBeNull();
  });

  it.each([30, 45, 120])("accepts an angled crossing of a %i degree river", angle => {
    const world = angledBridgeTestWorld({ angleDegrees: angle, centre: { x: 16, z: 16 }, halfWidth: 1.6 });
    const result = plan(world, { x: 16, z: 16 });
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;
    expect(bridgeBankProblem(world, result.plan.start, result.plan.end)).toBeNull();
  });

  it("rejects a span lying along the river bank across a cove", () => {
    const world = withCove(bridgeTestWorld(), 10, 13, 6);
    // Both anchors stand on the west bank; the deck only dips over the cove between them.
    expect(bridgeBankProblem(world, { x: 6.5, z: 8 }, { x: 6.5, z: 15 })).toBe("not-across-river");
  });

  it("rejects a bank-to-bank span that runs along the channel at a shallow angle", () => {
    const world = bridgeTestWorld();
    // About 63 degrees off the river normal: it lies along the water instead of crossing it.
    expect(bridgeBankProblem(world, { x: 6, z: 4 }, { x: 12, z: 16 })).toBe("not-across-river");
    // About 30 degrees off the normal is still a crossing.
    expect(bridgeBankProblem(world, { x: 6, z: 4 }, { x: 12, z: 7.5 })).toBeNull();
  });

  it("rejects spans over land only and spans that start or end in the water", () => {
    const world = bridgeTestWorld();
    expect(bridgeBankProblem(world, { x: 2, z: 4 }, { x: 6, z: 4 })).toBe("not-across-river");
    expect(bridgeBankProblem(world, { x: 9, z: 4 }, { x: 13, z: 4 })).toBe("not-across-river");
    expect(bridgeBankProblem(world, { x: 5, z: 4 }, { x: 9, z: 4 })).toBe("not-across-river");
  });

  it("rejects a span with both ends on the same bank", () => {
    const world = withCove(bridgeTestWorld(), 10, 13, 5);
    expect(bridgeBankProblem(world, { x: 3.5, z: 11.5 }, { x: 6.5, z: 8.5 })).toBe("not-across-river");
    expect(bridgeBankProblem(world, { x: 6, z: 9 }, { x: 6, z: 14.5 })).toBe("not-across-river");
  });

  it("refuses to plan across a pond a walker can step around", () => {
    expect(plan(pondWorld(), { x: 12, z: 12 })).toEqual({ ok: false, reason: "not-across-river" });
  });

  it("rejects a saved bridge site that does not cross the river", () => {
    const first = createBridgeSettlement();
    expect(first.simulation.buildBridge(first.pointer, "wood", first.leftAnchor).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(first.simulation.saveState()));
    const site = saved.buildings.find((building: { bridgeSite?: unknown }) => building.bridgeSite).bridgeSite;
    // Shift the whole span onto the west bank: still a valid lattice run, but over dry land.
    const shift = (point: RoadPoint) => ({ x: point.x - 6, z: point.z });
    site.start = shift(site.start);
    site.end = shift(site.end);
    for (const segment of site.segments) {
      segment.start = shift(segment.start);
      segment.end = shift(segment.end);
    }
    const restored = createBridgeSettlement();
    expect(restored.simulation.loadState(saved)).toEqual({ ok: false, reason: SAVED_BRIDGE_BANK_PROBLEM });
  });

  it("rejects saved completed bridge roads that do not cross the river", () => {
    const first = createBridgeSettlement();
    const result = first.simulation.previewBridge(first.pointer, "wood", first.leftAnchor);
    const saved = JSON.parse(JSON.stringify(first.simulation.saveState()));
    saved.roads.push(...result.plan!.segments.map(segment => ({
      ...segment,
      end: { x: segment.end.x - 6, z: segment.end.z },
      start: { x: segment.start.x - 6, z: segment.start.z }
    })));
    const restored = createBridgeSettlement();
    expect(restored.simulation.loadState(saved)).toEqual({ ok: false, reason: SAVED_BRIDGE_BANK_PROBLEM });
  });
});
