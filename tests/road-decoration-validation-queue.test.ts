import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { RoadSegment } from "../src/shared/settlement/road-types";
import type { createSettlementRoadDecorations as CreateSettlementRoadDecorations }
  from "../src/shared/settlement/settlement-road-decorations";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";

const environment = vi.hoisted(() => ({ roads: [] as RoadSegment[], groundValid: true }));
// Real owner/adapter/geometry; isolate terrain authority so this test measures a large dirty queue.
vi.mock("../src/shared/settlement/road-decoration-context", () => ({
  createRoadDecorationContext: () => ({ invalidate: () => undefined, buildingBoxes: () => [],
    create: () => ({ nation: "roman", roads: environment.roads, heightAt: () => environment.groundValid ? 0 : Number.NaN,
      isOwned: () => true, isFree: () => true }) })
}));

let createSettlementRoadDecorations: typeof CreateSettlementRoadDecorations;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mock,
// then drop the mock and the mocked graph so later files of the worker get the real context.
beforeAll(async () => {
  vi.resetModules();
  ({ createSettlementRoadDecorations } = await import("../src/shared/settlement/settlement-road-decorations"));
});
afterAll(() => {
  vi.doUnmock("../src/shared/settlement/road-decoration-context");
  vi.resetModules();
});

it("a thousand invalidated instances drain in bounded batches, return once, then perform zero unchanged checks", () => {
  const item = "roadDecoration:indigenous-flower-pot:native";
  environment.groundValid = true;
  environment.roads = Array.from({ length: 1000 }, (_, index) => ({
    start: { x: index * 3, z: 4 }, end: { x: index * 3, z: 4.5 }, tier: "stone"
  }));
  let held = 1000;
  const context = { options: { roadDecorationCustody: {
    consume: () => { held--; return true; }, receive: (items: Record<string, number>) => { held += items[item] ?? 0; return true; }
  } } } as unknown as SettlementContext;
  const adapter = createSettlementRoadDecorations(context);
  for (const edge of environment.roads) expect(adapter.place({ item,
    position: { x: edge.start.x + 1, z: 4.25 }, yaw: 0 }).ok).toBe(true);
  expect(held).toBe(0);
  const removed = environment.roads; environment.roads = [];
  adapter.changedRoads(removed);
  while (adapter.counters().dirty) adapter.processPending();
  expect(adapter.frames()).toHaveLength(1000); expect(adapter.returns()).toHaveLength(0);
  environment.groundValid = false; adapter.invalidate();
  expect(adapter.counters().dirty).toBe(744);
  expect(adapter.returns()).toHaveLength(256);
  const interrupted = adapter.save();
  expect(interrupted.placed.length + interrupted.returns.length).toBe(1000);
  const reloaded = createSettlementRoadDecorations(context); reloaded.load(interrupted);
  expect(reloaded.frames()).toHaveLength(0); expect(reloaded.returns()).toHaveLength(1000);
  while (adapter.counters().dirty) {
    const before = adapter.counters(); adapter.processPending();
    expect(adapter.counters().validations - before.validations).toBeLessThanOrEqual(256);
    expect(adapter.counters().dirty).toBeLessThan(before.dirty);
  }
  expect(adapter.returns()).toHaveLength(1000); expect(adapter.frames()).toHaveLength(0);
  const settled = adapter.counters();
  for (let frame = 0; frame < 500; frame++) adapter.processPending();
  expect(adapter.counters()).toEqual(settled);
  const ids = adapter.returns().map(row => row.id);
  for (let start = 0; start < ids.length; start += 256) adapter.claimReturns(ids.slice(start, start + 256));
  adapter.claimReturns(ids.slice(0, 256));
  expect(held).toBe(1000); expect(adapter.returns()).toHaveLength(0);
});
