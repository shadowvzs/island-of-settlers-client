import { expect, it, vi } from "vitest";

import { editAuthoredRiver, eraseRiverWater, isAuthoredRiverList } from "../src/shared/world/editing/authored-rivers";
import { applyWorldDiff,createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import * as nativeRiverCarving from "../src/shared/world/generation/river-carving";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds({ ...SMALL_EDITOR_WORLD, rivers: 0 });
it("carves a connected finite channel, changes width/depth, and restores it with undo/removal", () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 }), original = world.heights.slice();
  const snapshot = createWorldSnapshot(world, null); snapshot.capture();
  editAuthoredRiver(world, { id: 1, points: [{ x: 24, z: 24 }, { x: 32, z: 35 }, { x: 40, z: 46 }], width: 2, depth: .7 });
  expect(world.authoredRivers).toHaveLength(1);
  expect(world.authoredRivers![0]!.patches.length).toBeGreaterThan(0);
  expect([...world.heights, ...world.waterDepth, ...world.flow].every(Number.isFinite)).toBe(true);
  const diff = snapshot.diff()!; expect(diff).not.toBeNull();
  const carved = world.heights.slice();
  applyWorldDiff(world, null, diff, "before"); expect(world.heights).toEqual(original);
  expect(world.authoredRivers).toBeUndefined();
  applyWorldDiff(world, null, diff, "after"); expect(world.heights).toEqual(carved);
  editAuthoredRiver(world, { ...world.authoredRivers![0]!, width: 3, depth: 1 });
  expect(world.authoredRivers![0]!.depth).toBe(1);
  editAuthoredRiver(world, null, 1); expect(world.heights).toEqual(original);
  expect(world.authoredRivers).toEqual([]);
});

it("preserves a coincident generated waterfall and validates saved channel metadata", () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  editAuthoredRiver(world, { id: 1, points: [{ x: 24, z: 24 }, { x: 40, z: 40 }], width: 2, depth: .7 });
  const fall = { x: 30, z: 30, top: 2, bottom: 1, directionX: 1, directionZ: 0,
    width: 1, poolRadius: 2, poolX: 30, poolZ: 31 };
  world.waterfalls.push({ ...fall }, { ...fall }); world.authoredRivers![0]!.falls.push(fall);
  expect(isAuthoredRiverList(world.authoredRivers, world.cellsX, world.cellsZ)).toBe(true);
  const invalid = structuredClone(world.authoredRivers!); invalid[0]!.patches[0]!.vertex = -1;
  expect(isAuthoredRiverList(invalid, world.cellsX, world.cellsZ)).toBe(false);
  editAuthoredRiver(world, null, 1);
  expect(world.waterfalls.filter(item => item.x === 30 && item.z === 30)).toHaveLength(1);
});
it("erases freshwater flow and waterfalls while retaining the sculpted bed", () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 }), stride = world.cellsX + 1;
  const vertex = world.heights.findIndex(height => height > world.seaLevel + 1);
  const point = { x: vertex % stride, z: Math.floor(vertex / stride) };
  world.flow[vertex * 2] = 1; world.waterSurface[vertex] = world.heights[vertex]! + .5;
  world.waterDepth[vertex] = .5; world.riverDistance[vertex] = 0;
  const bed = world.heights.slice();
  eraseRiverWater(world, point, 2);
  expect(world.flow[vertex * 2]).toBe(0); expect(world.waterDepth[vertex]).toBe(0);
  expect(world.heights).toEqual(bed);
});

it("persists drawn-channel water erasure through a later width change while keeping its bed", () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  editAuthoredRiver(world, { id: 1, points: [{ x: 24, z: 24 }, { x: 40, z: 40 }], width: 2, depth: .7 });
  const vertex = world.authoredRivers![0]!.patches.find(patch =>
    world.flow[patch.vertex * 2] || world.flow[patch.vertex * 2 + 1])!.vertex;
  const point = { x: vertex % (world.cellsX + 1), z: Math.floor(vertex / (world.cellsX + 1)) };
  const heights = world.heights.slice();
  eraseRiverWater(world, point, 2);
  expect(world.heights).toEqual(heights);
  expect(world.authoredRivers![0]!.suppressedVertices).toContain(vertex);
  editAuthoredRiver(world, { ...world.authoredRivers![0]!, width: 3 });
  expect(world.flow[vertex * 2]).toBe(0); expect(world.flow[vertex * 2 + 1]).toBe(0);
  expect(world.waterDepth[vertex]).toBeCloseTo(Math.max(0, world.seaLevel - world.heights[vertex]!));
});

it("keeps live geometry and reverse patches intact if native recarving fails", () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  editAuthoredRiver(world, { id: 1, points: [{ x: 24, z: 24 }, { x: 40, z: 40 }], width: 2, depth: .7 });
  const before = structuredClone({ heights: world.heights, surface: world.waterSurface,
    flow: world.flow, rivers: world.authoredRivers, falls: world.waterfalls });
  const carving = vi.spyOn(nativeRiverCarving, "carveRivers").mockImplementation(() => { throw new Error("carve failure"); });
  try {
    expect(() => editAuthoredRiver(world, { ...world.authoredRivers![0]!, width: 3 })).toThrow("carve failure");
    expect({ heights: world.heights, surface: world.waterSurface, flow: world.flow,
      rivers: world.authoredRivers, falls: world.waterfalls }).toEqual(before);
  } finally { carving.mockRestore(); }
});

it("rebuilds editor ground after undo before the next river mutation", () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 }), snapshot = createWorldSnapshot(world, null);
  snapshot.capture();
  editAuthoredRiver(world, { id: 1, points: [{ x: 24, z: 24 }, { x: 40, z: 40 }], width: 3, depth: 1 });
  const diff = snapshot.diff()!; applyWorldDiff(world, null, diff, "before");
  const cold = structuredClone(world);
  const river = { id: 2, points: [{ x: 25, z: 24 }, { x: 42, z: 40 }], width: 2, depth: .7 };
  editAuthoredRiver(world, river); editAuthoredRiver(cold, river);
  expect(world.buildCap).toEqual(cold.buildCap);
  expect(world.buildClass).toEqual(cold.buildClass);
  expect(world.walkCost).toEqual(cold.walkCost);
});
