import { describe, expect, it } from "vitest";

import { inspectWalkingConnectivity } from "../src/shared/settlement/scenario-connectivity-inspection";
import { inspectScenarioRoads } from "../src/shared/settlement/scenario-road-placement";
import { inspectScenarioWorld } from "../src/shared/settlement/scenario-world-inspection";
import { inspectWorldNavigation } from "../src/shared/settlement/scenario-world-navigation";
import { createScenarioInspectionContext } from "../src/shared/settlement/settlement-map-scenario";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { BLOCKING, PROP_REMOVED } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const flat = () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, forest: 0, mountains: 0, rivers: 0, erosionDroplets: 0 });
  world.heights.fill(2); world.waterSurface.fill(0); world.waterDepth.fill(0);
  world.props.types.fill(PROP_REMOVED); world.blocking.fill(0); world.walkCost.fill(10); world.slopeClass.fill(0);
  world.scenario = undefined;
  return world;
};
const exhaust = <T, R>(steps: Generator<T, R>): R => {
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
};
describe("whole-island native navigation evidence", () => {
  it("rejects authored roads whose empty verge overlaps a foundation outside the paving", () => {
    const context = createScenarioInspectionContext(flat());
    context.occupied[11 * context.options.world.cellsX + 10] = 1;
    const road = (z: number) => [{ start: { x: 10, z }, end: { x: 10.5, z }, tier: "dirt" as const }];
    expect(inspectScenarioRoads(context, road(10))).toEqual([expect.stringContaining("reserved strip")]);
    expect(inspectScenarioRoads(context, road(14))).toEqual([]);
  });
  it("finds isolated land and reconnects only after the actual water barrier is removed", () => {
    const world = flat();
    const inspect = () => exhaust(inspectWalkingConnectivity(createScenarioInspectionContext(world), () => false));
    expect(inspect().components).toHaveLength(1);
    for (let z = 0; z <= world.cellsZ; z++) for (let x = 29; x <= 35; x++) {
      const index = z * (world.cellsX + 1) + x;
      world.waterSurface[index] = 5;
    }
    for (let z = 0; z < world.cellsZ; z++) for (let x = 29; x <= 35; x++) {
      const cell = z * world.cellsX + x; world.walkCost[cell] = 0; world.blocking[cell] = BLOCKING.water;
    }
    const separated = inspect();
    expect(separated.complete).toBe(true);
    expect(separated.components.length).toBeGreaterThanOrEqual(2);
    world.waterSurface.fill(0); world.walkCost.fill(10); world.blocking.fill(0);
    expect(inspect().components).toHaveLength(1);
  });
  it("keeps worker-boundary worlds and reports cloneable and distinguishes open ocean from land", () => {
    const world = structuredClone(flat());
    world.heights.fill(world.seaLevel - 8);
    world.waterSurface.fill(world.seaLevel); world.waterDepth.fill(8);
    world.walkCost.fill(0); world.blocking.fill(BLOCKING.water);
    const report = exhaust(inspectWorldNavigation(world, [], 10000));
    expect(report.complete).toBe(true);
    expect(report.walking?.nodes).toBe(0);
    expect(report.marine?.complete).toBe(true);
    expect(report.marine!.oceanTurning).toBeGreaterThan(0);
    expect(report.harbourCount).toBe(0);
    expect(report.routes).toEqual([]);
    expect(structuredClone(report).walking?.labels).toBeInstanceOf(Uint32Array);
  });
  it("never calls a deadline-truncated graph a demonstrated isolated fragment", () => {
    const report = exhaust(inspectWorldNavigation(flat(), [], 0));
    expect(report.complete).toBe(false);
    expect(report.walking?.complete).toBe(false);
    expect(report.findings).toEqual([expect.objectContaining({ outcome: "unknown" })]);
    expect(report.routes).toEqual([]);
  });
  it("cancels between native graph batches without publishing stale evidence", async () => {
    const world = flat(); let navigating = false;
    await expect(inspectScenarioWorld(world, {
      maxMilliseconds: 0, navigationMilliseconds: 10000,
      onPhase: () => { navigating = true; },
      yieldControl: async () => { if (navigating) world.terrainRevision = (world.terrainRevision ?? 0) + 1; }
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(navigating).toBe(true);
  });
});
